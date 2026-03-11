import { NextRequest, NextResponse } from 'next/server';
import { cachePlaceImageWithDetails, type CachePlaceImageParams } from '@/lib/images/cache-place-image';
import { requireTripAccess, tripAccessErrorResponse } from '@/lib/auth/require-trip-access';
import { createClient } from '@/lib/supabase/server';

const isDev = process.env.NODE_ENV === 'development';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const body = await request.json();
    const { tripId, placeId, title, city, country, photoRef, lat, lng } = body;

    // Validate required fields
    if (!tripId || !title) {
      return NextResponse.json(
        { error: 'Missing required fields: tripId and title are required' },
        { status: 400 }
      );
    }

    // Verify user has access to the trip
    await requireTripAccess(tripId, supabase);

    // Cache the image with detailed result
    const params: CachePlaceImageParams = {
      tripId,
      placeId,
      title,
      city,
      country,
      photoRef,
      lat,
      lng,
    };

    const result = await cachePlaceImageWithDetails(params);

    // Log full details server-side (both dev and prod)
    console.log('[cache-place-image API] Result:', {
      providerUsed: result.providerUsed,
      uploadOk: result.uploadOk,
      hasPublicUrl: !!result.publicUrl,
      error: result.error,
      title: title.substring(0, 50),
    });

    // Return different response format for dev vs prod
    if (isDev) {
      // Dev: return full details
      return NextResponse.json({
        providerUsed: result.providerUsed,
        uploadOk: result.uploadOk,
        publicUrl: result.publicUrl,
        error: result.error,
        image_url: result.publicUrl, // Also include for backward compatibility
      });
    } else {
      // Prod: return minimal response
      return NextResponse.json({
        publicUrl: result.publicUrl,
        providerUsed: result.providerUsed,
        image_url: result.publicUrl, // Also include for backward compatibility
      });
    }
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error;
    const res = tripAccessErrorResponse(error);
    if (res.status !== 500) return res;
    console.error('[cache-place-image API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to cache place image' },
      { status: 500 }
    );
  }
}
