import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireTripAccess, tripAccessErrorResponse } from '@/lib/auth/require-trip-access'
import { checkRateLimit } from '@/lib/rate-limit/rate-limit-middleware'
import { getOpenAIClient } from '@/lib/openai'
import { findPlacePhoto, getCityFromLatLng, isLandmark } from '@/lib/google/places-server'
import { resolvePlacePhotoSrc } from '@/lib/placePhotos' // Import resolvePlacePhotoSrc
import { getSmartItinerary, upsertSmartItinerary } from '@/lib/supabase/smart-itineraries-server'
import type { TripSegment } from '@/types/trip-segments'
import { clerkClient } from '@clerk/nextjs/server'
import { sendTripReadyEmail } from '@/lib/email/resend'
import { getFirstNameFromFullName, normalizeEmailLanguage } from '@/lib/email/language'
import type { Database } from '@/types/database'

interface TripDetails {
  title: string;
  start_date: string;
  end_date: string;
  center_lat: number | null;
  center_lng: number | null;
  destination_name: string | null;
  destination_country: string | null;
  destination_city: string | null;
  owner_id: string;
  trip_ready_email_sent_at: string | null;
}

async function resolveRecipientFromProfile(profile: {
  clerk_user_id: string | null;
  email: string;
  full_name: string | null;
}) {
  if (profile.clerk_user_id) {
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(profile.clerk_user_id);
      return {
        email: user.primaryEmailAddress?.emailAddress || profile.email,
        firstName: user.firstName || getFirstNameFromFullName(user.fullName) || getFirstNameFromFullName(profile.full_name),
        language: normalizeEmailLanguage(
          (user.publicMetadata as { locale?: string } | undefined)?.locale || null
        ),
      };
    } catch (error) {
      console.warn('[ai-itinerary] Failed to load Clerk user for email details:', error);
    }
  }

  return {
    email: profile.email,
    firstName: getFirstNameFromFullName(profile.full_name),
    language: 'en' as const,
  };
}

async function trySendTripReadyEmail(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  tripId: string;
  tripTitle: string;
  tripCity: string;
  ownerProfileId: string;
  tripReadyEmailSentAt: string | null;
}) {
  if (params.tripReadyEmailSentAt) {
    return;
  }

  const { data: profile, error: profileError } = await params.supabase
    .from('profiles')
    .select('id, email, full_name, clerk_user_id')
    .eq('id', params.ownerProfileId)
    .maybeSingle();

  if (profileError || !profile) {
    console.error('[ai-itinerary] Failed to load owner profile for trip ready email:', profileError);
    return;
  }

  const recipient = await resolveRecipientFromProfile(profile as {
    clerk_user_id: string | null;
    email: string;
    full_name: string | null;
  });

  if (!recipient.email) {
    console.warn('[ai-itinerary] Missing recipient email for trip ready email.');
    return;
  }

  // Get or create public share link for the trip
  const { createSupabaseAdmin } = await import('@/lib/supabase/admin');
  const adminSupabase = createSupabaseAdmin();
  
  // Check if share already exists
  const { data: existingShare } = await adminSupabase
    .from('trip_shares')
    .select('public_slug')
    .eq('trip_id', params.tripId)
    .maybeSingle();
  
  const share = existingShare as { public_slug: string } | null;

  let publicSlug: string;
  
  if (share?.public_slug) {
    publicSlug = share.public_slug;
  } else {
    // Generate a new slug and create share
    const generateSlug = () => {
      return Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);
    };
    
    publicSlug = generateSlug();
    const { error: shareError } = await (adminSupabase
      .from('trip_shares') as any)
      .insert({
        trip_id: params.tripId,
        public_slug: publicSlug,
      });

    if (shareError) {
      console.error('[ai-itinerary] Failed to create share link:', shareError);
      // Fallback to authenticated URL if share creation fails
      const appUrl = process.env.APP_URL || 'https://kruno.app';
      const tripUrl = `${appUrl}/trips/${params.tripId}`;
      
      await sendTripReadyEmail({
        userEmail: recipient.email,
        firstName: recipient.firstName,
        tripName: params.tripTitle,
        tripCity: params.tripCity,
        tripUrl,
        language: recipient.language,
      });
      return;
    }
  }

  const appUrl = process.env.APP_URL || 'https://kruno.app';
  const tripUrl = `${appUrl}/p/${publicSlug}`;

  await sendTripReadyEmail({
    userEmail: recipient.email,
    firstName: recipient.firstName,
    tripName: params.tripTitle,
    tripCity: params.tripCity,
    tripUrl,
    language: recipient.language,
  });

  // Type assertion needed because Supabase type inference fails when client is passed as function parameter
  const { error: updateError } = await (params.supabase
    .from('trips') as any)
    .update({ trip_ready_email_sent_at: new Date().toISOString() })
    .eq('id', params.tripId);

  if (updateError) {
    console.error('[ai-itinerary] Failed to update trip_ready_email_sent_at:', updateError);
  }
}

/**
 * Get a human-readable "good for" label based on place types
 * Reused from Explore tab
 */
function getGoodForLabel(types: string[] | null | undefined): string | null {
  if (!types || types.length === 0) return null

  const t = types

  if (t.includes("park") || t.includes("tourist_attraction")) {
    return "Ideal if you like parks and nature"
  }
  if (t.includes("museum") || t.includes("art_gallery")) {
    return "Ideal if you enjoy art and museums"
  }
  if (t.includes("restaurant") || t.includes("cafe")) {
    return "Great if you love food spots"
  }
  if (t.includes("bar") || t.includes("night_club")) {
    return "Nice if you like nightlife"
  }
  if (t.includes("shopping_mall") || t.includes("store")) {
    return "Perfect if you like shopping"
  }

  return null
}

