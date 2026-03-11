import { NextResponse } from 'next/server';
import { sendProUpgradeEmail } from '@/lib/email/resend';

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  try {
    const body = await request.json();
    const { to, firstName, billingUrl, language } = body;

    if (!to) {
      return NextResponse.json(
        { error: 'Missing required field: to' },
        { status: 400 }
      );
    }

    const appUrl = process.env.APP_URL || 'https://kruno.app';
    const resolvedBillingUrl = billingUrl || `${appUrl}/settings/billing`;

    const result = await sendProUpgradeEmail({
      userEmail: to,
      firstName,
      billingUrl: resolvedBillingUrl,
      language,
    });

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    console.error('POST /api/test/pro-upgrade-email error:', err);

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
