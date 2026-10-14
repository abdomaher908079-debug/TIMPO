import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ClipEditor from './ClipEditor';
import { clock, type Clip } from '../lib/clips';
import type { Segment } from '../lib/speech';

interface Props {
  file: File;
  duration: number;
  segments: Segment[];
  clips: Clip[];
  onChange: (clips: Clip[]) => void;
  exportable: number;
  planName: string;
}

// Frames are taken a moment in, past any cut at the very start of the clip.
const thumbTime = (c: Clip) => c.start + Math.min(1, (c.end - c.start) / 4);

// All the clips found, best first. On plans with an export limit, the rest are shown locked.
export default function ClipsScreen({ file, duration, segments, clips, onChange, exportable, planName }: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [upsell, setUpsell] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Thumbnails follow trims: re-fetch the frames whose time changed. Keyed by time so unchanged
  // clips keep theirs.
  const wanted = clips.map(thumbTime);
  const missing = [...new Set(wanted.map((t) => t.toFixed(2)))].filter((k) => !thumbs[k]);
  const missingKey = missing.join(',');
  useEffect(() => {
    if (!missingKey || editing !== null) return;
    const abort = new AbortController();
    const keys = missingKey.split(',');
    void import('../lib/thumbnails')
      .then(({ thumbnails }) =>
        thumbnails(file, keys.map(Number), (i, url) => setThumbs((th) => ({ ...th, [keys[i]!]: url })), abort.signal),
      )
      .catch((err) => console.warn('Thumbnails unavailable', err));
    return () => abort.abort();
  }, [file, missingKey, editing]);
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;
  useEffect(() => () => Object.values(thumbsRef.current).forEach((u) => URL.revokeObjectURL(u)), []);

  // Edits live only in this tab until saved projects exist, so warn before they're lost.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  if (!clips.length) {
    return (
      <div className="card">
        <p className="muted">
          We couldn't find a moment that works on its own as a clip. Episodes with stories, opinions and lively conversation work best.
        </p>
      </div>
    );
  }

  if (editing !== null && videoUrl) {
    const unlocked = Math.min(exportable, clips.length);
    return (
      <ClipEditor
        key={editing}
        videoUrl={videoUrl}
        duration={duration}
        segments={segments}
        clip={clips[editing]!}
        number={editing + 1}
        total={unlocked}
        onChange={(clip) => onChange(clips.map((c, i) => (i === editing ? clip : c)))}
        onClose={() => setEditing(null)}
        onPrev={editing > 0 ? () => setEditing(editing - 1) : undefined}
        onNext={editing < unlocked - 1 ? () => setEditing(editing + 1) : undefined}
      />
    );
  }

  const locked = Math.max(0, clips.length - exportable);
  return (
    <>
      <h2 className="moments-heading">
        {clips.length} best {clips.length === 1 ? 'clip' : 'clips'}
      </h2>
      <p className="muted small">Tap a clip to preview and edit it.</p>
      <ol className="clip-grid clips-list">
        {clips.map((c, i) => {
          const isLocked = i >= exportable;
          const thumb = thumbs[thumbTime(c).toFixed(2)];
          return (
            <li key={c.original.start}>
              <button
                type="button"
                className={`clip-card clip-button ${isLocked ? 'clip-locked' : ''}`}
                onClick={() => (isLocked ? setUpsell(true) : setEditing(i))}
                aria-label={`${isLocked ? 'Locked: ' : ''}${c.title}, score ${c.score}, ${Math.round(c.end - c.start)} seconds`}
              >
                <span className="clip-thumb clip-thumb-tall">
                  {thumb && <img src={thumb} alt="" style={{ objectPosition: `${c.cropX}% 50%` }} />}
                  <span className="clip-score">{c.score}</span>
                  <span className="clip-len">{Math.round(c.end - c.start)}s</span>
                  {isLocked ? <span className="clip-lock">🔒 Pro</span> : <span className="clip-caption">{c.hook}</span>}
                </span>
                <span className="clip-meta">
                  <b>{c.title}</b>
                  <span>
                    {clock(c.start)}–{clock(c.end)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {locked > 0 && (
        <p className={`notice ${upsell ? 'notice-flash' : ''}`} onAnimationEnd={() => setUpsell(false)}>
          The {planName} plan exports {exportable} clips per episode. <Link to="/#pricing">Upgrade to Pro</Link> to unlock the
          other {locked}.
        </p>
      )}
      <p className="muted small">Next up: export your clips as video files.</p>
    </>
  );
}
