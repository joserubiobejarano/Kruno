import { NextResponse } from 'next/server';
import { sendSubscriptionCanceledEmail } from '@/lib/email/resend';

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  try {
    const body = await request.json();
    const { to, firstName, language } = body;

    if (!to) {
      return NextResponse.json(
        { error: 'Missing required field: to' },
        { status: 400 }
      );
    }

    const result = await sendSubscriptionCanceledEmail({
      userEmail: to,
      firstName,
      language,
    });

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    console.error('POST /api/test/subscription-canceled-email error:', err);

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
