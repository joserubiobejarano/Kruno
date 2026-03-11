import { NextResponse } from 'next/server';

/**
 * Debug endpoint to test GET requests.
 * Disabled in production for security.
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
  });
}