/**
 * Match a suggestion string to a saved place by name (case-insensitive)
 */
function matchSuggestionToSavedPlace(
  suggestion: string,
  savedPlaces: Array<{ name: string; photo_url: string | null; types: string[] | null; place_id: string | null }>
): { photoUrl: string | null; goodFor: string | null; placeId: string | null } | null {
  if (!savedPlaces || savedPlaces.length === 0) return null

  const suggestionLower = suggestion.toLowerCase().trim()
  
  // Try to find a match by name (case-insensitive)
  const matchedPlace = savedPlaces.find(place => {
    const placeNameLower = place.name.toLowerCase().trim()
    // Check if suggestion contains the place name or vice versa
    return suggestionLower.includes(placeNameLower) || placeNameLower.includes(suggestionLower)
  })

  if (!matchedPlace) return null

  return {
    photoUrl: matchedPlace.photo_url,
    goodFor: getGoodForLabel(matchedPlace.types),
    placeId: matchedPlace.place_id,
  }
}

// IMPORTANT: Set OPENAI_API_KEY in your .env.local file and in Vercel environment variables
// This key is only used on the server and never exposed to the client

export type ActivitySuggestion = {
  title: string
  description?: string
  photoUrl?: string | null
  goodFor?: string | null
  placeId?: string | null
  alreadyVisited?: boolean
}

