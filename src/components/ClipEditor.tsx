import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Caption from './Caption';
import { download, type ExportStatus } from './ClipsScreen';
import Watermark from './Watermark';
import { useAccount } from '../lib/account';
import { recordFeedback } from '../lib/feedback';
import type { BrandKit } from '../lib/brandKits';
import {
  CAPTION_STYLES,
  captionFromGroups,
  captionLook,
  clipSeconds,
  clock,
  cropAt,
  editedLook,
  fadeAt,
  fixWords,
  type ClipEdit,
  PRO_PARTS,
  proParts,
  rememberProOff,
  type ProPart,
  estimateWords,
  groupWords,
  MAX_CLIP_SECONDS,
  MIN_CLIP_SECONDS,
  splitCrops,
  withoutFillers,
  zoomAt,
  zoomsFor,
  type CaptionGroup,
  type Clip,
  type SplitFraming,
} from '../lib/clips';
import { keptRanges, outputTime, playedSeconds, rangeAtOrAfter, type TimeRange } from '../lib/cuts';
import type { Segment } from '../lib/speech';

interface Props {
  videoUrl: string;
  duration: number;
  segments: Segment[];
  clip: Clip;
  // A still of the clip, shown blurred behind the picture in the "whole picture" layout.
  thumb?: string;
  // The team's brand kits, offered as caption looks.
  kits: BrandKit[];
  // Exact word times for the clip's current range, once it has been exported.
  exactCaptions?: CaptionGroup[];
  number: number;
  total: number;
  // Pro clips on the Free plan: everything works except export.
  locked: boolean;
  // A paid plan: the Pro edit is theirs to use (and turn off per clip).
  paid: boolean;
  watermark: boolean;
  exportStatus?: ExportStatus;
  // False when the clip was edited after its last export.
  exportCurrent: boolean;
  sizeLabel: string;
  // Another export is running.
  busy: boolean;
  onExport: () => void;
  // Turns the same Pro edit parts off (and the rest on) for every clip of the episode.
  onApplyProToAll?: (off: ProPart[]) => void;
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
  const { videoUrl, duration, segments, clip, thumb, kits, exactCaptions, number, total, watermark, onChange, onClose, onPrev, onNext } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(clip.start);
  const [playing, setPlaying] = useState(false);
  const [unplayable, setUnplayable] = useState(false);
  // Only videos wider than 9:16 have anything to frame.
  const [wide, setWide] = useState(false);
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const tighten = !clip.edit?.keepPauses;
  // What the clip plays: the skipped parts always left out; pauses and "um"s too once words are exactly timed
  // (as in the export; before that they'd be guesses).
  const ranges = useMemo(
    () => keptRanges(clip.start, clip.end, clip.skips, exactCaptions?.flatMap((g) => g.words) ?? [], tighten && !!exactCaptions),
    [clip.start, clip.end, clip.skips, exactCaptions, tighten],
  );
  const rangesRef = useRef(ranges);
  rangesRef.current = ranges;

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
      // Into a part the clip leaves out: jump to where it goes on (or stop at the end).
      const next = rangeAtOrAfter(rangesRef.current, v.currentTime);
      if (v.currentTime >= clipRef.current.end || !next) {
        v.pause();
        v.currentTime = clipRef.current.start;
        setT(clipRef.current.start);
        return;
      }
      if (v.currentTime < next.start - 0.02) v.currentTime = next.start;
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
  // Where the playhead is in the clip as it plays (null in a part it leaves out).
  const at = t >= clip.start && t < clip.end ? outputTime(ranges, t) : null;
  const inClip = at !== null;
  const played = playedSeconds(ranges);
  const estimated = useMemo(() => groupWords(estimateWords(segments, win.from, win.to)), [segments, win]);
  // The Pro edit: on paid plans, and shown on Pro-only clips so Free users can see it.
  const parts = proParts(clip, props.paid || props.locked);
  const groups = useMemo(() => {
    const base = exactCaptions ?? estimated;
    return fixWords(tighten ? withoutFillers(base) : base, clip.edit?.fixes);
  }, [exactCaptions, estimated, clip.edit?.fixes, tighten]);
  const caption = inClip ? captionFromGroups(groups, t, parts.highlight ? clip.emphasis : undefined) : null;
  const zooms = useMemo(() => (parts.zoom ? zoomsFor(groups.flatMap((g) => g.words), clip.punchIns) : []), [parts.zoom, groups, clip.punchIns]);
  const zoom = (inClip ? zoomAt(zooms, t) : 1) * (clip.edit?.zoom ?? 1);
  const dark = at !== null ? fadeAt({ start: 0, end: played, edit: clip.edit }, at) : 0;
  const headlineAlpha = !parts.headline || !clip.headline || at === null ? 0 : clip.layout === 'fit' ? 1 : Math.max(0, Math.min(1, (4 - at) / 0.4));
  const { look: baseLook, kit } = captionLook(clip, kits);
  const look = editedLook(baseLook, clip.edit, clip.layout);
  const { plan } = useAccount();
  const sample = { words: ['Best', 'moment'], active: 1 };
  const lines = useMemo(() => segments.filter((s) => s.end > win.from && s.start < win.to), [segments, win]);
  const changed =
    clip.start !== clip.original.start || clip.end !== clip.original.end || JSON.stringify(clip.skips ?? []) !== JSON.stringify(clip.original.skips ?? []);
  const fit = wide && clip.layout === 'fit';
  const split = wide && clip.layout === 'split' && clip.split ? clip.split : null;
  const skipped = (from: number, to: number) => (clip.skips ?? []).some((k) => from >= k.start - 0.01 && to <= k.end + 0.01);

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
            {fit && thumb && <img className="phone-backdrop" src={thumb} alt="" />}
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
                style={{
                  ...(fit ? { objectFit: 'contain', objectPosition: '50% 50%' } : { objectPosition: `${cropAt(clip, t, parts.follow)}% 50%` }),
                  transform: zoom !== 1 && !split ? `scale(${zoom})` : undefined,
                  // The split screen is drawn from this video onto a canvas above it.
                  opacity: split ? 0 : undefined,
                }}
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
            {split && <SplitPreview video={videoRef} split={split} zoom={zoom} />}
            {watermark && <Watermark />}
            {kit?.logo && <img className={`phone-logo logo-${kit.logo_corner}`} src={kit.logo} alt="" />}
            {headlineAlpha > 0 && (
              <span className={`phone-headline ${fit ? 'phone-headline-fit' : ''}`} style={{ opacity: headlineAlpha, fontFamily: `"${look.font}", Inter, sans-serif` }}>
                {clip.headline}
              </span>
            )}
            {/* Keyed by its words, so fade and pop start again for each new caption. */}
            {caption && <Caption key={caption.words.join(' ')} caption={caption} look={look} />}
            {dark > 0 && <span className="phone-fade" style={{ opacity: dark }} />}
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
              {clock(at ?? 0)} / {clock(played)}
            </span>
          </div>
          <ExportPanel {...props} />
        </div>

