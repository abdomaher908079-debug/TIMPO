import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ClipEditor from './ClipEditor';
import { useAccount } from '../lib/account';
import { ensureFont, listKits, type BrandKit } from '../lib/brandKits';
import { alignWords, captionLook, cropAt, clock, estimateWords, groupWords, rangeKey, type CaptionGroup, type Clip } from '../lib/clips';
import type { Segment, WordTimer } from '../lib/speech';

interface Props {
  file: File;
  duration: number;
  segments: Segment[];
  clips: Clip[];
  onChange: (clips: Clip[]) => void;
  exportable: number;
  planName: string;
  watermark: boolean;
  allow4k: boolean;
  quality: 'quick' | 'best';
}

export type ExportStatus =
  | { state: 'queued' }
  | { state: 'timing' }
  | { state: 'rendering'; progress: number }
  | { state: 'done'; url: string; fileName: string; key: string }
  | { state: 'error'; message: string };

// Everything that changes the exported video. A finished export of a clip edited since (or whose
// brand kit was edited since) is out of date.
export const exportKey = (c: Clip, size: string, kits: BrandKit[]) => {
  const { look, kit } = captionLook(c, kits);
  return `${rangeKey(c)}|${c.layout}|${c.cropX}|${JSON.stringify(c.track ?? [])}|${JSON.stringify(look)}|${kit?.logo?.length ?? 0}|${kit?.logo_corner ?? ''}|${size}`;
};
export const SIZE_LABELS = { '1080p': '1080×1920', '4k': '4K (2160×3840)' } as const;

// Frames are taken a moment in, past any cut at the very start of the clip.
const thumbTime = (c: Clip) => c.start + Math.min(1, (c.end - c.start) / 4);

