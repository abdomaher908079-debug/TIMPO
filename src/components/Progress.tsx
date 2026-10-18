import { useEffect, useRef, useState } from 'react';
import IslaOrb, { type IslaMood } from './IslaOrb';
import Meter from './Meter';

export type StepState = 'waiting' | 'active' | 'done' | 'blocked';

export interface Step {
  label: string;
  state: StepState;
  detail?: string;
}

/** What Isla is doing, from the step that's running. */
function islaFor(steps: Step[]): { mood: IslaMood; text: string } {
  const active = steps.find((s) => s.state === 'active')?.label ?? '';
  if (/finding/i.test(active)) return { mood: 'found', text: 'Isla is picking the best moments…' };
  if (/listening/i.test(active)) return { mood: 'listening', text: 'Isla is listening to every word…' };
  if (/sending/i.test(active)) return { mood: 'idle', text: 'Isla is getting your audio…' };
  return { mood: 'idle', text: 'Isla is getting ready…' };
}

export default function Progress({ steps, percent, onCancel, file }: { steps: Step[]; percent: number; onCancel?: () => void; file?: File }) {
  const lit = Math.round((percent / 100) * 40);
  const isla = islaFor(steps);
  return (
    <section className="card progress-card" aria-live="polite">
      {file && <IslaWatching file={file} mood={isla.mood} />}
      <p className="isla-status">{isla.text}</p>
      <Meter bars={40} peaks={Array.from({ length: lit }, (_, i) => i)} className="meter-progress" />
      <p className="progress-percent">{Math.round(percent)}%</p>
      <ol className="progress-steps">
        {steps.map((s) => (
          <li key={s.label} className={`step-${s.state}`}>
            <span className="step-dot" aria-hidden="true" />
            <span>
              {s.label}
              {s.detail && <span className="step-detail">{s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {onCancel && (
        <button type="button" className="btn btn-outline" onClick={onCancel}>
          Cancel
        </button>
      )}
    </section>
  );
}

/**
 * Isla floating beside a still of the episode, eyes on it while she works. The video isn't played (that
 * would slow the listening down): one frame is shown, with a scan line passing over it.
 */
function IslaWatching({ file, mood }: { file: File; mood: IslaMood }) {
  const [url, setUrl] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const orb = useRef<HTMLDivElement>(null);
  const [look, setLook] = useState({ x: 0.6, y: 0.6 });
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  // Her eyes stay on the video while she drifts around it.
  useEffect(() => {
    let frame = 0;
    const track = () => {
      const o = orb.current?.getBoundingClientRect();
      const v = video.current?.getBoundingClientRect();
      if (o && v) {
        const dx = v.left + v.width / 2 - (o.left + o.width / 2);
        const dy = v.top + v.height / 2 - (o.top + o.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        setLook((l) => {
          const next = { x: dx / d, y: dy / d };
          return Math.abs(next.x - l.x) + Math.abs(next.y - l.y) > 0.05 ? next : l;
        });
      }
      frame = requestAnimationFrame(track);
    };
    frame = requestAnimationFrame(track);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div className="isla-studio">
      <div className="isla-screen">
        {url && (
          <video
            ref={video}
            src={url}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              v.currentTime = Math.min(30, v.duration * 0.2 || 0);
            }}
          />
        )}
        <span className={`isla-scan ${mood === 'found' ? 'isla-scan-found' : ''}`} aria-hidden="true" />
      </div>
      <div ref={orb} className="isla-drift">
        <IslaOrb size={64} mood={mood} look={look} />
      </div>
    </div>
  );
}