        <div className="editor-controls">
          <label className="field-label" htmlFor="clip-title">
            Title
          </label>
          <input id="clip-title" type="text" value={clip.title} maxLength={80} onChange={(e) => onChange({ ...clip, title: e.target.value })} />
          <div className="vote" role="group" aria-label="Is this a good moment?">
            <span className="muted small">Is this a good moment?</span>
            {(
              [
                ['up', '👍', 'liked', 'Yes, good moment'],
                ['down', '👎', 'disliked', 'No, not a good moment'],
              ] as const
            ).map(([v, icon, kind, label]) => (
              <button
                key={v}
                type="button"
                className={`chip ${clip.vote === v ? 'chip-on' : ''}`}
                aria-pressed={clip.vote === v}
                aria-label={label}
                onClick={() => {
                  if (clip.vote === v) return;
                  onChange({ ...clip, vote: v });
                  recordFeedback(kind, clip, number - 1);
                }}
              >
                {icon}
              </button>
            ))}
          </div>

          <div className="field-row">
            <span className="field-label">Length</span>
            <span className="trim-times">
              {clock(clip.start, true)} – {clock(clip.end, true)} · {clipSeconds(clip).toFixed(1)}s
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
          {!!clip.skips?.length && (
            <SkippedParts
              skips={clip.skips}
              onPutBack={(k) => {
                const rest = clip.skips!.filter((s) => s !== k);
                onChange({ ...clip, skips: rest.length ? rest : undefined });
              }}
              onPlay={(k) => seek(Math.max(clip.start, k.start - 2))}
            />
          )}
          <ProEditControl clip={clip} paid={props.paid} locked={props.locked} onChange={onChange} onApplyAll={props.onApplyProToAll} />

