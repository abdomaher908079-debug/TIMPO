import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  checkEpisode,
  currentPeriod,
  effectivePlan,
  type LimitProblem,
  type Period,
  type ProfileRow,
  type Usage,
} from '../../supabase/functions/_shared/plans';
import { useAuth } from './auth';
import { planById, type Plan, type PlanId } from './plans';
import { supabase } from './supabase';

interface AccountValue {
  plan: Plan;
  profile: ProfileRow | null;
  period: Period;
  usage: Usage;
  // Cloud processing used this period (see server/).
  cloudUsage: Usage;
  loading: boolean;
  refresh(): Promise<void>;
  /** Whether an episode of this length fits what's left this period (the server checks again). */
  check(seconds: number, fingerprint?: string): LimitProblem | null;
  /** Demo mode only: usage is recorded in this browser, as the server would. */
  recordDemoEpisode(fingerprint: string, seconds: number): void;
  /** Demo mode only: switch plans without paying, to try the paid features. */
  setDemoPlan(plan: PlanId): void;
}

const AccountContext = createContext<AccountValue | null>(null);

const DEMO_KEY = 'hookcut_demo_account';
interface EpisodeRow {
  fingerprint: string;
  seconds: number;
  period_start: string;
}
interface DemoAccount {
  plan: PlanId;
  episodes: EpisodeRow[];
}

function readDemo(): DemoAccount {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) return JSON.parse(raw) as DemoAccount;
  } catch {
    // Blocked storage: start fresh.
  }
  return { plan: 'free', episodes: [] };
}

function writeDemo(account: DemoAccount) {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(account));
  } catch {
    // Demo usage just won't persist.
  }
}

const demoProfile = (plan: PlanId): ProfileRow => ({
  plan,
  billing: plan === 'free' ? null : 'monthly',
  subscription_status: plan === 'free' ? null : 'active',
  current_period_start: null,
  current_period_end: null,
  cancel_at: null,
});

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [cloudUsage, setCloudUsage] = useState<Usage>({ episodes: 0, seconds: 0 });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setEpisodes([]);
      setLoading(false);
      return;
    }
    if (!supabase) {
      const demo = readDemo();
      setProfile(demoProfile(demo.plan));
      setEpisodes(demo.episodes);
      setLoading(false);
      return;
    }
    const { data: p, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle<ProfileRow>();
    if (error) console.error('Profile unavailable', error);
    const plan = effectivePlan(p ?? null);
    const period = currentPeriod(plan, new Date(), { start: p?.current_period_start ?? null, end: p?.current_period_end ?? null });
    const { data: rows, error: rowsError } = await supabase
      .from('episodes')
      .select('fingerprint, seconds, period_start')
      .eq('period_start', period.start.toISOString());
    if (rowsError) console.error('Usage unavailable', rowsError);
    const { data: cloudRows } = await supabase
      .from('cloud_jobs')
      .select('seconds')
      .eq('period_start', period.start.toISOString());
    const cloud = (cloudRows as { seconds: number }[] | null) ?? [];
    setCloudUsage({ episodes: cloud.length, seconds: cloud.reduce((n, r) => n + Number(r.seconds), 0) });
    setProfile(p ?? null);
    setEpisodes((rows as EpisodeRow[] | null) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const value = useMemo<AccountValue>(() => {
    const planId = effectivePlan(profile);
    const period = currentPeriod(planId, new Date(), {
      start: profile?.current_period_start ?? null,
      end: profile?.current_period_end ?? null,
    });
    const start = period.start.getTime();
    const inPeriod = episodes.filter((e) => new Date(e.period_start).getTime() === start);
    const usage = { episodes: inPeriod.length, seconds: inPeriod.reduce((n, e) => n + Number(e.seconds), 0) };
    return {
      plan: planById(planId),
      profile,
      period,
      usage,
      cloudUsage,
      loading,
      refresh,
      check: (seconds, fp) => (fp && inPeriod.some((e) => e.fingerprint === fp) ? null : checkEpisode(planId, usage, seconds)),
      recordDemoEpisode(fp, seconds) {
        if (supabase) return;
        const demo = readDemo();
        if (!demo.episodes.some((e) => e.fingerprint === fp && new Date(e.period_start).getTime() === start)) {
          demo.episodes.push({ fingerprint: fp, seconds, period_start: period.start.toISOString() });
          writeDemo(demo);
        }
        void refresh();
      },
      setDemoPlan(plan) {
        if (supabase) return;
        writeDemo({ ...readDemo(), plan });
        void refresh();
      },
    };
  }, [profile, episodes, cloudUsage, loading, refresh]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used inside <AccountProvider>');
  return ctx;
}
