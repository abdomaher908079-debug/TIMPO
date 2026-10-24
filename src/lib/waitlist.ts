import type { PlanId } from '../../supabase/functions/_shared/plans';
import { supabase } from './supabase';

export type WaitlistPlan = Exclude<PlanId, 'free'>;

/** The plan this person asked to hear about, or null. */
export async function waitlistPlan(userId: string): Promise<WaitlistPlan | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('pro_waitlist').select('plan').eq('user_id', userId).maybeSingle<{ plan: WaitlistPlan }>();
  return data?.plan ?? null;
}

/** Asks to be emailed when paid plans open (one entry per person; the latest plan wins). */
export async function joinWaitlist(userId: string, email: string, plan: WaitlistPlan): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('pro_waitlist').upsert({ user_id: userId, email, plan });
  if (error) throw new Error('We couldn’t save that. Please try again.');
}