          {changed && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                onChange({ ...clip, start: clip.original.start, end: clip.original.end, skips: clip.original.skips });
                seek(clip.original.start);
              }}
            >
              Reset to the AI's pick
            </button>
          )}

          {wide && (
            <>
              <span className="field-label">Framing</span>
              <div className="style-picker layout-picker" role="radiogroup" aria-label="Framing">
                {(
                  [
                    ['fill', 'Fill the screen'],
                    ['fit', 'Whole picture'],
                    ...(clip.split ? ([['split', 'Split screen']] as const) : []),
                  ] as const
                ).map(([id, name]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={clip.layout === id}
                    className={`style-option ${clip.layout === id ? 'on' : ''}`}
                    onClick={() => onChange({ ...clip, layout: id, framed: true })}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {clip.layout === 'fill' && (
                <>
                  <input
                    id="clip-framing"
                    type="range"
                    className="slider"
                    min={0}
                    max={100}
                    aria-label="Framing position"
                    value={Math.round(cropAt(clip, t))}
                    // Moving it fixes the framing in place instead of following the speaker.
                    onChange={(e) => onChange({ ...clip, cropX: Number(e.target.value), track: undefined, framed: true })}
                    aria-valuetext={clip.cropX < 40 ? 'Left' : clip.cropX > 60 ? 'Right' : 'Center'}
                  />
                  <div className="slider-labels">
                    <span>Left</span>
                    <span>Center</span>
                    <span>Right</span>
                  </div>
                  {clip.track && <p className="muted small">Following the speaker. Move the slider to keep it in one place.</p>}
                </>
              )}
              {!clip.framed && <p className="muted small">Finding the faces in this clip…</p>}
            </>
          )}

          <span className="field-label">Captions</span>
          <div className="style-picker" role="radiogroup" aria-label="Caption style">
            {kits.map((k) => {
              const on = kit?.id === k.id;
              return (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`style-option style-brand ${on ? 'on' : ''}`}
                  onClick={() => onChange({ ...clip, brandKitId: k.id })}
                >
                  <span className="style-sample">
                    <Caption caption={sample} look={captionLook({ captionStyle: 'bold', brandKitId: k.id }, kits).look} inline />
                  </span>
                  {k.name}
                </button>
              );
            })}
            {CAPTION_STYLES.map((s) => {
              const on = !kit && clip.captionStyle === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`style-option ${on ? 'on' : ''}`}
                  onClick={() => onChange({ ...clip, captionStyle: s.id, brandKitId: null })}
                >
                  <span className="style-sample">
                    <Caption caption={sample} look={captionLook({ captionStyle: s.id }, []).look} inline />
                  </span>
                  {s.name}
                </button>
              );
            })}
          </div>
          {!kits.length && (
            <p className="muted small">
              {plan.id === 'free' ? (
                <>
                  Want captions in your show's font and colors, with your logo? <Link to="/pricing">Brand kits come with Pro</Link>.
                </>
              ) : (
                <>
                  <Link to="/brand-kits">Create your brand kit</Link>: your font, colors and logo on every clip.
                </>
              )}
            </p>
          )}

          <StyleAndEffects clip={clip} showHeadline={parts.headline && !!clip.headline} onChange={onChange} />

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
              const out = inside && skipped(l.start, l.end);
              const current = t >= l.start && t < l.end;
              return (
                <li key={l.start} className={`${inside && !out ? 'line-in' : ''} ${out ? 'line-out' : ''} ${current ? 'line-now' : ''}`}>
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
          <b>🔒 Pro clip.</b> Watch and edit it all you like. <Link to="/pricing">Upgrade to Pro</Link> to export it.
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

// What the Pro edit adds, shown in the editor: a switch on paid plans, a preview on Pro-only clips,
// and a locked row with what's missing on the clips Free can export.
function ProEditControl({
  clip,
  paid,
  locked,
  onChange,
  onApplyAll,
}: {
  clip: Clip;
  paid: boolean;
  locked: boolean;
  onChange: (c: Clip) => void;
  onApplyAll?: (off: ProPart[]) => void;
}) {
  // Only the parts the AI made for this clip (and framing once auto framing found someone to follow).
  const available: Record<ProPart, boolean> = {
    headline: !!clip.headline,
    highlight: !!clip.emphasis?.length,
    zoom: !!clip.punchIns?.length,
    follow: !!clip.track?.length,
  };
  const has = Object.values(available).some(Boolean);
  if (!has) return null;
  const what = 'AI headline, zoom-ins on the best lines, highlighted key words, and framing that follows the speaker';
  if (paid) {
    const on = proParts(clip, true);
    const offList = (next: Record<ProPart, boolean>) => PRO_PARTS.map((p) => p.id).filter((id) => !next[id]);
    return (
      <div className="pro-edit pro-edit-on pro-parts">
        <b>Pro edit</b>
        <span className="muted small">Choose what this clip gets.</span>
        {PRO_PARTS.filter((p) => available[p.id]).map((p) => (
          <label key={p.id} className="pro-part">
            <input
              type="checkbox"
              checked={on[p.id]}
              onChange={(e) => {
                const off = offList({ ...on, [p.id]: e.target.checked });
                // Remembered for the next episodes' clips.
                rememberProOff(off);
                onChange({ ...clip, proEdit: undefined, proOff: off });
              }}
            />
            <span>{p.label}</span>
          </label>
        ))}
        {onApplyAll && (
          <button type="button" className="link-button" onClick={() => onApplyAll(offList(on))}>
            Use these choices on every clip
          </button>
        )}
      </div>
    );
  }
  if (locked) {
    return (
      <p className="pro-edit pro-edit-preview">
        <b>✨ You're seeing the Pro edit</b>
        <span className="muted small">
          {what}. <Link to="/pricing">Upgrade to Pro</Link> to export clips like this.
        </span>
      </p>
    );
  }
  return (
    <Link to="/pricing" className="pro-edit pro-edit-locked">
      <b>🔒 Pro edit</b>
      <span className="muted small">{what}. Open a 🔒 Pro clip to see it, or upgrade to get it on every clip.</span>
    </Link>
  );
}

const COLORS: [string | undefined, string][] = [
  [undefined, 'Style color'],
  ['#ffffff', 'White'],
  ['#ffd23f', 'Yellow'],
  ['#9dff3c', 'Green'],
  ['#ff6a13', 'Orange'],
  ['#5ec8ff', 'Blue'],
  ['#ff5fa2', 'Pink'],
];

/** The person's own touches: headline text, caption size, place, color, motion, word fixes, zoom and fades. */
function StyleAndEffects({ clip, showHeadline, onChange }: { clip: Clip; showHeadline: boolean; onChange: (c: Clip) => void }) {
  const edit = clip.edit ?? {};
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const set = (patch: Partial<ClipEdit>) => {
    const next: ClipEdit = { ...edit, ...patch };
    // Defaults aren't stored, so older and untouched clips look the same.
    (Object.keys(next) as (keyof ClipEdit)[]).forEach((k) => next[k] === undefined && delete next[k]);
    onChange({ ...clip, edit: Object.keys(next).length ? next : undefined });
  };
  const choice = <T extends string>(label: string, value: T | undefined, options: [T | undefined, string][], onPick: (v: T | undefined) => void) => (
    <div className="edit-row">
      <span className="edit-label">{label}</span>
      <div className="edit-chips" role="radiogroup" aria-label={label}>
        {options.map(([v, name]) => (
          <button key={name} type="button" role="radio" aria-checked={value === v} className={`chip ${value === v ? 'chip-on' : ''}`} onClick={() => onPick(v)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <span className="field-label">Style &amp; effects</span>
      <div className="edit-panel">
        {showHeadline && (
          <div className="edit-row">
            <label className="edit-label" htmlFor="clip-headline">
              Headline
            </label>
            <input id="clip-headline" type="text" dir="auto" maxLength={80} value={clip.headline ?? ''} onChange={(e) => onChange({ ...clip, headline: e.target.value })} />
          </div>
        )}
        {choice('Caption size', edit.captionSize, [['small', 'Small'], [undefined, 'Normal'], ['large', 'Large']], (v) => set({ captionSize: v }))}
        {choice('Caption place', edit.captionPlace, [['top', 'Top'], ['middle', 'Middle'], [undefined, 'Bottom']], (v) => set({ captionPlace: v }))}
        {choice('Caption animation', edit.captionMotion, [[undefined, 'None'], ['fade', 'Fade in'], ['pop', 'Pop']], (v) => set({ captionMotion: v }))}
        <div className="edit-row">
          <span className="edit-label">Caption color</span>
          <div className="edit-swatches" role="radiogroup" aria-label="Caption color">
            {COLORS.map(([c, name]) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={edit.captionColor === c}
                aria-label={name}
                title={name}
                className={`swatch ${edit.captionColor === c ? 'swatch-on' : ''} ${c ? '' : 'swatch-default'}`}
                style={c ? { background: c } : undefined}
                onClick={() => set({ captionColor: c })}
              />
            ))}
          </div>
        </div>
        <div className="edit-row">
          <span className="edit-label">Fix a word in the captions</span>
          {edit.fixes?.map((f, i) => (
            <span key={i} className="edit-fix">
              <span dir="auto">{f.from}</span> → <b dir="auto">{f.to}</b>
              <button type="button" className="link-button" aria-label={`Remove fix ${f.from}`} onClick={() => set({ fixes: edit.fixes!.filter((_, k) => k !== i) })}>
                Remove
              </button>
            </span>
          ))}
          <form
            className="edit-fix-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!from.trim() || !to.trim()) return;
              set({ fixes: [...(edit.fixes ?? []), { from: from.trim(), to: to.trim() }] });
              setFrom('');
              setTo('');
            }}
          >
            <input type="text" dir="auto" placeholder="Wrong word" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Wrong word" />
            <input type="text" dir="auto" placeholder="Right word" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Right word" />
            <button type="submit" className="chip">
              Fix
            </button>
          </form>
        </div>
        <div className="edit-row">
          <label className="edit-label" htmlFor="clip-zoom">
            Zoom in · {Math.round((edit.zoom ?? 1) * 100)}%
          </label>
          <input
            id="clip-zoom"
            type="range"
            className="slider"
            min={100}
            max={150}
            step={5}
            value={Math.round((edit.zoom ?? 1) * 100)}
            onChange={(e) => set({ zoom: Number(e.target.value) === 100 ? undefined : Number(e.target.value) / 100 })}
          />
        </div>
        <div className="edit-row edit-checks">
          <label className="pro-part">
            <input type="checkbox" checked={!edit.keepPauses} onChange={(e) => set({ keepPauses: e.target.checked ? undefined : true })} />
            <span>Remove long pauses and “um”s</span>
          </label>
          <label className="pro-part">
            <input type="checkbox" checked={!!edit.fadeIn} onChange={(e) => set({ fadeIn: e.target.checked || undefined })} />
            <span>Fade in at the start</span>
          </label>
          <label className="pro-part">
            <input type="checkbox" checked={!!edit.fadeOut} onChange={(e) => set({ fadeOut: e.target.checked || undefined })} />
            <span>Fade out at the end</span>
          </label>
        </div>
        {clip.edit && (
          <button type="button" className="link-button" onClick={() => onChange({ ...clip, edit: undefined })}>
            Undo all style &amp; effects
          </button>
        )}
      </div>
    </>
  );
}

/** The parts of the episode the AI left out of this clip (a tangent), each with a way to put it back. */
function SkippedParts({ skips, onPutBack, onPlay }: { skips: TimeRange[]; onPutBack: (k: TimeRange) => void; onPlay: (k: TimeRange) => void }) {
  return (
    <div className="skipped-parts">
      <b>Leaves out {skips.length === 1 ? 'a part' : `${skips.length} parts`} to stay tight</b>
      {skips.map((k) => (
        <span key={k.start} className="skipped-part">
          <button type="button" className="link-button" onClick={() => onPlay(k)}>
            {clock(k.start)}–{clock(k.end)} ({Math.round(k.end - k.start)}s)
          </button>
          <button type="button" className="chip" onClick={() => onPutBack(k)}>
            Put it back
          </button>
        </span>
      ))}
    </div>
  );
}

/** The split screen in the preview: the playing video drawn twice, one person above the other (as in the export). */
function SplitPreview({ video, split, zoom }: { video: React.RefObject<HTMLVideoElement>; split: SplitFraming; zoom: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = ref.current;
      const v = video.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx && v && v.videoWidth) {
        const { top, bottom } = splitCrops(v.videoWidth, v.videoHeight, split, zoom);
        const half = canvas.height / 2;
        ctx.drawImage(v, top[0]!, top[1]!, top[2]!, top[3]!, 0, 0, canvas.width, half);
        ctx.drawImage(v, bottom[0]!, bottom[1]!, bottom[2]!, bottom[3]!, 0, half, canvas.width, half);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video, split, zoom]);
  return <canvas ref={ref} className="phone-split" width={540} height={960} aria-hidden="true" />;
}
