// Cloudflare Pages Function: GET /api/country → { country } of the visitor, from Cloudflare's own
// network (no third-party lookup). The pricing page uses it to hide payment buttons where paid plans
// aren't sold; the server checks again when a payment starts (create-invoice.ts).
interface Context {
  request: Request & { cf?: { country?: string } };
}

export function onRequestGet({ request }: Context): Response {
  return new Response(JSON.stringify({ country: request.cf?.country ?? null }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
}
