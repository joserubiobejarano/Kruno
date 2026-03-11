import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileId } from '@/lib/auth/getProfileId';
import { checkRateLimit } from '@/lib/rate-limit/rate-limit-middleware';
import OpenAI from 'openai';
import { SmartItinerary } from '@/types/itinerary';

export const maxDuration = 300;

const SMART_ITINERARY_SCHEMA_TEXT = `
interface ItineraryPlace {
  id: string;
  name: string;
  description: string;
  area: string;       // e.g. "Gothic Quarter"
  neighborhood: string | null;
  photos: string[];
  visited: boolean;
  tags: string[];     // "food", "viewpoint", etc.
}

type TimeOfDay = 'morning' | 'afternoon' | 'evening';

interface ItinerarySlot {
  label: TimeOfDay;
  summary: string;
  places: ItineraryPlace[];
}

interface ItineraryDay {
  id: string;
  index: number;
  date: string;
  title: string;
  theme: string;
  areaCluster: string; // main area for that day
  photos: string[];
  overview: string;
  slots: ItinerarySlot[]; // usually 3
}

interface SmartItinerary {
  title: string;
  summary: string;
  days: ItineraryDay[];
  tripTips: string[]; // trip-wide tips (season, holidays, packing)
}
`;

export async function POST(req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  let profileId: string | undefined;
  let tripId: string | undefined;

  try {
    tripId = (await params).tripId;
    const { message } = await req.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Missing message' }, { status: 400 });
    }

    const supabase = await createClient();

    // Get profile ID for authorization
    let clerkUserId: string | undefined;
    try {
      const authResult = await getProfileId(supabase);
      profileId = authResult.profileId;
      clerkUserId = authResult.clerkUserId;
    } catch (authError: any) {
      console.error('[Itinerary Chat API]', {
        path: '/api/trips/[tripId]/itinerary-chat',
        method: 'POST',
        error: authError?.message || 'Failed to get profile',
        tripId,
      });
      return NextResponse.json(
        { error: authError?.message || 'Unauthorized' },
        { status: 401 }
      );
    }

    // Verify user has access to trip
    const { data: tripData, error: tripError } = await supabase
      .from("trips")
      .select("id, owner_id")
      .eq("id", tripId)
      .single();

    if (tripError || !tripData) {
      console.error('[Itinerary Chat API]', {
        path: '/api/trips/[tripId]/itinerary-chat',
        method: 'POST',
        tripId,
        profileId,
        error: tripError?.message || 'Trip not found',
        errorCode: tripError?.code,
        context: 'trip_lookup',
      });
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    type TripQueryResult = {
      id: string
      owner_id: string
    }

    const trip = tripData as TripQueryResult;

    // Check if user is owner or member
    const { data: member } = await supabase
      .from("trip_members")
      .select("id")
      .eq("trip_id", tripId)
      .eq("user_id", profileId)
      .single();

    if (trip.owner_id !== profileId && !member) {
      console.error('[Itinerary Chat API]', {
        path: '/api/trips/[tripId]/itinerary-chat',
        method: 'POST',
        tripId,
        profileId,
        error: 'Forbidden: User does not have access to this trip',
        check_failed: trip.owner_id !== profileId ? 'not_owner' : 'not_member',
        trip_owner_id: trip.owner_id,
        is_member: !!member,
        context: 'authorization_check',
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Rate limiting (after auth and trip access)
    const rateLimitCheck = await checkRateLimit(req, 'ASSISTANT', clerkUserId);
    if (!rateLimitCheck.allowed) {
      return rateLimitCheck.response;
    }

    // 2) Load existing itinerary
    const { data: row, error: fetchError } = await supabase
      .from('smart_itineraries')
      .select('content')
      .eq('trip_id', tripId)
      .single();

    if (fetchError || !row) {
      console.error('[itinerary-chat] missing itinerary', fetchError);
      return NextResponse.json({ error: 'no-itinerary' }, { status: 400 });
    }

    type ItineraryRowResult = {
      content: any
    }

    const rowTyped = row as ItineraryRowResult;
    const currentItinerary = rowTyped.content as unknown as SmartItinerary;

    // 3) Call OpenAI
    const system = `
You are an assistant that edits a JSON itinerary object.
ALWAYS reply with a JSON object containing an "itinerary" key with the updated itinerary.

The itinerary must match this TypeScript type:

${SMART_ITINERARY_SCHEMA_TEXT}

You are given the current itinerary JSON and a user request.
Modify ONLY the necessary parts (days, places, tips), keep ids stable when possible.
Do NOT change the overall structure (keys, arrays).

Return your response in this exact format:
{
  "itinerary": {
    "title": "...",
    "summary": "...",
    "days": [...],
    "tripTips": [...]
  }
}
`;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    
    let updated: SmartItinerary;
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Current itinerary JSON:\n${JSON.stringify(currentItinerary)}` },
          { role: 'user', content: `User request:\n${message}` },
        ],
        response_format: { type: 'json_object' }
      });

      const raw = response.choices[0]?.message?.content ?? '';
      
      if (!raw) {
        console.error('[itinerary-chat] Empty response from OpenAI');
        return NextResponse.json({ error: 'empty-response' }, { status: 500 });
      }

      // 4) Parse JSON response
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr) {
        console.error('[itinerary-chat] JSON parse error', raw, parseErr);
        return NextResponse.json({ error: 'bad-json' }, { status: 500 });
      }

      // Extract itinerary from response (handle both wrapped and direct formats)
      if (parsed.itinerary) {
        updated = parsed.itinerary as SmartItinerary;
      } else if (parsed.title && parsed.days) {
        // Direct SmartItinerary format (fallback)
        updated = parsed as SmartItinerary;
      } else {
        console.error('[itinerary-chat] Invalid response structure', parsed);
        return NextResponse.json({ error: 'invalid-structure' }, { status: 500 });
      }
    } catch (err: unknown) {
      console.error('[itinerary-chat] OpenAI API error', err);
      return NextResponse.json({ error: 'openai-error' }, { status: 500 });
    }

    // 5) Save back to Supabase
    const { data: updatedRow, error: updateError } = await (supabase
      .from('smart_itineraries') as any)
      .update({ content: updated as any })
      .eq('trip_id', tripId)
      .select()
      .single();

    if (updateError) {
      console.error('[itinerary-chat] supabase update error', updateError);
      return NextResponse.json({ error: 'db-error' }, { status: 500 });
    }

    // Return bare SmartItinerary directly (updated is already the SmartItinerary object)
    return NextResponse.json(updated);

  } catch (err) {
    console.error('[itinerary-chat] Error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
