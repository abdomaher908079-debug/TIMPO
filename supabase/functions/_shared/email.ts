// Emails from Isla to an account (plan reminders, owner-page changes), sent through Brevo's API
// (secret BREVO_API_KEY). Without the key nothing is sent and send() returns false.
export const SITE = 'https://islaclips.com';
const FROM = { name: 'Isla', email: 'support@islaclips.com' };

export const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A paragraph of the letter. `text` is trusted HTML written here, never user input. */
export const p = (text: string) => `<p style="margin:0 0 14px;font:16px/1.5 Arial,sans-serif;color:#3a2a1e">${text}</p>`;

export const button = (text: string, href: string) =>
  `<p style="margin:22px 0"><a href="${href}" style="background:#f2600d;color:#fff;text-decoration:none;font:bold 16px Arial,sans-serif;padding:12px 22px;border-radius:10px;display:inline-block">${text}</a></p>`;

export const sign = p('Isla<br><a href="mailto:support@islaclips.com" style="color:#f2600d">support@islaclips.com</a>');

export interface Letter {
  subject: string;
  html: string;
}

export async function send(to: string, { subject, html }: Letter): Promise<boolean> {
  const key = Deno.env.get('BREVO_API_KEY');
  if (!key || !to) return false;
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: FROM, replyTo: FROM, to: [{ email: to }], subject, htmlContent: html }),
    });
    if (!res.ok) console.error('Brevo', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (err) {
    console.error('Brevo', err);
    return false;
  }
}
