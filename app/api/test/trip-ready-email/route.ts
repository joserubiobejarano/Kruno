import { NextResponse } from 'next/server';
import { sendTripReadyEmail } from '@/lib/email/resend';

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  try {
    const body = await request.json();
    const { to, firstName, tripName, tripCity, tripUrl, language } = body;

    if (!to) {
      return NextResponse.json(
        { error: 'Missing required field: to' },
        { status: 400 }
      );
    }

    if (!tripName || !tripCity) {
      return NextResponse.json(
        { error: 'Missing required fields: tripName, tripCity' },
        { status: 400 }
      );
    }

    const appUrl = process.env.APP_URL || 'https://kruno.app';
    const resolvedTripUrl = tripUrl || `${appUrl}/trips/example-trip`;

    const result = await sendTripReadyEmail({
      userEmail: to,
      firstName,
      tripName,
      tripCity,
      tripUrl: resolvedTripUrl,
      language,
    });

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    console.error('POST /api/test/trip-ready-email error:', err);

    if (err.message?.includes('RESEND_API_KEY')) {
      return NextResponse.json(
        { error: 'Email service configuration error' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: err.message || 'Failed to send email' },
      { status: 500 }
    );
  }
}