export type AiItinerary = {
  tripTitle: string
  summary: string
  days: {
    date: string
    title: string
    theme: string
    summary: string
    heroImages: string[]
    sections: {
      partOfDay: "Morning" | "Afternoon" | "Evening"
      label?: string
      description: string
      activities?: ActivitySuggestion[]
      suggestions?: (string | ActivitySuggestion)[]
      seasonalNotes?: string
    }[]
  }[]
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { tripId, trip_segment_id } = body

    if (!tripId) {
      return NextResponse.json(
        { error: 'tripId is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Verify user has access to trip
    const accessResult = await requireTripAccess(tripId, supabase)

    // Rate limiting (after auth and trip access)
    const rateLimitCheck = await checkRateLimit(request, 'AI', accessResult.clerkUserId)
    if (!rateLimitCheck.allowed) {
      return rateLimitCheck.response
    }

    // Check if smart itinerary already exists (segment-scoped if trip_segment_id provided)
    let existingItinerary = null;
    if (trip_segment_id) {
      const { data: segmentItinerary } = await supabase
        .from('smart_itineraries')
        .select('content')
        .eq('trip_id', tripId)
        .eq('trip_segment_id', trip_segment_id)
        .maybeSingle<{ content: any }>();
      existingItinerary = segmentItinerary?.content as AiItinerary | null;
    } else {
      const { data: tripItinerary } = await getSmartItinerary(tripId);
      existingItinerary = tripItinerary;
    }
    
    if (existingItinerary) {
      const sanitizedCached = sanitizeNoMdash(existingItinerary);
      return NextResponse.json({ itinerary: sanitizedCached, fromCache: true })
    }

    // Load trip data
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('title, start_date, end_date, center_lat, center_lng, destination_name, destination_country, destination_city, owner_id, trip_ready_email_sent_at')
      .eq('id', tripId)
      .single<{
        title: string;
        start_date: string;
        end_date: string;
        center_lat: number | null;
        center_lng: number | null;
        destination_name: string | null;
        destination_country: string | null;
        destination_city: string | null;
        owner_id: string;
        trip_ready_email_sent_at: string | null;
      }>()

    if (tripError || !trip) {
      return NextResponse.json(
        { error: 'Trip not found' },
        { status: 404 }
      )
    }

    // Load segment data if trip_segment_id provided
    let segment: TripSegment | null = null;
    if (trip_segment_id) {
      const { data: segmentData } = await supabase
        .from('trip_segments')
        .select('*')
        .eq('id', trip_segment_id)
        .eq('trip_id', tripId)
        .single<TripSegment>();
      segment = segmentData;
    }

    // Load days for the trip (filtered by segment if provided)
    let daysQuery = supabase
      .from('days')
      .select('id, date, day_number')
      .eq('trip_id', tripId);
    
    if (trip_segment_id) {
      daysQuery = daysQuery.eq('trip_segment_id', trip_segment_id);
    } else {
      // For trip-level, get days without segment (legacy single-city trips)
      daysQuery = daysQuery.is('trip_segment_id', null);
    }
    
    const { data: days, error: daysError } = await daysQuery
      .order('date', { ascending: true })
      .returns<Array<{
        id: string;
        date: string;
        day_number: number;
      }>>();

    if (daysError) {
      console.error('Error loading days:', daysError)
      return NextResponse.json(
        { error: 'Failed to load trip days' },
        { status: 500 }
      )
    }

    // Load saved places for the trip (from saved_places table)
    const { data: savedPlaces, error: placesError } = await supabase
      .from('saved_places')
      .select('name, address, lat, lng, types, photo_url, place_id')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: false })
      .limit(20)
      .returns<Array<{
        name: string;
        address: string | null;
        lat: number | null;
        lng: number | null;
        types: string[] | null;
        photo_url: string | null;
        place_id: string | null;
      }>>();

    if (placesError) {
      console.error('Error loading saved places:', placesError)
      // Don't fail if places can't be loaded, just continue without them
    }

    // Build the prompt (use segment data if available)
    // CRITICAL: Priority 1) Use destination_city if available (most reliable)
    // Priority 2) Use reverse geocoding if destination_name is a landmark
    // Priority 3) Extract from destination_name if possible
    let primaryDestination = trip.destination_city || trip.destination_name || trip.title;
    let resolvedCity = trip.destination_city;
    
    // Comprehensive landmark keywords list (matching trip creation - includes English and Spanish)
    const landmarkKeywordsList = [
      // English keywords
      'market', 'museum', 'palace', 'cathedral', 'church', 'tower', 'bridge', 'park', 'garden', 
      'basilica', 'basílica', 'monument', 'sagrada', 'stadium', 'arena', 'coliseum', 'theater', 
      'theatre', 'opera', 'temple', 'mosque', 'synagogue', 'shrine', 'fort', 'castle', 'square',
      'plaza', 'fountain', 'memorial', 'zoo', 'aquarium', 'library', 'university', 'hospital',
      'station', 'airport', 'hotel', 'resort', 'mall', 'central market',
      // Spanish keywords (for Spanish-speaking locales)
      'museo', 'catedral', 'palacio', 'torre', 'monumento', 'iglesia', 'templo', 'mezquita', 'sinagoga', 
      'santuario', 'estadio', 'estadium', 'coliseo', 'teatro', 'ópera', 'mercado', 'parque', 'jardín', 
      'puente', 'fuerte', 'castillo', 'plaza', 'fuente', 'memorial', 'zoológico', 'acuario', 'biblioteca', 
      'universidad', 'hospital', 'estación', 'aeropuerto', 'hotel', 'resort', 'centro comercial',
      // Known stadium and landmark names (various languages)
      'camp nou', 'campo', 'estadio camp nou', 'spotify camp nou', 'sagrada família', 'sagrada familia',
      'mestalla', 'la rambla', 'park güell', 'parc güell'
    ];
    
    const isLikelyLandmark = (dest: string): boolean => {
      if (!dest) return false;
      return landmarkKeywordsList.some(keyword => dest.toLowerCase().includes(keyword));
    };

    // If primaryDestination is a landmark and no city is resolved, attempt to reverse geocode
    if (!resolvedCity && trip.center_lat && trip.center_lng) {
      // Use our comprehensive landmark check instead of just isLandmark function
      if (isLikelyLandmark(primaryDestination) || (await isLandmark(primaryDestination))) {
        const cityFromLatLng = await getCityFromLatLng(trip.center_lat, trip.center_lng);
        if (cityFromLatLng) {
          resolvedCity = cityFromLatLng;
          primaryDestination = cityFromLatLng; // Use the resolved city as the primary destination
          // Update the trip with the resolved city
          // @ts-expect-error - destination_city exists in schema but types may not be updated
          await supabase.from('trips').update({ destination_city: cityFromLatLng }).eq('id', tripId);
          console.log(`[ai-itinerary] Extracted city "${cityFromLatLng}" from coordinates for landmark "${trip.destination_name}"`);
        }
      }
    }

    // Helper to extract city name from a destination string that might contain landmarks
    const extractCityName = (dest: string): string => {
      if (!dest) return dest;
      
      const destLower = dest.toLowerCase();
      
      // Common patterns: "Landmark Name, City" or "Landmark of City" or "City Landmark"
      // Try to extract city from patterns like "Central Market of Valencia" -> "Valencia"
      // Improved pattern to catch "X of Y" or "X of Y Trip" or "X of Y, Country"
      const ofPattern = /\bof\s+([^,\s]+(?:\s+[^,\s]+)?)(?:\s*,|\s*(?:Trip|trip|$))/i;
      const match = dest.match(ofPattern);
      if (match && match[1]) {
        const city = match[1].trim();
        // Remove common suffixes that might be part of landmark name
        return city.replace(/\s*(Trip|trip)$/i, '').trim();
      }
      
      // Check if destination contains a comma (format: "Landmark, City, Country")
      const parts = dest.split(',').map(s => s.trim());
      if (parts.length >= 2) {
        // Usually the city is the second-to-last part before country
        // But if first part has landmark keywords, skip it
        const firstPartLower = parts[0].toLowerCase();
        if (landmarkKeywordsList.some(keyword => firstPartLower.includes(keyword))) {
          // First part is a landmark, use second part (city)
          return parts[1] || parts[parts.length - 2];
        }
        return parts[parts.length - 2];
      }
      
      // If destination looks like a city name (no landmark keywords), return as-is
      const hasLandmarkKeyword = landmarkKeywordsList.some(keyword => destLower.includes(keyword));
      
      if (!hasLandmarkKeyword) {
        return dest.replace(/\s*(Trip|trip)$/i, '').trim();
      }
      
      // If we still have a landmark, try to reverse-engineer the city name
      for (const keyword of landmarkKeywordsList) {
        if (destLower.includes(keyword)) {
          // Try to extract what comes after landmark + "of"
          const afterKeyword = dest.substring(destLower.indexOf(keyword) + keyword.length);
          const afterOfMatch = afterKeyword.match(/\bof\s+([^,\s]+(?:\s+[^,\s]+)?)/i);
          if (afterOfMatch && afterOfMatch[1]) {
            return afterOfMatch[1].trim();
          }
        }
      }
      
      // Last resort: if it contains "of", extract everything after "of"
      const lastOfMatch = dest.match(/\bof\s+([^,\s]+(?:\s+[^,\s]+)?)/i);
      if (lastOfMatch && lastOfMatch[1]) {
        return lastOfMatch[1].trim();
      }
      
      // Couldn't extract - return original (will be handled by reverse geocoding or AI prompt instructions)
      return dest.replace(/\s*(Trip|trip)$/i, '').trim();
    };
    
    // Helper to sanitize and fix itinerary titles
    const sanitizeItineraryTitle = (title: string, cityName: string): string => {
      if (!title) return `${cityName} Trip`;
      
      const titleLower = title.toLowerCase();
      const cityLower = cityName.toLowerCase();
      
      // Remove "Trip" suffix if present to normalize
      let normalized = title.replace(/\s*(Trip|trip)$/i, '').trim();
      
      // If title already starts with city name, just add "Trip"
      if (titleLower.startsWith(cityLower)) {
        return `${cityName} Trip`;
      }
      
      // Check if title contains landmark patterns (comprehensive list including Spanish keywords)
      const landmarkKeywords = [
        // English keywords
        'market', 'museum', 'palace', 'cathedral', 'church', 'tower', 'bridge', 'park', 'garden', 
        'basilica', 'basílica', 'monument', 'sagrada', 'stadium', 'arena', 'coliseum', 'theater', 
        'theatre', 'opera', 'temple', 'mosque', 'synagogue', 'shrine', 'fort', 'castle', 'square',
        'plaza', 'fountain', 'memorial', 'zoo', 'aquarium', 'library', 'university', 'hospital',
        'station', 'airport', 'hotel', 'resort', 'mall', 'central market',
        // Spanish keywords (for Spanish-speaking locales)
        'museo', 'catedral', 'palacio', 'torre', 'monumento', 'iglesia', 'templo', 'mezquita', 'sinagoga', 
        'santuario', 'estadio', 'estadium', 'coliseo', 'teatro', 'ópera', 'mercado', 'parque', 'jardín', 
        'puente', 'fuerte', 'castillo', 'fuente', 'zoológico', 'acuario', 'biblioteca', 'universidad',
        'hospital', 'estación', 'aeropuerto', 'centro comercial',
        // Known stadium and landmark names (various languages)
        'camp nou', 'campo', 'estadio camp nou', 'spotify camp nou', 'sagrada família', 'sagrada familia',
        'mestalla', 'la rambla', 'park güell', 'parc güell'
      ];
      const hasLandmarkKeyword = landmarkKeywords.some(keyword => titleLower.includes(keyword));
      
      if (hasLandmarkKeyword) {
        // CRITICAL: If title is a landmark without "of" pattern (e.g., "Spotify Camp Nou Trip", "Mestalla Stadium Trip"),
        // ALWAYS use the provided cityName directly - it should already be extracted correctly from trip creation
        // Try to extract city from "X of Y" pattern first (e.g., "Central Market of Valencia" -> "Valencia")
        const ofPatterns = [
          /\bof\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)(?:\s*,|\s*$)/i,  // "of Valencia" or "of Valencia, Spain" - after normalization
          /\bof\s+([^,\s]+(?:\s+[^,\s]+)?)(?:\s*$|,)/i,  // More general: "of [city name]" followed by comma or end
          /\bof\s+(.+?)(?:\s*$|,)/i,  // Most general: "of [anything]" until end or comma
        ];
        
        let extractedCity: string | null = null;
        for (const pattern of ofPatterns) {
          const ofMatch = normalized.match(pattern);
          if (ofMatch && ofMatch[1]) {
            let candidate = ofMatch[1].trim();
            candidate = candidate.replace(/\s*(Trip|trip)$/i, '').trim();
            const candidateLower = candidate.toLowerCase();
            // Make sure it's not another landmark keyword
            if (candidate && !landmarkKeywords.some(keyword => candidateLower.includes(keyword))) {
              extractedCity = candidate;
              break;
            }
          }
        }
        
        // If no "of" pattern found, check comma-separated format
        if (!extractedCity && normalized.includes(',')) {
          const parts = normalized.split(',').map(s => s.trim());
          if (parts.length > 1) {
            const firstPartLower = parts[0].toLowerCase();
            if (landmarkKeywords.some(keyword => firstPartLower.includes(keyword))) {
              const cityCandidate = parts[1].trim();
              const cityLower = cityCandidate.toLowerCase();
              if (!landmarkKeywords.some(keyword => cityLower.includes(keyword))) {
                extractedCity = cityCandidate;
              }
            }
          }
        }
        
        // CRITICAL: If no extraction worked or title is clearly a landmark (like "Spotify Camp Nou Trip"),
        // ALWAYS use the provided cityName which should have been correctly extracted during trip creation
        if (extractedCity && !landmarkKeywords.some(keyword => extractedCity!.toLowerCase().includes(keyword))) {
          console.log(`[sanitizeItineraryTitle] ✓ Extracted city "${extractedCity}" from title "${title}"`);
          return `${extractedCity} Trip`;
        } else {
          // CRITICAL FALLBACK: Always use provided cityName - it's the most reliable source
          console.warn(`[sanitizeItineraryTitle] ⚠ Could not safely extract city from landmark title "${title}", using provided cityName: "${cityName}"`);
          return `${cityName} Trip`;
        }
      }
      
      // If no landmark detected but title doesn't match city, use city name
      if (!titleLower.includes(cityLower)) {
        return `${cityName} Trip`;
      }
      
      // Title looks okay, just ensure "Trip" suffix
      return `${normalized} Trip`;
    };

    // Extract city name from destination (handle landmarks like "Central Market of Valencia")
    const extractedCityName = extractCityName(primaryDestination);
    
    // Set destination and country for the prompt - ALWAYS use city name, never landmark
    const destination = segment?.city_name || extractedCityName || primaryDestination;
    const country = trip.destination_country || "";
    const startDate = segment ? new Date(segment.start_date) : new Date(trip.start_date);
    const endDate = segment ? new Date(segment.end_date) : new Date(trip.end_date);
    
    // Format saved places for the prompt
    let savedPlacesText = ''
    if (savedPlaces && savedPlaces.length > 0) {
      const placesList = savedPlaces.map(p => {
        const typesStr = p.types && p.types.length > 0 ? ` (${p.types.slice(0, 2).join(', ')})` : ''
        return `- ${p.name}${p.address ? ` - ${p.address}` : ''}${typesStr}`
      }).join('\n')
      savedPlacesText = `

Saved places of interest (prioritize including these in the itinerary):
${placesList}`
    }

    const daysInfo = (days || []).map(day => {
      const date = new Date(day.date)
      return {
        date: date.toISOString().split('T')[0],
        dayNumber: day.day_number,
        dayOfWeek: date.toLocaleDateString('en-US', { weekday: 'long' }),
        month: date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        day: date.getDate(),
        year: date.getFullYear(),
      }
    })

    const prompt = `You are an expert travel planner. Create a detailed, story-like itinerary in JSON format.

CRITICAL: The destination "${destination}" is the CITY you are planning for. If it contains a landmark name (like "Central Market of Valencia"), extract ONLY the city name (Valencia) for the trip title.

Trip Details:
- Destination CITY: ${destination} (This is the city for the entire trip - plan for the WHOLE city with diverse activities)
- Trip dates: ${startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} to ${endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
- Number of days: ${days?.length || 0}${savedPlacesText}

Days to plan:
${daysInfo.map(d => `- Day ${d.dayNumber}: ${d.dayOfWeek}, ${d.month} ${d.day}, ${d.year} (${d.date})`).join('\n')}

Requirements:
- **CRITICAL PRIORITY #1 - Trip Title**: The "tripTitle" field MUST ALWAYS be city-based ONLY (e.g., "Valencia Trip", "Barcelona Trip", "Madrid Trip")
  - NEVER include landmarks, places, or POI names in the title (e.g., NEVER "Central Market of Valencia Trip", NEVER "Sagrada Família Trip")
  - ALWAYS extract and use ONLY the city name from "${destination}"
  - If destination contains "X of Y" format (e.g., "Central Market of Valencia"), extract "Y" (Valencia) and use: "Valencia Trip"
  - If destination contains "X, Y" format, extract "Y" (the city) and use: "Y Trip"
  - Format: "[CityName] Trip" - e.g., "Valencia Trip" NOT "Central Market of Valencia Trip"
  - The title represents the ENTIRE city destination, not any single place within it
  - Landmarks are just activities in the itinerary - they are NOT the trip destination
- 1 entry per day of the trip.
- Each day has:
    - "title": short name for the day.
    - "date": ISO date string (YYYY-MM-DD).
    - "theme": short label like "Cultural Immersion" or "Food & Markets".
    - "summary": 3-5 sentences describing the day in depth (tone: friendly, vivid, like a travel blog).
    - "heroImages": 4-6 photo search terms for that day (for a horizontal gallery), e.g. ["Madrid Royal Palace", "Retiro Park Madrid", "Tapas bar Madrid"].
    - "sections": morning / afternoon / evening. Each section has:
         - "label": "Morning", "Afternoon", or "Evening"
         - "description": ALWAYS 2-3 paragraphs (blank-line separated), each 3-5 sentences, packed with specifics for EVERY destination and EVERY slot. Include: exact transit (metro/bus/tram line numbers, station names, walking cues, durations, frequencies, one-way cost), opening/closing windows and reservation/ticket tips, nearby food/coffee picks with price ranges, and a wow/fact or micro-tip tied to the area. Never collapse to a single paragraph.
         - "activities": array of activities. Each activity has:
              - "name": activity name
              - "description": 2-3 sentences with practical info (opening hours, tips, what to expect)
              - "placeId": null (always null for now)
              - "alreadyVisited": false (always false for now)
- **Hard Constraint**: If the trip is 2 or more days, it *must* include at least 3 different areas/neighborhoods of the city. If the trip is 1 day, it *must* include at least 2 different areas/neighborhoods.
- **Hard Constraint**: Must include category diversity. Each day must feature activities from at least 4 different categories from this list: sightseeing, food, park/nature, culture, viewpoint, local streets/market.
- **Hard Constraint**: Plan the ENTIRE itinerary for the WHOLE city "${destination}" - include many different areas, neighborhoods, landmarks, and activities across the entire city. Do NOT focus on just one landmark or place.
- **Hard Constraint**: No single Point of Interest (POI) can appear in more than 1 activity block per day (e.g., if a museum is visited in the morning, it cannot be visited again in the afternoon or evening of the same day). Exceptions for distinctly different experiences (e.g. day/night visit to a major landmark) must be explicitly justified in the activity description.
- For each time slot (Morning, Afternoon, Evening), target at least 4-6 activities where feasible. This can include major sights, short stops, viewpoints, small walks, etc. Still respect realistic travel time and opening hours.
- Use the destination city "${destination}" to anchor ALL recommendations - plan for the ENTIRE city with diverse activities across different neighborhoods and areas.
- Prioritize incorporating the saved places listed above - try to include as many as possible in the day-by-day itinerary, organizing them logically by location and timing.
- Avoid adding the exact same place or landmark more than once to the itinerary, UNLESS it is a significant landmark that offers a distinctly different experience at different times (e.g., day vs. night visit).
- When a place is suggested multiple times (e.g., a restaurant for lunch and dinner), pick the most suitable slot and do not duplicate. If a place must be visited multiple times, make sure the activity description for each visit is unique and highlights the different experience.
- Avoid booking links or specific booking recommendations - just give ideas and context
- Provide realistic timing and themes for each day
- Include seasonal considerations (weather, local events, etc.)
- Make the text rich, descriptive, and engaging - like a travel blog post
- Do not use mdash characters (em dash or en dash). Write ranges with words such as "to", "and", or commas (e.g., "around €12 and €20", "09:00 to 19:00").

Return ONLY valid JSON with this exact structure:
{
  "tripTitle": "CRITICAL: MUST be city-based only, e.g., 'Valencia Trip' - NEVER include landmarks in title",
  "summary": "A 2-3 sentence overview of the trip",
  "days": [
    {
      "date": "YYYY-MM-DD",
      "title": "Day title (e.g., 'Arrival and City Exploration')",
      "theme": "Theme for the day (e.g., 'Cultural Immersion', 'Nature & Relaxation')",
      "summary": "3-5 sentences describing the day in depth, friendly and vivid tone",
      "heroImages": ["Photo search term 1", "Photo search term 2", "Photo search term 3", "Photo search term 4"],
      "sections": [
        {
          "label": "Morning",
          "description": "2-3 paragraphs (blank-line separated), each 3-5 sentences, with transit lines/stations, walking cues, durations/costs, opening/closing windows, reservation/ticket tips, nearby food/coffee with price ranges, and a wow/fact or micro-tip. Never single-paragraph.",
          "activities": [
            {
              "name": "Activity name",
              "description": "2-3 sentences with practical info",
              "placeId": null,
              "alreadyVisited": false
            }
          ],
          "seasonalNotes": "Optional note about seasonal considerations"
        }
      ]
    }
  ]
}

Make sure each day has sections for Morning, Afternoon, and Evening with approximately 4 activities per slot (12+ activities per day). Be creative but realistic.`

    // Call OpenAI
    const openai = getOpenAIClient()
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful travel planning assistant. Always return valid JSON matching the exact structure requested. No markdown formatting, just pure JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    })

    const responseContent = completion.choices[0]?.message?.content
    if (!responseContent) {
      throw new Error('No response from OpenAI')
    }

    // Parse the JSON response
    type RawActivity = {
      name: string
      description: string
      placeId: string | null
      alreadyVisited: boolean
    }

    type RawAiItinerary = {
      tripTitle: string
      summary: string
      days: {
        date: string
        title: string
        theme: string
        summary: string
        heroImages: string[]
        sections: {
          label: string
          description: string
          activities: RawActivity[]
          seasonalNotes?: string
        }[]
      }[]
    }

