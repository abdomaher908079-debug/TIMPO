// Supabase Edge Function: GET → how Isla's parts are doing, for the public status page (/status).
// No sign-in needed and nothing personal: counts only. Deploy with --no-verify-jwt.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const count = async (query: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  };
  let body: Record<string, unknown>;
  try {
    const jobs = () => admin.from('listen_jobs').select('id', { count: 'exact', head: true });
    const [waiting, finished, failed] = await Promise.all([
      // Episodes waiting for the AI's daily limit to reset.
      count(jobs().not('waiting_until', 'is', null).in('status', ['listening', 'finishing'])),
      count(jobs().gte('updated_at', hourAgo).eq('status', 'done').is('error', null)),
      count(jobs().gte('updated_at', hourAgo).or('status.eq.error,error.not.is.null').neq('error', 'Canceled.')),
    ]);
    body = { database: true, waiting, finishedLastHour: finished, failedLastHour: failed, checkedAt: new Date().toISOString() };
  } catch (err) {
    console.error(err);
    body = { database: false, checkedAt: new Date().toISOString() };
  }
  return new Response(JSON.stringify(body), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
  });
});
