import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findBestAccommodation } from "@/lib/google/accommodation";
import { requireTripAccess, tripAccessErrorResponse } from "@/lib/auth/require-trip-access";
import type { Database, Json } from "@/types/database";

type TripUpdate = Database["public"]["Tables"]["trips"]["Update"];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tripId } = body;

    if (!tripId) {
      return NextResponse.json(
        { error: "tripId is required" },
        { status: 400 }
      );
    }

    // Use server-side API key only (no NEXT_PUBLIC fallback for security)
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.error('[accommodation-find] Google Maps API key not configured (server key missing)');
      return NextResponse.json(
        { error: "Google Maps API key not configured" },
        { status: 500 }
      );
    }

    const supabase = await createClient();

    // Verify user has access to trip
    await requireTripAccess(tripId, supabase);

    // Load trip data
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("destination_name, center_lat, center_lng")
      .eq("id", tripId)
      .single<{
        destination_name: string | null;
        center_lat: number | null;
        center_lng: number | null;
      }>();

    if (tripError || !trip) {
      return NextResponse.json(
        { error: "Trip not found" },
        { status: 404 }
      );
    }

    if (!trip.destination_name) {
      return NextResponse.json(
        { error: "Trip destination not set" },
        { status: 400 }
      );
    }

    // Find best accommodation
    const accommodation = await findBestAccommodation(
      trip.destination_name,
      apiKey
    );

    if (!accommodation) {
      return NextResponse.json(
        { error: "No accommodation found" },
        { status: 404 }
      );
    }

    // Save to trip - use type assertion to work around Supabase type inference issue
    const updateSupabase = await createClient();
    const { error: updateError } = await updateSupabase
      .from("trips")
      // @ts-expect-error - Supabase type inference fails here, but the types are correct at runtime
      .update({
        auto_accommodation: accommodation,
      })
      .eq("id", tripId);

    if (updateError) {
      console.error("Error updating trip with accommodation:", updateError);
      return NextResponse.json(
        { error: "Failed to save accommodation" },
        { status: 500 }
      );
    }

    return NextResponse.json({ accommodation });
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error;
    const res = tripAccessErrorResponse(error);
    if (res.status !== 500) return res;
    console.error("Error in /api/accommodation/find:", error);
    return NextResponse.json(
      { error: "Failed to find accommodation" },
      { status: 500 }
    );
  }
}