// Ensure each section description is multi-paragraph and practical
function ensureRichSectionDescriptions(itinerary: RawAiItinerary, destination?: string) {
  if (!itinerary?.days?.length) return;

  const normalizeMdashes = (text?: string | null): string =>
    (text || '')
      .replace(/[\u2013\u2014]/g, ' to ')
      // Collapse repeated spaces/tabs but preserve newlines for paragraph breaks
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .trim();

  const toParagraphs = (text?: string | null): string[] =>
    normalizeMdashes(text)
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(Boolean);

  const MIN_PARAGRAPHS = 3;

  for (const day of itinerary.days) {
    for (const section of day.sections || []) {
      const paragraphs = toParagraphs(section.description);

      const primary = section.activities?.[0];
      const activityName = primary?.name || section.label || 'this slot';
      const areaHint = destination ? `around ${destination}` : 'nearby';
      // If the model already produced 3+ paragraphs, just normalize spacing
      if (paragraphs.length >= MIN_PARAGRAPHS) {
        section.description = paragraphs.join('\n\n');
        continue;
      }

      // Build safety net paragraphs packed with tips and specifics
      const safetyParagraphs: string[] = [];

      const transitParagraph = [
        `Start your ${section.label.toLowerCase()} near ${activityName} and keep legs fresh by chaining stops ${areaHint}.`,
        `Lock in exact metro, bus, or tram lines by name and direction, keep single rides around €2 to €3, and expect 10 to 20 minute walks between clustered sights.`,
        `If you need to cross neighborhoods, budget 20 to 35 minutes door to door and confirm the return frequency before you leave.`,
      ].join(' ');

      const timingParagraph = [
        `Most headline sights run roughly 09:00 to 19:00 with last entry about an hour before close; confirm ticket rules and reserve online to skip queues.`,
        `Carry a digital copy and ID for scans, and keep a small buffer for bag checks or timed entry windows.`,
        `Have a backup nearby stop so you can pivot quickly if a queue balloons or a venue closes early.`,
      ].join(' ');

      const foodParagraph = [
        `Refuel nearby: grab coffee or a pastry before noon, or a menu del día between €12 and €20 on quieter side streets; check if terraces need reservations on weekends.`,
        `Ask for house specials, watch for cover charges, and keep small coins handy for bakeries or markets.`,
        `Add one wow detail such as a lookout, a local market detour, or a quick gelato stop to cap the slot.`,
      ].join(' ');

      safetyParagraphs.push(transitParagraph, timingParagraph, foodParagraph);

      // Seed with any AI-provided paragraphs, then append safety net until we hit 3
      const composed: string[] = [...paragraphs];
      while (composed.length < MIN_PARAGRAPHS && safetyParagraphs.length) {
        composed.push(safetyParagraphs.shift()!);
      }

      // If still short (unlikely), reuse the last safety paragraph to meet the minimum
      while (composed.length < MIN_PARAGRAPHS) {
        composed.push(foodParagraph);
      }

      section.description = normalizeMdashes(composed.join('\n\n'));
    }
  }
}

