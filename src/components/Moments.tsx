import { Link } from 'react-router-dom';
import type { Moment } from '../lib/moments';

function clock(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${Math.floor(s / 60)}:${ss}`;
}

// The best moments found, best first. On plans with an export limit, the rest are shown locked.
export default function Moments({ moments, exportable, planName }: { moments: Moment[]; exportable: number; planName: string }) {
  if (!moments.length) {
    return (
      <div className="card">
        <p className="muted">We couldn't find a moment that works on its own as a clip. Episodes with stories, opinions and lively conversation work best.</p>
      </div>
    );
  }
  const locked = Math.max(0, moments.length - exportable);
  return (
    <>
      <h2 className="moments-heading">
        {moments.length} best {moments.length === 1 ? 'moment' : 'moments'}
      </h2>
      <ol className="moments">
        {moments.map((m, i) => {
          const isLocked = i >= exportable;
          return (
            <li key={m.start} className={`card moment ${isLocked ? 'moment-locked' : ''}`}>
              <span className="moment-score" aria-label={`Score ${m.score} out of 100`}>
                {m.score}
              </span>
              <div className="moment-body">
                <b className="moment-title">{m.title}</b>
                <span className="moment-time">
                  {clock(m.start)}–{clock(m.end)} · {Math.round(m.end - m.start)}s
                </span>
                {!isLocked && (
                  <>
                    <q className="moment-hook">{m.hook}</q>
                    {m.reason && <span className="moment-reason">{m.reason}</span>}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {locked > 0 && (
        <p className="notice">
          The {planName} plan exports {exportable} clips per episode. <Link to="/#pricing">Upgrade to Pro</Link> to unlock
          the other {locked}.
        </p>
      )}
      <p className="muted small">Next up: preview, edit and export these clips.</p>
    </>
  );
}
