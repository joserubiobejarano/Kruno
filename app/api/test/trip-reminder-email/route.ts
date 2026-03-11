import { NextResponse } from 'next/server';
import { sendTripReminderEmail } from '@/lib/email/resend';

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  try {
    const body = await request.json();
    const { to, firstName, tripCity, tripStartDate, tripUrl, language } = body;

    if (!to) {
      return NextResponse.json(
        { error: 'Missing required field: to' },
        { status: 400 }
      );
    }

    if (!tripCity || !tripStartDate) {
      return NextResponse.json(
        { error: 'Missing required fields: tripCity, tripStartDate' },
        { status: 400 }
      );
    }

    const appUrl = process.env.APP_URL || 'https://kruno.app';
    const resolvedTripUrl = tripUrl || `${appUrl}/trips/example-trip`;

    const result = await sendTripReminderEmail({
      userEmail: to,
      firstName,
      tripCity,
      tripStartDate,
      tripUrl: resolvedTripUrl,
      language,
    });

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    console.error('POST /api/test/trip-reminder-email error:', err);

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
