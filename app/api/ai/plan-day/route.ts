import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIClient } from '@/lib/openai'
import { requireTripAccess, tripAccessErrorResponse } from '@/lib/auth/require-trip-access'
import { checkRateLimit } from '@/lib/rate-limit/rate-limit-middleware'
import type { PlannedActivity } from '@/types/ai'

type TripQueryResult = {
  title: string
  start_date: string
  end_date: string
  budget_level: string | null
  daily_budget: number | null
  default_currency: string
  interests: string[] | null
  destination_name: string | null
  destination_country: string | null
}

type DayQueryResult = {
  date: string
  day_number: number
}

type ActivityQueryResult = {
  title: string
  start_time: string | null
  end_time: string | null
  notes: string | null
}

export async function POST(request: NextRequest) {
  try {
    // tripId and dayId are validated below; trip access is enforced via requireTripAccess
    const body = await request.json()
    const { tripId, dayId } = body

    if (!tripId || !dayId) {
      return NextResponse.json(
        { error: 'tripId and dayId are required' },
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

    // Load trip data (access already verified)
    const { data: tripData, error: tripError } = await supabase
      .from('trips')
      .select(
        'title, start_date, end_date, budget_level, daily_budget, default_currency, interests, destination_name, destination_country'
      )
      .eq('id', tripId)
      .single()

    if (tripError || !tripData) {
      return NextResponse.json(
        { error: 'Trip not found' },
        { status: 404 }
      )
    }

    const trip = tripData as TripQueryResult

    // Load day data to get the date
    const { data: dayData, error: dayError } = await supabase
      .from('days')
      .select('date, day_number')
      .eq('id', dayId)
      .single()

    if (dayError || !dayData) {
      return NextResponse.json(
        { error: 'Day not found' },
        { status: 404 }
      )
    }

    const day = dayData as DayQueryResult

    // Load existing activities for this day
    const { data: existingActivitiesData, error: activitiesError } = await supabase
      .from('activities')
      .select('title, start_time, end_time, notes')
      .eq('day_id', dayId)
      .order('start_time', { ascending: true })

    if (activitiesError) {
      console.error('Error loading activities:', activitiesError)
    }

    const existingActivities = (existingActivitiesData || []) as ActivityQueryResult[]

    // Build the prompt
    // Use destination_name if available, otherwise fall back to title
    const city = trip.destination_name || trip.title
    const country = trip.destination_country || null
    const interestsText = trip.interests?.length
      ? `Interests: ${trip.interests.join(', ')}`
      : ''
    const budgetText = trip.budget_level
      ? `Budget level: ${trip.budget_level}${trip.daily_budget ? ` (${trip.daily_budget} ${trip.default_currency || 'USD'}/day)` : ''}`
      : ''
    const existingActivitiesText =
      existingActivities && existingActivities.length > 0
        ? `\n\nExisting activities for this day:\n${existingActivities
            .map(
              (a) =>
                `- ${a.title}${a.start_time ? ` (${a.start_time}${a.end_time ? ` - ${a.end_time}` : ''})` : ''}`
            )
            .join('\n')}`
        : ''

    const prompt = `You are helping plan a day for Kruno, a travel planning application.

Trip Details:
- Destination: ${city}${country ? `, ${country}` : ''}
- Date: ${new Date(day.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })}
- Trip dates: ${new Date(trip.start_date).toLocaleDateString()} to ${new Date(trip.end_date).toLocaleDateString()}
${budgetText ? `- ${budgetText}` : ''}
${interestsText ? `- ${interestsText}` : ''}${existingActivitiesText}

Please suggest 3-6 activities for this day that:
1. Are appropriate for the destination and date
2. Fit within the budget level if specified
3. Align with the user's interests if provided
4. Don't conflict with existing activities
5. Have realistic start and end times in 24-hour format
6. Include a variety of categories (Sightseeing, Food, Nightlife, Culture, Adventure, etc.)

Return ONLY a JSON array with this exact TypeScript shape (no markdown, no code blocks, just the JSON array):
type PlannedActivity = {
  title: string;
  start_time: string; // 24h format e.g. "09:00"
  end_time: string;   // 24h format
  category: string;   // e.g. "Sightseeing", "Food", "Nightlife"
  notes: string;
};

Return the activities in chronological order.`

    // Call OpenAI
    const openai = getOpenAIClient()
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful travel planning assistant. Always return a JSON object with an "activities" key containing an array of activities. No markdown formatting.',
        },
        {
          role: 'user',
          content: prompt + '\n\nReturn the JSON in this format: { "activities": [...] }',
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
    let parsedResponse: { activities?: PlannedActivity[] }
    try {
      parsedResponse = JSON.parse(responseContent)
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError)
      console.error('Response content:', responseContent)
      throw new Error('Failed to parse OpenAI response as JSON')
    }

    // Extract activities array
    const activities: PlannedActivity[] = parsedResponse.activities || []

    if (!Array.isArray(activities) || activities.length === 0) {
      throw new Error('Invalid activities format from OpenAI')
    }

    // Validate activities structure
    for (const activity of activities) {
      if (
        !activity.title ||
        !activity.start_time ||
        !activity.end_time ||
        !activity.category
      ) {
        throw new Error('Invalid activity structure from OpenAI')
      }
    }

    return NextResponse.json({ activities })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const res = tripAccessErrorResponse(error)
    if (res.status !== 500) return res
    console.error('Error in /api/ai/plan-day:', error)
    return NextResponse.json(
      { error: 'An error occurred while planning the day' },
      { status: 500 }
    )
  }
}

