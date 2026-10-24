import { useEffect, useState } from 'react';
import { paymentsOpen } from '../lib/billing';
import { LEGAL } from '../lib/brand';

// Public status page: each part of Isla, checked live from this browser every minute. Counts only,
// nothing personal (see supabase/functions/status).

type Level = 'ok' | 'busy' | 'down' | 'off' | 'checking';
interface Row {
  name: string;
  level: Level;
  note: string;
}

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const WORDS: Record<Level, string> = { ok: 'Working', busy: 'Busy', down: 'Down', off: 'Coming soon', checking: 'Checking…' };
const WHEN = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

interface Health {
  database: boolean;
  waiting?: number;
  finishedLastHour?: number;
  failedLastHour?: number;
}

async function check(): Promise<Row[]> {
  const [auth, health] = await Promise.all([
    URL_BASE && ANON
      ? fetch(`${URL_BASE}/auth/v1/health`, { headers: { apikey: ANON } }).then((r) => r.ok, () => false)
      : Promise.resolve(false),
    URL_BASE
      ? fetch(`${URL_BASE}/functions/v1/status`).then((r) => (r.ok ? (r.json() as Promise<Health>) : null), () => null)
      : Promise.resolve(null),
  ]);
  const failing = !!health && (health.failedLastHour ?? 0) >= 3 && (health.failedLastHour ?? 0) > (health.finishedLastHour ?? 0);
  const waiting = health?.waiting ?? 0;
  return [
    { name: 'Website', level: 'ok', note: 'islaclips.com is up.' },
    { name: 'Accounts & sign-in', level: auth ? 'ok' : 'down', note: auth ? 'Signing up and logging in work.' : "Sign-in isn't answering right now." },
    {
      name: 'Saving your work',
      level: health?.database ? 'ok' : 'down',
      note: health?.database ? 'Episodes, clips and edits are saved.' : "Saving isn't answering right now. Your clips on this device are safe.",
    },
    {
      name: 'AI (finding the best moments)',
      level: !health ? 'down' : waiting ? 'busy' : 'ok',
      note: !health
        ? "We can't reach it right now."
        : waiting
          ? `Today's AI limit is reached. ${waiting} episode${waiting === 1 ? ' is' : 's are'} waiting in line and will finish on ${waiting === 1 ? 'its' : 'their'} own, usually within a few hours.`
          : 'Finding moments normally.',
    },
    {
      name: 'Listening on phones (cloud)',
      level: !health ? 'down' : failing ? 'busy' : waiting ? 'busy' : 'ok',
      note: !health
        ? "We can't reach it right now. Computers can still listen on the device."
        : failing
          ? 'Some episodes are failing. Try again in a little while, or use a computer.'
          : waiting
            ? 'New episodes wait in line for the AI and finish on their own.'
            : 'Listening normally.',
    },
    {
      name: 'Payments',
      level: paymentsOpen ? 'ok' : 'off',
      note: paymentsOpen ? 'Checkout works.' : 'Pro and Studio open soon. The Free plan is open now.',
    },
  ];
}

export default function StatusPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  useEffect(() => {
    let live = true;
    const run = () =>
      void check().then((r) => {
        if (!live) return;
        setRows(r);
        setAt(new Date());
      });
    run();
    const timer = setInterval(run, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const levels = rows?.map((r) => r.level) ?? [];
  const overall: Level = !rows ? 'checking' : levels.includes('down') ? 'down' : levels.includes('busy') ? 'busy' : 'ok';
  const headline = { ok: 'Everything is working', busy: 'Isla is busy, but working', down: 'Part of Isla is down', off: '', checking: 'Checking…' }[overall];
  return (
    <main className="status-page">
      <h1 className="page-title">Status</h1>
      <div className={`card status-banner status-${overall}`} role="status">
        <span className="status-dot" />
        <b>{headline}</b>
        {at && <span className="muted small">Checked at {WHEN.format(at)} · updates every minute</span>}
      </div>
      <ul className="card status-list">
        {(rows ?? []).map((r) => (
          <li key={r.name} className="status-row">
            <div>
              <b>{r.name}</b>
              <p className="muted small">{r.note}</p>
            </div>
            <span className={`status-pill status-${r.level}`}>
              <span className="status-dot" />
              {WORDS[r.level]}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Something wrong that isn't shown here? Email <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>.
      </p>
    </main>
  );
}
