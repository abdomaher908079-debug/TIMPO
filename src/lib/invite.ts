import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';

// Invite rewards (supabase/migrations/20261031000000_invites.sql): a link like islaclips.com/?invite=abc123.
// The code is kept in this browser until the visitor signs up, then claimed once for their new account.
// Both get the reward when the new person makes their first episode.
const KEY = 'isla_invite';
export const INVITE_REWARD = { hours: 3, episodes: 3, days: 60 };

/** Keeps ?invite=… from the address for after sign-up. */
export function captureInvite() {
  const code = new URLSearchParams(window.location.search).get('invite');
  if (!code || !/^[a-z0-9]{4,16}$/i.test(code)) return;
  try {
    localStorage.setItem(KEY, code.toLowerCase());
  } catch {
    // Private mode: the invite just won't count.
  }
}

export function pendingInvite(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Once signed in, records who invited this account (the server only accepts it for new accounts). */
export function useClaimInvite() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user || !supabase) return;
    const db = supabase;
    void (async () => {
      // From this browser, or saved with the account at sign-up (the confirmation link may open elsewhere).
      const { data } = await db.auth.getUser();
      const code = pendingInvite() ?? (data.user?.user_metadata?.invite as string | undefined);
      if (!code) return;
      const { error } = await db.rpc('claim_invite', { p_code: code });
      if (error) return;
      try {
        localStorage.removeItem(KEY);
      } catch {
        // Nothing to clean up.
      }
      if (data.user?.user_metadata?.invite) await db.auth.updateUser({ data: { invite: null } });
    })();
  }, [user]);
}

export interface MyInvite {
  code: string;
  joined: number;
  rewarded: number;
}

/** This account's invite link and how it's doing. */
export function useMyInvite(): MyInvite | null {
  const { user } = useAuth();
  const [invite, setInvite] = useState<MyInvite | null>(null);
  useEffect(() => {
    if (!user || !supabase) return;
    void supabase.rpc('my_invite').then(({ data }) => data && setInvite(data as MyInvite));
  }, [user]);
  return invite;
}

export const inviteLink = (code: string) => `https://islaclips.com/?invite=${code}`;
