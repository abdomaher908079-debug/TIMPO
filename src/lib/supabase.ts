import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Null in demo mode (no Supabase keys): logins, plans and usage are faked in this browser.
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

// The current session's token, sent to our API so it can check who's asking.
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Calls one of our Supabase Edge Functions as the signed-in user. */
export async function callFunction<T>(name: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: anonKey ?? '' };
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error('We couldn’t reach our server. Check your internet connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; reason?: string };
  if (!res.ok) throw new ApiError(data.error ?? 'Something went wrong. Please try again.', res.status, data.reason);
  return data;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
  }
}
