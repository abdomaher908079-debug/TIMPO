// Where people heard about Isla: the link they first arrived from (?ref=tiktok, or utm_source=…), kept in this
// browser until they sign up, and their own answer to "How did you hear about Isla?" (components/SourceQuestion).
// Both go to signup_sources; the owner page counts them.
import { useEffect } from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';

const KEY = 'isla_ref';
// Like invites, only accounts made in the last few days are credited to the link this browser arrived with.
const NEW_ACCOUNT_DAYS = 3;

const cleanRef = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60);

/** Keeps the first ?ref= / utm_source= this browser arrived with. */
export function captureRef() {
  const params = new URLSearchParams(window.location.search);
  const ref = cleanRef(params.get('ref') ?? params.get('utm_source'));
  if (!ref) return;
  try {
    if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, ref);
  } catch {
    // Private mode: we just won't know.
  }
}

export function storedRef(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const SOURCES: [string, string][] = [
  ['tiktok', 'TikTok'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
  ['reddit', 'Reddit'],
  ['product_hunt', 'Product Hunt'],
  ['google', 'Google search'],
  ['friend', 'A friend'],
  ['creator', 'A creator or podcaster'],
  ['other', 'Other'],
];

/**
 * Once signed in, notes the link a new account came from, whether or not they answer "How did you hear about
 * Isla?". From this browser, or saved with the account at sign-up (the confirmation link may open elsewhere).
 */
export function useRecordRef() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user || !supabase) return;
    const db = supabase;
    void (async () => {
      const { data } = await db.auth.getUser();
      const created = data.user?.created_at ? new Date(data.user.created_at).getTime() : 0;
      if (Date.now() - created > NEW_ACCOUNT_DAYS * 86_400_000) return;
      const ref = storedRef() ?? cleanRef(data.user?.user_metadata?.ref);
      if (!ref) return;
      // Only the first time; an answer given later keeps the link.
      await db.from('signup_sources').upsert({ user_id: user.id, ref }, { onConflict: 'user_id', ignoreDuplicates: true });
    })();
  }, [user]);
}

/** The link to save with the account at sign-up. */
export const refForSignup = () => storedRef() ?? undefined;