const replaceMdashes = (value: string): string =>
  (value || '')
    .replace(/[\u2013\u2014]/g, ' to ')
    // Preserve newlines when cleaning whitespace
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+([.,;:!?])/g, '$1');

function sanitizeNoMdash<T>(input: T): T {
  if (typeof input === 'string') {
    return replaceMdashes(input) as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map(item => sanitizeNoMdash(item)) as unknown as T;
  }

  if (input instanceof Date) {
    return input;
  }

  if (input && typeof input === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      sanitized[key] = sanitizeNoMdash(value as any);
    }
    return sanitized as unknown as T;
  }

  return input;
}

    let parsedResponse: RawAiItinerary
    try {
      const parsed = JSON.parse(responseContent)
      // Handle case where response might be wrapped in an object
      parsedResponse = parsed.itinerary || parsed
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError)
      console.error('Response content:', responseContent)
      throw new Error('Failed to parse OpenAI response as JSON')
    }

    // Validate structure
    if (!parsedResponse.tripTitle || !parsedResponse.summary || !Array.isArray(parsedResponse.days)) {
      throw new Error('Invalid itinerary structure from OpenAI')
    }

    // POST-PROCESS: Ensure tripTitle is city-based, not landmark-based
    // Use the sanitizeItineraryTitle function for consistency
    if (parsedResponse.tripTitle) {
      const originalTitle = parsedResponse.tripTitle;
      parsedResponse.tripTitle = sanitizeItineraryTitle(parsedResponse.tripTitle, destination);
      if (parsedResponse.tripTitle !== originalTitle) {
        console.warn(`[ai-itinerary] Post-processed title from "${originalTitle}" to "${parsedResponse.tripTitle}"`);
      }
    } else {
      parsedResponse.tripTitle = `${destination} Trip`;
    }

    // Enforce multi-paragraph, tip-heavy slot descriptions
    ensureRichSectionDescriptions(parsedResponse, destination);

    // Post-process: Enforce food place cap (max 1 per slot)
    // Improved food place detection function
    const isFoodPlace = (activity: RawActivity, types?: string[] | null): boolean => {
      // Check Google Places types first (most reliable)
      if (types && Array.isArray(types)) {
        const foodTypes = [
          'restaurant', 'cafe', 'bakery', 'bar', 'food', 'meal_takeaway', 'meal_delivery',
          'cafe', 'bakery', 'bar', 'night_club', 'liquor_store', 'store', 'supermarket'
        ];
        if (types.some(type => foodTypes.includes(type))) {
          return true;
        }
      }
      
      // Fallback to keyword matching in name/description
      const foodKeywords = [
        'restaurant', 'cafe', 'café', 'bar', 'brunch', 'dining', 'bistro', 'eatery',
        'food', 'meal', 'lunch', 'dinner', 'breakfast', 'tavern', 'pub', 'bakery',
        'pizzeria', 'trattoria', 'tapas', 'taverna', 'ristorante', 'osteria', 'cantina',
        'food court', 'food market', 'market', 'deli', 'deli', 'sandwich', 'burger',
        'steakhouse', 'seafood', 'sushi', 'ramen', 'noodle', 'pasta', 'pizza'
      ];
      
      const nameLower = activity.name.toLowerCase();
      const descLower = activity.description.toLowerCase();
      return foodKeywords.some(keyword => nameLower.includes(keyword) || descLower.includes(keyword));
    };

    parsedResponse.days.forEach(day => {
      day.sections.forEach(section => {
        const activities = section.activities || [];
        // Note: At this point, activities don't have types yet, so we use keyword matching
        // Types will be available after place details are fetched
        const eatingPlaces = activities.filter(activity => isFoodPlace(activity));
        
        if (eatingPlaces.length > 1) {
          // Keep the first eating place (we don't have rating info at this stage)
          // In a future enhancement, we could fetch place details here to get ratings
          const firstEatingPlace = eatingPlaces[0];
          const firstEatingIndex = activities.indexOf(firstEatingPlace);
          
          // Remove other eating places from this slot
          const filteredActivities = activities.filter((activity, index) => {
            if (index === firstEatingIndex) return true; // Keep first
            return !isFoodPlace(activity); // Remove other eating places
          });
          
          section.activities = filteredActivities;
          
          // Log removed food places for debugging
          if (process.env.NODE_ENV === 'development') {
            console.log(`[ai-itinerary] Removed ${eatingPlaces.length - 1} food place(s) from ${day.date} ${section.label}, kept: ${firstEatingPlace.name}`);
          }
        }
      });
    });

    // POST-PROCESS: Remove duplicate places within the same day
    // Normalize place names for comparison (case-insensitive, trim whitespace)
    const normalizePlaceName = (name: string): string => {
      return name.toLowerCase().trim();
    };

    parsedResponse.days.forEach(day => {
      // Track places seen in this day across all time slots
      const seenPlaces = new Set<string>();
      const removedDuplicates: Array<{ name: string; fromSection: string }> = [];

      day.sections.forEach(section => {
        const activities = section.activities || [];
        const filteredActivities: RawActivity[] = [];

        activities.forEach(activity => {
          const normalizedName = normalizePlaceName(activity.name);
          
          if (seenPlaces.has(normalizedName)) {
            // This place already appeared in a previous time slot for this day
            removedDuplicates.push({ name: activity.name, fromSection: section.label });
          } else {
            // First time seeing this place in this day
            seenPlaces.add(normalizedName);
            filteredActivities.push(activity);
          }
        });

        section.activities = filteredActivities;
      });

      // Log removed duplicates for debugging
      if (removedDuplicates.length > 0 && process.env.NODE_ENV === 'development') {
        console.log(`[ai-itinerary] Removed ${removedDuplicates.length} duplicate place(s) from ${day.date}:`, removedDuplicates.map(d => `${d.name} (${d.fromSection})`).join(', '));
      }
    });

    // Initialize sets for deduplication within the current itinerary generation
    const usedImageUrls = new Set<string>();
    const usedPlaceIds = new Set<string>();

    // Process itinerary: Fetch photos and prepare activities for insertion
    const activitiesToInsert: any[] = [];
    let globalOrderCounter = 0;
    
    const enrichedDays = await Promise.all(parsedResponse.days.map(async (day, index) => {
      // Find matching DB day
      const dbDay = days?.find(d => d.date === day.date) || days?.[index];
      
      // Fetch photos for hero images
      const heroPhotoUrls = await Promise.all(
        (day.heroImages || []).slice(0, 6).map(async (searchTerm) => {
          const query = `${searchTerm} in ${destination}${country ? `, ${country}` : ''}`;
          // Pass deduplication sets when finding hero images
          return await findPlacePhoto(query, { usedImageUrls, usedPlaceIds, placeId: null, allowDedupedFallback: true, destinationCity: destination });
        })
      );

      const enrichedSections = await Promise.all(day.sections.map(async (section) => {
        const partOfDay = section.label as "Morning" | "Afternoon" | "Evening";
        
        const enrichedActivities = await Promise.all(section.activities.map(async (activity, aIndex) => {
          // Try to match with saved place first
          let match = matchSuggestionToSavedPlace(activity.name, savedPlaces || []);
          let photoUrl = match?.photoUrl;
          let activityPlaceId = match?.placeId || activity.placeId;
          
          // If no photo from saved place, try Google Places
          if (!photoUrl) {
             const query = `${activity.name} in ${destination}${country ? `, ${country}` : ''}`;
             // Pass deduplication sets and placeId to resolvePlacePhotoSrc
             photoUrl = await findPlacePhoto(query, { usedImageUrls, usedPlaceIds, placeId: activityPlaceId, allowDedupedFallback: true, destinationCity: destination });
          }

          const cleanActivityName = replaceMdashes(activity.name);
          const cleanActivityDescription = replaceMdashes(activity.description);

          // Prepare activity record
          if (dbDay) {
            let startTime = "09:00";
            let endTime = "12:00";
            
            if (partOfDay === "Afternoon") {
              startTime = "13:00";
              endTime = "17:00";
            } else if (partOfDay === "Evening") {
              startTime = "18:00";
              endTime = "21:00";
            }

            activitiesToInsert.push({
              trip_id: tripId,
              day_id: dbDay.id,
              title: cleanActivityName,
              start_time: startTime,
              end_time: endTime,
              photo_url: photoUrl,
              order_number: globalOrderCounter++,
              place_id: activityPlaceId, // Save the resolved placeId
            });
          }

          return {
            title: cleanActivityName,
            description: cleanActivityDescription,
            photoUrl: photoUrl,
            goodFor: match?.goodFor,
            placeId: activityPlaceId, // Return the resolved placeId
            alreadyVisited: activity.alreadyVisited || false,
          } as ActivitySuggestion;
        }));

        return {
          partOfDay: partOfDay,
          label: section.label,
          description: section.description,
          activities: enrichedActivities,
          seasonalNotes: section.seasonalNotes,
        };
      }));

      return {
        ...day,
        heroImages: heroPhotoUrls.filter(url => url !== null) as string[],
        sections: enrichedSections,
      };
    }));

    const enrichedItinerary: AiItinerary = {
      ...parsedResponse,
      days: enrichedDays,
    };

    const sanitizedItinerary = sanitizeNoMdash(enrichedItinerary);

    // Save enriched itinerary JSON to smart_itineraries table
    const { error: saveError } = await upsertSmartItinerary(tripId, sanitizedItinerary, trip_segment_id);
    if (saveError) {
      console.error('Error saving smart itinerary:', saveError);
      // Continue even if save fails - we still return the itinerary
    }

    // Insert activities into DB
    // First, clear existing auto-generated activities? 
    // The prompt says "Do not delete existing activities automatically when mounting".
    // But here we are generating new ones. If user requested generation, maybe they want to overwrite?
    // "After activities are loaded, if activities.length === 0 ... then call".
    // So we assume it's empty. If not empty, we append.
    if (activitiesToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('activities')
        // @ts-ignore - Supabase type inference fails here, but the types are correct at runtime
        .insert(activitiesToInsert);
      
      if (insertError) {
        console.error("Error inserting generated activities:", insertError);
      }
    }

    if (!saveError) {
      const tripCity =
        trip.destination_city || trip.destination_name || trip.title;

      try {
        await trySendTripReadyEmail({
          supabase,
          tripId,
          tripTitle: trip.title,
          tripCity,
          ownerProfileId: trip.owner_id,
          tripReadyEmailSentAt: trip.trip_ready_email_sent_at,
        });
      } catch (emailError) {
        console.error('[ai-itinerary] Failed to send trip ready email:', emailError);
      }
    }

    return NextResponse.json({ itinerary: sanitizedItinerary, fromCache: false })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const res = tripAccessErrorResponse(error)
    if (res.status !== 500) return res
    console.error('Error in /api/ai-itinerary:', error)
    return NextResponse.json(
      { error: 'Failed to generate itinerary' },
      { status: 500 }
    )
  }
}

