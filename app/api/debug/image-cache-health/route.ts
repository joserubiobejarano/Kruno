import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

const BUCKET_NAME = 'place-images';

/**
 * Health check endpoint for image caching system.
 * Disabled in production for security.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  try {
    // Check environment variables (booleans only, no secrets)
    const hasSupabaseUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
    const hasServiceRoleKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    const hasGoogleKey = !!process.env.GOOGLE_MAPS_API_KEY;
    const hasUnsplashKey = !!process.env.UNSPLASH_ACCESS_KEY;
    const hasMapboxToken = !!process.env.MAPBOX_ACCESS_TOKEN;

    let canListBuckets = false;
    let canAccessPlaceImagesBucket = false;
    let bucketError: string | null = null;

    // Test bucket access if we have service role key
    if (hasServiceRoleKey && hasSupabaseUrl) {
      try {
        const supabase = createSupabaseAdmin();
        
        // Test listing buckets
        const { data: buckets, error: listError } = await supabase.storage.listBuckets();
        
        if (listError) {
          bucketError = `Cannot list buckets: ${listError.message}`;
        } else {
          canListBuckets = true;
          
          // Check if place-images bucket exists
          const bucketExists = buckets?.some(b => b.name === BUCKET_NAME);
          
          if (bucketExists) {
            // Try to get bucket info
            const bucket = buckets.find(b => b.name === BUCKET_NAME);
            if (bucket) {
              canAccessPlaceImagesBucket = true;
              
              // Try to list files (just to verify access)
              const { error: listFilesError } = await supabase.storage
                .from(BUCKET_NAME)
                .list('', { limit: 1 });
              
              if (listFilesError) {
                bucketError = `Cannot access bucket files: ${listFilesError.message}`;
                canAccessPlaceImagesBucket = false;
              }
            }
          } else {
            bucketError = `Bucket "${BUCKET_NAME}" not found. Please create it in Supabase dashboard.`;
          }
        }
      } catch (error: any) {
        bucketError = `Error testing bucket access: ${error?.message || 'Unknown error'}`;
      }
    } else {
      bucketError = 'Cannot test bucket access: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL missing';
    }

    return NextResponse.json({
      // Environment variables
      hasSupabaseUrl,
      hasServiceRoleKey,
      hasGoogleKey,
      hasUnsplashKey,
      hasMapboxToken,
      
      // Bucket access
      canListBuckets,
      canAccessPlaceImagesBucket,
      bucketError,
      
      // Overall health
      healthy: hasSupabaseUrl && hasServiceRoleKey && canAccessPlaceImagesBucket,
      
      // Recommendations
      recommendations: [
        !hasSupabaseUrl && 'Add NEXT_PUBLIC_SUPABASE_URL to environment variables',
        !hasServiceRoleKey && 'Add SUPABASE_SERVICE_ROLE_KEY to environment variables (REQUIRED for uploads)',
        !hasGoogleKey && 'Add GOOGLE_MAPS_API_KEY for Google Places photos (optional but recommended)',
        !hasUnsplashKey && 'Add UNSPLASH_ACCESS_KEY for Unsplash fallback (optional)',
        !hasMapboxToken && 'Add MAPBOX_ACCESS_TOKEN for Mapbox fallback (optional)',
        !canAccessPlaceImagesBucket && bucketError && `Bucket issue: ${bucketError}`,
      ].filter(Boolean) as string[],
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || 'Unknown error',
        healthy: false,
      },
      { status: 500 }
    );
  }
}