function fileName(clip: Clip, n: number, extension: string) {
  const slug = clip.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${String(n).padStart(2, '0')}-${slug || 'clip'}${extension}`;
}

export function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// All the clips found, best first. On plans with an export limit, the rest can be previewed but not exported.
export default function ClipsScreen({ file, duration, segments, clips, onChange, exportable, planName, watermark, allow4k, quality }: Props) {
  const [size, setSize] = useState<'1080p' | '4k'>('1080p');
  const exportSize = allow4k ? size : '1080p';
  const sizeRef = useRef(exportSize);
  sizeRef.current = exportSize;
  const [editing, setEditing] = useState<number | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [exports, setExports] = useState<Record<number, ExportStatus>>({});
  // Exact word times per clip range, so re-exports and the preview reuse them.
  const [timed, setTimed] = useState<Record<string, CaptionGroup[]>>({});
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const { workspace } = useAccount();
  const [kits, setKits] = useState<BrandKit[]>([]);
  const kitsRef = useRef(kits);
  kitsRef.current = kits;
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const timedRef = useRef(timed);
  timedRef.current = timed;
  const timerRef = useRef<WordTimer | null>(null);
  const jobRef = useRef<AbortController | null>(null);

  // The team's brand kits. Clips that haven't picked a look yet use the first kit.
  const workspaceId = workspace?.owner_id;
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    listKits(workspaceId)
      .then((list) => {
        if (!live) return;
        setKits(list);
        list.forEach((k) => void ensureFont(k.font));
        const first = list[0]?.id ?? null;
        if (clipsRef.current.some((c) => c.brandKitId === undefined)) {
          onChange(clipsRef.current.map((c) => (c.brandKitId === undefined ? { ...c, brandKitId: first } : c)));
        }
      })
      .catch((err) => console.warn(err));
    return () => {
      live = false;
    };
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Thumbnails follow trims: re-fetch the frames whose time changed. Keyed by time so unchanged
  // clips keep theirs.
  const missing = [...new Set(clips.map((c) => thumbTime(c).toFixed(2)))].filter((k) => !thumbs[k]);
  const missingKey = missing.join(',');
  const busy = Object.values(exports).some((e) => e.state === 'queued' || e.state === 'timing' || e.state === 'rendering');
  useEffect(() => {
    // Decoding thumbnails competes with playback and exporting, so wait for those.
    if (!missingKey || editing !== null || busy) return;
    const abort = new AbortController();
    const keys = missingKey.split(',');
    void import('../lib/thumbnails')
      .then(({ thumbnails }) =>
        thumbnails(file, keys.map(Number), (i, url) => setThumbs((th) => ({ ...th, [keys[i]!]: url })), abort.signal),
      )
      .catch((err) => console.warn('Thumbnails unavailable', err));
    return () => abort.abort();
  }, [file, missingKey, editing, busy]);

  // Auto framing: finds the faces in each clip, to follow the speaker or show the whole picture.
  // Changes only clips nobody has framed yet, one at a time as each is done.
  async function frameClips(indices: number[], signal: AbortSignal) {
    const { autoFrame } = await import('../lib/framing');
    const ranges = indices.map((i) => clipsRef.current[i]!);
    await autoFrame(
      file,
      ranges,
      (k, framing) => {
        const i = indices[k]!;
        const now = clipsRef.current[i];
        // Skip clips the user framed meanwhile, or trimmed to another range.
        if (!now || now.framed || now.start !== ranges[k]!.start || now.end !== ranges[k]!.end) return;
        const next = clipsRef.current.map((c, j) => (j === i ? { ...c, ...framing, framed: true } : c));
        clipsRef.current = next;
        onChange(next);
      },
      signal,
    );
  }
  const unframed = clips.flatMap((c, i) => (c.framed ? [] : [i])).join(',');
  useEffect(() => {
    // Decoding frames competes with exporting, so wait for that.
    if (!unframed || busy) return;
    const abort = new AbortController();
    frameClips(unframed.split(',').map(Number), abort.signal).catch((err) => {
      if (abort.signal.aborted) return;
      console.warn('Auto framing failed; clips stay centered.', err);
      // Don't keep trying: centered framing still works, and people can frame clips by hand.
      const next = clipsRef.current.map((c) => (c.framed ? c : { ...c, framed: true }));
      clipsRef.current = next;
      onChange(next);
    });
    return () => abort.abort();
  }, [unframed, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  // Get caption timing ready while people look at their clips, so the first export starts right away
  // (on phones this is a ~40 MB download the first time; the browser keeps it afterwards).
  useEffect(() => {
    if (!exportable) return;
    const id = setTimeout(() => {
      if (timerRef.current) return;
      void import('../lib/speech').then(({ createWordTimer }) => {
        timerRef.current ??= createWordTimer(quality);
        timerRef.current.warm();
      });
    }, 3000);
    return () => clearTimeout(id);
  }, [exportable, quality]);

  // Free everything this screen holds when it closes.
  const exportsRef = useRef(exports);
  exportsRef.current = exports;
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;
  useEffect(
    () => () => {
      jobRef.current?.abort();
      timerRef.current?.dispose();
      timerRef.current = null;
      Object.values(thumbsRef.current).forEach((u) => URL.revokeObjectURL(u));
      Object.values(exportsRef.current).forEach((e) => e.state === 'done' && URL.revokeObjectURL(e.url));
    },
    [],
  );

  // Clips and edits are saved in the browser (saved.ts), but an export in progress would be lost.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  const setStatus = (i: number, status: ExportStatus) =>
    setExports((ex) => {
      const old = ex[i];
      if (old?.state === 'done' && !(status.state === 'done' && status.url === old.url)) URL.revokeObjectURL(old.url);
      return { ...ex, [i]: status };
    });

  async function exportOne(i: number, signal: AbortSignal) {
    // Frame it first if auto framing hasn't reached this clip yet.
    if (!clipsRef.current[i]!.framed) {
      setStatus(i, { state: 'timing' });
      await frameClips([i], signal).catch((err) => console.warn('Auto framing failed', err));
    }
    const clip = clipsRef.current[i]!;
    const key = rangeKey(clip);
    let groups = timedRef.current[key];
    if (!groups) {
      setStatus(i, { state: 'timing' });
      try {
        if (!timerRef.current) timerRef.current = (await import('../lib/speech')).createWordTimer(quality);
        const timedWords = await timerRef.current.words(file, clip.start, clip.end);
        const exact = groupWords(alignWords(estimateWords(segments, clip.start, clip.end), timedWords));
        groups = exact;
        setTimed((t) => ({ ...t, [key]: exact }));
      } catch (err) {
        if (signal.aborted) throw err;
        // Slightly off-beat captions beat no clip at all.
        console.warn('Exact word timing failed; using estimated timing.', err);
        groups = groupWords(estimateWords(segments, clip.start, clip.end));
      }
    }
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
    setStatus(i, { state: 'rendering', progress: 0 });
    const { renderClip } = await import('../lib/render');
    const clipSize = sizeRef.current;
    const { look, kit } = captionLook(clip, kitsRef.current);
    let logo = null;
    if (kit?.logo) {
      try {
        logo = { image: await createImageBitmap(await (await fetch(kit.logo)).blob()), corner: kit.logo_corner };
      } catch (err) {
        console.warn('Logo unavailable', err);
      }
    }
    // Progress redraws this whole screen, so at most about 5 times a second rather than every frame.
    let shown = 0;
    const { blob, extension } = await renderClip(file, clip, groups, {
      look,
      logo,
      watermark,
      size: clipSize,
      signal,
      onProgress: (p) => {
        const now = performance.now();
        if (now - shown < 200) return;
        shown = now;
        setStatus(i, { state: 'rendering', progress: p });
      },
    });
    const url = URL.createObjectURL(blob);
    const name = fileName(clip, i + 1, extension);
    logo?.image.close();
    setStatus(i, { state: 'done', url, fileName: name, key: exportKey(clip, clipSize, kitsRef.current) });
    download(url, name);
  }

  async function runExports(indices: number[]) {
    const job = new AbortController();
    jobRef.current = job;
    indices.forEach((i) => setStatus(i, { state: 'queued' }));
    for (const i of indices) {
      if (job.signal.aborted) break;
      try {
        await exportOne(i, job.signal);
      } catch (err) {
        if (job.signal.aborted) break;
        console.error(err);
        setStatus(i, { state: 'error', message: err instanceof Error ? err.message : "This clip couldn't be exported." });
      }
    }
    if (job.signal.aborted) {
      setExports((ex) => {
        const next = { ...ex };
        for (const i of indices) if (next[i]?.state !== 'done') delete next[i];
        return next;
      });
    }
    if (jobRef.current === job) jobRef.current = null;
  }

  const cancelExports = () => jobRef.current?.abort();

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
    const clip = clips[editing]!;
    return (
      <ClipEditor
        key={editing}
        videoUrl={videoUrl}
        duration={duration}
        segments={segments}
        clip={clip}
        thumb={thumbs[thumbTime(clip).toFixed(2)]}
        exactCaptions={timed[rangeKey(clip)]}
        number={editing + 1}
        total={clips.length}
        locked={editing >= exportable}
        watermark={watermark}
        exportStatus={exports[editing]}
        exportCurrent={exports[editing]?.state !== 'done' || (exports[editing] as { key: string }).key === exportKey(clip, exportSize, kits)}
        kits={kits}
        sizeLabel={SIZE_LABELS[exportSize]}
        busy={busy}
        onExport={() => void runExports([editing])}
        onCancelExport={cancelExports}
        onChange={(c) => onChange(clips.map((old, i) => (i === editing ? c : old)))}
        onClose={() => setEditing(null)}
        onPrev={editing > 0 ? () => setEditing(editing - 1) : undefined}
        onNext={editing < clips.length - 1 ? () => setEditing(editing + 1) : undefined}
      />
    );
  }

  const unlocked = Math.min(exportable, clips.length);
  const locked = clips.length - unlocked;
  const isCurrent = (i: number) => {
    const e = exports[i];
    return e?.state === 'done' && e.key === exportKey(clips[i]!, exportSize, kits);
  };
  const toExport = clips.slice(0, unlocked).flatMap((_, i) => (isCurrent(i) ? [] : [i]));
  return (
    <>
      <div className="clips-head">
        <div>
          <h2 className="moments-heading">
            {clips.length} best {clips.length === 1 ? 'clip' : 'clips'}
          </h2>
          <p className="muted small">Tap a clip to preview and edit it.</p>
        </div>
        {allow4k && (
          <label className="size-picker">
            Quality
            <select value={size} onChange={(e) => setSize(e.target.value as '1080p' | '4k')} disabled={busy}>
              <option value="1080p">1080p</option>
              <option value="4k">4K</option>
            </select>
          </label>
        )}
        {busy ? (
          <button type="button" className="btn btn-outline btn-inline" onClick={cancelExports}>
            Cancel export
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-inline" onClick={() => void runExports(toExport)} disabled={!toExport.length}>
            {!toExport.length
              ? 'All clips exported'
              : toExport.length < unlocked
                ? `Export ${toExport.length} more`
                : `Export ${unlocked === 1 ? 'clip' : `all ${unlocked} clips`}`}
          </button>
        )}
      </div>
      {quality === 'quick' && (
        <p className="quality-note">
          <b>Found by our Quick AI.</b> Pro's Best AI hears every word more accurately and picks smarter moments, and you'd
          export all {clips.length} clips without a watermark. <Link to="/account">Upgrade to Pro</Link>
        </p>
      )}
      <ol className="clip-grid clips-list">
        {clips.map((c, i) => {
          const isLocked = i >= exportable;
          const thumb = thumbs[thumbTime(c).toFixed(2)];
          const status = exports[i];
          return (
            <li key={c.original.start}>
              <button
                type="button"
                className={`clip-card clip-button ${isLocked ? 'clip-locked' : ''}`}
                onClick={() => setEditing(i)}
                aria-label={`${isLocked ? 'Pro clip, preview only: ' : ''}${c.title}, score ${c.score}, ${Math.round(c.end - c.start)} seconds`}
              >
                <span className="clip-thumb clip-thumb-tall">
                  {thumb && c.layout === 'fit' && <img className="thumb-backdrop" src={thumb} alt="" />}
                  {thumb && (
                    <img
                      className={c.layout === 'fit' ? 'thumb-fit' : undefined}
                      src={thumb}
                      alt=""
                      style={c.layout === 'fit' ? undefined : { objectPosition: `${cropAt(c, thumbTime(c))}% 50%` }}
                    />
                  )}
                  <span className="clip-score">{c.score}</span>
                  <span className="clip-len">{Math.round(c.end - c.start)}s</span>
                  {isLocked ? <span className="clip-lock">🔒 Pro</span> : <span className="clip-caption">{c.hook}</span>}
                  {status && <ExportBadge status={status} current={status.state !== 'done' || isCurrent(i)} />}
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
        <p className="notice">
          {locked === 1 ? '1 clip is' : `${locked} clips are`} Pro only: you can watch and edit {locked === 1 ? 'it' : 'them'}, but not
          export. The {planName} plan exports {exportable} clips per episode. <Link to="/#pricing">Upgrade to Pro</Link> to export every
          clip without a watermark.
        </p>
      )}
      <p className="muted small">
        Clips are made on your computer as {SIZE_LABELS[exportSize]} videos with captions{watermark ? ' and a small watermark' : ''}, ready for TikTok,
        Reels and Shorts.
      </p>
    </>
  );
}

function ExportBadge({ status, current }: { status: ExportStatus; current: boolean }) {
  const text =
    status.state === 'queued'
      ? 'Waiting…'
      : status.state === 'timing'
        ? 'Timing words…'
        : status.state === 'rendering'
          ? `Exporting ${Math.round(status.progress * 100)}%`
          : status.state === 'error'
            ? 'Export failed'
            : current
              ? '✓ Exported'
              : 'Edited since export';
  return <span className={`export-badge export-${status.state} ${current ? '' : 'export-stale'}`}>{text}</span>;
}
