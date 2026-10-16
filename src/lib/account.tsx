import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  checkEpisode,
  currentPeriod,
  limitProblem,
  PICKS_PER_EPISODE,
  type LimitProblem,
  type Period,
  type ProfileRow,
  type Usage,
  type WorkspaceRow,
} from '../../supabase/functions/_shared/plans';
import { useAuth } from './auth';
import { planById, type Plan, type PlanId } from './plans';
import { supabase } from './supabase';

interface AccountValue {
  // The plan you work under: your own, or your Studio team's.
  plan: Plan;
  // Your own subscription (billing details on the Account page).
  profile: ProfileRow | null;
  // Who pays: you, or the Studio owner whose team you're in.
  workspace: WorkspaceRow | null;
  period: Period;
  usage: Usage;
  // Cloud listening used this period (the transcribe function).
  cloudUsage: Usage;
  // What's left in the workspace's hour packs (paid plans), and when the soonest one expires.
  packs: Usage & { expires: Date | null };
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
  // AI picks of this episode in the period (missing in demo mode).
  picks?: number;
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
  const [workspace, setWorkspace] = useState<WorkspaceRow | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [cloudUsage, setCloudUsage] = useState<Usage>({ episodes: 0, seconds: 0 });
  const [packs, setPacks] = useState<Usage & { expires: Date | null }>({ episodes: 0, seconds: 0, expires: null });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setWorkspace(null);
      setEpisodes([]);
      setLoading(false);
      return;
    }
    if (!supabase) {
      const demo = readDemo();
      const p = demoProfile(demo.plan);
      setProfile(p);
      setWorkspace({ ...p, owner_id: user.id, is_team_member: false });
      setEpisodes(demo.episodes);
      setLoading(false);
      return;
    }
    const [{ data: p, error }, { data: w, error: wError }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle<ProfileRow>(),
      supabase.rpc('my_workspace').maybeSingle<WorkspaceRow>(),
    ]);
    if (error) console.error('Profile unavailable', error);
    if (wError) console.error('Workspace unavailable', wError);
    const ws = w ?? null;
    const plan = ws?.plan ?? 'free';
    const wsId = ws?.owner_id ?? user.id;
    const period = currentPeriod(plan, new Date(), { start: ws?.current_period_start ?? null, end: ws?.current_period_end ?? null });
    const { data: rows, error: rowsError } = await supabase
      .from('episodes')
      .select('fingerprint, seconds, period_start, picks')
      .eq('workspace_id', wsId)
      .eq('period_start', period.start.toISOString());
    if (rowsError) console.error('Usage unavailable', rowsError);
    const { data: cloudRows } = await supabase
      .from('cloud_jobs')
      .select('seconds')
      .eq('workspace_id', wsId)
      .eq('period_start', period.start.toISOString());
    const { data: packRows } = await supabase
      .from('hour_packs')
      .select('seconds_left, episodes_left, expires_at')
      .eq('workspace_id', wsId)
      .is('refunded_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at');
    const live = ((packRows as { seconds_left: number; episodes_left: number; expires_at: string }[] | null) ?? []).filter(
      (r) => Number(r.seconds_left) > 0 || r.episodes_left > 0,
    );
    setPacks({
      seconds: live.reduce((n, r) => n + Number(r.seconds_left), 0),
      episodes: live.reduce((n, r) => n + r.episodes_left, 0),
      expires: live.length ? new Date(live[0]!.expires_at) : null,
    });
    const cloud = (cloudRows as { seconds: number }[] | null) ?? [];
    setCloudUsage({ episodes: cloud.length, seconds: cloud.reduce((n, r) => n + Number(r.seconds), 0) });
    setProfile(p ?? null);
    setWorkspace(ws);
    setEpisodes((rows as EpisodeRow[] | null) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const value = useMemo<AccountValue>(() => {
    const planId = workspace?.plan ?? 'free';
    const period = currentPeriod(planId, new Date(), {
      start: workspace?.current_period_start ?? null,
      end: workspace?.current_period_end ?? null,
    });
    const start = period.start.getTime();
    const inPeriod = episodes.filter((e) => new Date(e.period_start).getTime() === start);
    const usage = { episodes: inPeriod.length, seconds: inPeriod.reduce((n, e) => n + Number(e.seconds), 0) };
    return {
      plan: planById(planId),
      profile,
      workspace,
      period,
      usage,
      cloudUsage,
      packs,
      loading,
      refresh,
      check: (seconds, fp) => {
        // The same episode again is a re-pick: no new episode or time, but only a few per period.
        const seen = fp ? inPeriod.find((e) => e.fingerprint === fp) : undefined;
        if (!seen) return checkEpisode(planId, usage, seconds, packs);
        return (seen.picks ?? 1) >= PICKS_PER_EPISODE ? limitProblem(planId, 'no-repicks-left', seconds) : null;
      },
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
  }, [profile, workspace, episodes, cloudUsage, packs, loading, refresh]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used inside <AccountProvider>');
  return ctx;
}
