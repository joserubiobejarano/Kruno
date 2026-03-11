import { NextResponse } from 'next/server';
import { sendWelcomeEmail } from '@/lib/email/resend';

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  try {
    const body = await request.json();
    const { to, firstName } = body;

    if (!to) {
      return NextResponse.json(
        { error: 'Missing required field: to' },
        { status: 400 }
      );
    }

    const result = await sendWelcomeEmail({ to, firstName });

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    console.error('POST /api/test/welcome-email error:', err);

    // Check if it's a missing API key error
    if (err.message?.includes('RESEND_API_KEY')) {
      return NextResponse.json(
        { error: 'Email service configuration error' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    );
  }
}

// Example usage:
// curl -X POST http://localhost:3000/api/test/welcome-email \
//   -H "Content-Type: application/json" \
//   -d '{"to":"YOUR_EMAIL","firstName":"Jose"}'
