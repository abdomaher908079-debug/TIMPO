import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Caption from './Caption';
import { download, type ExportStatus } from './ClipsScreen';
import Watermark from './Watermark';
import {
  CAPTION_STYLES,
  captionFromGroups,
  clock,
  estimateWords,
  groupWords,
  MAX_CLIP_SECONDS,
  MIN_CLIP_SECONDS,
  type CaptionGroup,
  type Clip,
} from '../lib/clips';
import type { Segment } from '../lib/speech';

interface Props {
  videoUrl: string;
  duration: number;
  segments: Segment[];
  clip: Clip;
  // Exact word times for the clip's current range, once it has been exported.
  exactCaptions?: CaptionGroup[];
  number: number;
  total: number;
  // Pro clips on the Free plan: everything works except export.
  locked: boolean;
  watermark: boolean;
  exportStatus?: ExportStatus;
  // False when the clip was edited after its last export.
  exportCurrent: boolean;
  sizeLabel: string;
  // Another export is running.
  busy: boolean;
  onExport: () => void;
  onCancelExport: () => void;
  onChange: (clip: Clip) => void;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

// How far around the AI's pick the trim handles can reach.
const WINDOW_SECONDS = 30;
const NUDGE = 0.5;

export default function ClipEditor(props: Props) {
  const { videoUrl, duration, segments, clip, exactCaptions, number, total, watermark, onChange, onClose, onPrev, onNext } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(clip.start);
  const [playing, setPlaying] = useState(false);
  const [unplayable, setUnplayable] = useState(false);
  // Only videos wider than 9:16 have anything to frame.
  const [wide, setWide] = useState(false);
  const clipRef = useRef(clip);
  clipRef.current = clip;

  // Fixed while the editor is open so the timeline doesn't move under a dragged handle.
  const [win] = useState(() => ({
    from: Math.max(0, Math.min(clip.start, clip.original.start) - WINDOW_SECONDS),
    to: Math.min(duration, Math.max(clip.end, clip.original.end) + WINDOW_SECONDS),
  }));

  // While playing, follow the video every frame (for smooth captions) and stop at the clip's end.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (!v) return;
      if (v.currentTime >= clipRef.current.end) {
        v.pause();
        v.currentTime = clipRef.current.start;
        setT(clipRef.current.start);
        return;
      }
      setT(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  function seek(time: number) {
    const v = videoRef.current;
    if (v) v.currentTime = time;
    setT(time);
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) return v.pause();
    if (v.currentTime < clip.start || v.currentTime >= clip.end - 0.1) seek(clip.start);
    void v.play().catch(() => setPlaying(false));
  }

  function setStart(value: number) {
    const start = Math.max(win.from, clip.end - MAX_CLIP_SECONDS, Math.min(value, clip.end - MIN_CLIP_SECONDS));
    videoRef.current?.pause();
    onChange({ ...clip, start: round(start) });
    seek(start);
  }

  function setEnd(value: number) {
    const end = Math.min(win.to, clip.start + MAX_CLIP_SECONDS, Math.max(value, clip.start + MIN_CLIP_SECONDS));
    videoRef.current?.pause();
    onChange({ ...clip, end: round(end) });
    // Show the last frame of the clip.
    seek(Math.max(clip.start, end - 0.05));
  }

  const span = win.to - win.from;
  const pct = (time: number) => `${((time - win.from) / span) * 100}%`;
  const inClip = t >= clip.start && t < clip.end;
  const estimated = useMemo(() => groupWords(estimateWords(segments, win.from, win.to)), [segments, win]);
  const caption = inClip ? captionFromGroups(exactCaptions ?? estimated, t) : null;
  const lines = useMemo(() => segments.filter((s) => s.end > win.from && s.start < win.to), [segments, win]);
  const changed = clip.start !== clip.original.start || clip.end !== clip.original.end;

  return (
    <section className="editor" aria-label={`Edit clip ${number}`}>
      <div className="editor-nav">
        <button type="button" className="link-button" onClick={onClose}>
          ← All clips
        </button>
        <span className="muted small">
          Clip {number} of {total}
        </span>
        <span className="editor-arrows">
          <button type="button" className="icon-button" onClick={onPrev} disabled={!onPrev} aria-label="Previous clip">
            ‹
          </button>
          <button type="button" className="icon-button" onClick={onNext} disabled={!onNext} aria-label="Next clip">
            ›
          </button>
        </span>
      </div>

      <div className="editor-body">
        <div className="editor-preview">
          <div className="phone" onClick={togglePlay}>
            {unplayable ? (
              <p className="phone-message">
                Your browser can't preview this video format. You can still trim the clip using the transcript.
              </p>
            ) : (
              <video
                ref={videoRef}
                src={videoUrl}
                playsInline
                preload="auto"
                style={{ objectPosition: `${clip.cropX}% 50%` }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  setWide(v.videoWidth / v.videoHeight > 9 / 16 + 0.01);
                  v.currentTime = clip.start;
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() => setUnplayable(true)}
              />
            )}
            {watermark && <Watermark />}
            {caption && <Caption caption={caption} styleId={clip.captionStyle} />}
            {!playing && !unplayable && (
              <span className="phone-play" aria-hidden="true">
                ▶
              </span>
            )}
          </div>
          <div className="player-bar">
            <button type="button" className="btn btn-primary player-button" onClick={togglePlay} disabled={unplayable}>
              {playing ? 'Pause' : 'Play clip'}
            </button>
            <span className="player-time">
              {clock(Math.max(0, Math.min(t, clip.end) - clip.start))} / {clock(clip.end - clip.start)}
            </span>
          </div>
          <ExportPanel {...props} />
        </div>

        <div className="editor-controls">
          <label className="field-label" htmlFor="clip-title">
            Title
          </label>
          <input id="clip-title" type="text" value={clip.title} maxLength={80} onChange={(e) => onChange({ ...clip, title: e.target.value })} />

          <div className="field-row">
            <span className="field-label">Length</span>
            <span className="trim-times">
              {clock(clip.start, true)} – {clock(clip.end, true)} · {(clip.end - clip.start).toFixed(1)}s
            </span>
          </div>
          <div className="trim">
            <div className="trim-track">
              <div className="trim-range" style={{ left: pct(clip.start), width: `${((clip.end - clip.start) / span) * 100}%` }} />
              <div className="trim-playhead" style={{ left: pct(Math.min(Math.max(t, win.from), win.to)) }} />
            </div>
            <input
              type="range"
              className="trim-input"
              min={win.from}
              max={win.to}
              step={0.1}
              value={clip.start}
              onChange={(e) => setStart(Number(e.target.value))}
              aria-label="Clip start"
              aria-valuetext={clock(clip.start, true)}
            />
            <input
              type="range"
              className="trim-input"
              min={win.from}
              max={win.to}
              step={0.1}
              value={clip.end}
              onChange={(e) => setEnd(Number(e.target.value))}
              aria-label="Clip end"
              aria-valuetext={clock(clip.end, true)}
            />
          </div>
          <div className="nudges">
            <span>
              Start
              <button type="button" className="chip" onClick={() => setStart(clip.start - NUDGE)} aria-label="Start half a second earlier">
                −0.5s
              </button>
              <button type="button" className="chip" onClick={() => setStart(clip.start + NUDGE)} aria-label="Start half a second later">
                +0.5s
              </button>
            </span>
            <span>
              End
              <button type="button" className="chip" onClick={() => setEnd(clip.end - NUDGE)} aria-label="End half a second earlier">
                −0.5s
              </button>
              <button type="button" className="chip" onClick={() => setEnd(clip.end + NUDGE)} aria-label="End half a second later">
                +0.5s
              </button>
            </span>
          </div>
          {changed && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                onChange({ ...clip, ...clip.original });
                seek(clip.original.start);
              }}
            >
              Reset to the AI's pick
            </button>
          )}

          {wide && (
            <>
              <label className="field-label" htmlFor="clip-framing">
                Framing
              </label>
              <input
                id="clip-framing"
                type="range"
                className="slider"
                min={0}
                max={100}
                value={clip.cropX}
                onChange={(e) => onChange({ ...clip, cropX: Number(e.target.value) })}
                aria-valuetext={clip.cropX < 40 ? 'Left' : clip.cropX > 60 ? 'Right' : 'Center'}
              />
              <div className="slider-labels">
                <span>Left</span>
                <span>Center</span>
                <span>Right</span>
              </div>
            </>
          )}

          <span className="field-label">Captions</span>
          <div className="style-picker" role="radiogroup" aria-label="Caption style">
            {CAPTION_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={clip.captionStyle === s.id}
                className={`style-option ${clip.captionStyle === s.id ? 'on' : ''}`}
                onClick={() => onChange({ ...clip, captionStyle: s.id })}
              >
                <span className="style-sample">
                  <Caption caption={{ words: ['Best', 'moment'], active: 1 }} styleId={s.id} inline />
                </span>
                {s.name}
              </button>
            ))}
          </div>

          <span className="field-label">Transcript</span>
          <p className="muted small">Tap a line to jump to it, then set the clip's start or end there.</p>
          <div className="nudges">
            <button type="button" className="chip" onClick={() => setStart(t)} disabled={t >= clip.end - MIN_CLIP_SECONDS}>
              Start here ({clock(t, true)})
            </button>
            <button type="button" className="chip" onClick={() => setEnd(t)} disabled={t <= clip.start + MIN_CLIP_SECONDS}>
              End here
            </button>
          </div>
          <ol className="transcript">
            {lines.map((l) => {
              const inside = l.end > clip.start && l.start < clip.end;
              const current = t >= l.start && t < l.end;
              return (
                <li key={l.start} className={`${inside ? 'line-in' : ''} ${current ? 'line-now' : ''}`}>
                  <button type="button" onClick={() => seek(l.start)}>
                    <span className="line-time">{clock(l.start)}</span>
                    {l.text}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;

function ExportPanel({ locked, exportStatus: status, exportCurrent, busy, onExport, onCancelExport, watermark, sizeLabel }: Props) {
  if (locked) {
    return (
      <div className="export-panel export-locked">
        <p>
          <b>🔒 Pro clip.</b> Watch and edit it all you like. <Link to="/#pricing">Upgrade to Pro</Link> to export it.
        </p>
      </div>
    );
  }
  if (status?.state === 'queued' || status?.state === 'timing' || status?.state === 'rendering') {
    const progress = status.state === 'rendering' ? status.progress : 0;
    return (
      <div className="export-panel" role="status">
        <div className="export-progress">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <p className="muted small">
          {status.state === 'queued'
            ? 'Waiting for the other clips…'
            : status.state === 'timing'
              ? 'Timing every word for the captions…'
              : `Making your clip… ${Math.round(progress * 100)}%`}
        </p>
        <button type="button" className="btn btn-outline" onClick={onCancelExport}>
          Cancel
        </button>
      </div>
    );
  }
  const done = status?.state === 'done' ? status : null;
  return (
    <div className="export-panel">
      {done && exportCurrent ? (
        <>
          <p className="export-done">✓ Exported as {done.fileName}</p>
          <button type="button" className="btn btn-outline" onClick={() => download(done.url, done.fileName)}>
            Download again
          </button>
        </>
      ) : (
        <>
          {status?.state === 'error' && (
            <p className="error" role="alert">
              {status.message}
            </p>
          )}
          <button type="button" className="btn btn-primary" onClick={onExport} disabled={busy}>
            {done ? 'Export again with your changes' : 'Export clip'}
          </button>
          <p className="muted small">
            {sizeLabel} video with captions{watermark ? ' and a small watermark' : ''}. Made on your computer.
          </p>
        </>
      )}
    </div>
  );
}
