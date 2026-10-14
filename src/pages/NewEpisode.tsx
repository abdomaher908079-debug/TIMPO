import { useRef, useState, type DragEvent } from 'react';
import Meter from '../components/Meter';
import Progress, { type Step } from '../components/Progress';
import { PLANS } from '../lib/plans';
import { formatDuration, formatSize, type EpisodeInfo } from '../lib/format';

// Until usage tracking exists (Part 6), everyone is treated as a Free user with a full week left.
const plan = PLANS[0]!;
const remainingSeconds = plan.hours * 3600;
const maxEpisodeSeconds = plan.maxEpisodeHours === null ? Infinity : plan.maxEpisodeHours * 3600;

const MIN_SECONDS = 60;
// Container durations are often a fraction of a second longer than the episode; don't block a
// 1:00:00 episode on a 1-hour plan over that.
const LIMIT_GRACE_SECONDS = 30;

type State =
  | { kind: 'empty' }
  | { kind: 'processing'; file: File; info: EpisodeInfo; steps: Step[]; percent: number }
  | { kind: 'reading'; file: File }
  | { kind: 'ready'; file: File; info: EpisodeInfo }
  | { kind: 'error'; message: string };

function problemWith(info: EpisodeInfo): string | null {
  if (!info.audioCodec) return "This video has no sound. PeakClip needs the episode's audio to find the best moments.";
  if (!info.videoCodec) return 'This file has no video. Choose the video version of your episode.';
  if (!info.canDecodeVideo || !info.canDecodeAudio) {
    return "Your browser can't read this video format. Try exporting the episode as MP4 (H.264), or use the latest Chrome.";
  }
  if (info.durationSeconds < MIN_SECONDS) return 'This video is shorter than a minute. PeakClip is made for full episodes.';
  return null;
}

export default function NewEpisode() {
  const [state, setState] = useState<State>({ kind: 'empty' });
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Ignores results from an earlier file if the user picks another one quickly.
  const latest = useRef(0);

  async function open(file: File | undefined) {
    if (!file) return;
    abortRef.current?.abort();
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name)) {
      setState({ kind: 'error', message: `"${file.name}" isn't a video. Choose your episode's video file (MP4, MOV or WebM).` });
      return;
    }
    const id = ++latest.current;
    setState({ kind: 'reading', file });
    try {
      // The video library is large, so it loads only when a file is chosen.
      const { probeEpisode } = await import('../lib/probe');
      const info = await probeEpisode(file);
      if (id !== latest.current) return;
      const problem = problemWith(info);
      setState(problem ? { kind: 'error', message: problem } : { kind: 'ready', file, info });
    } catch {
      if (id !== latest.current) return;
      setState({ kind: 'error', message: `We couldn't open "${file.name}". The file may be damaged or in a format we don't support yet.` });
    }
  }

  async function findClips(file: File, info: EpisodeInfo) {
    const abort = new AbortController();
    abortRef.current = abort;
    const steps = (prep: Step['state'], detail?: string): Step[] => [
      { label: 'Preparing the audio', state: prep, detail },
      { label: 'Listening to every word', state: prep === 'done' ? 'blocked' : 'waiting', detail: prep === 'done' ? 'Coming next: speech recognition is being connected.' : undefined },
      { label: 'Finding the best moments', state: 'waiting' },
    ];
    setState({ kind: 'processing', file, info, steps: steps('active'), percent: 0 });
    try {
      const { speechChunks, SPEECH_SAMPLE_RATE } = await import('../lib/audio');
      let seconds = 0;
      for await (const chunk of speechChunks(file, {
        signal: abort.signal,
        // Audio preparation is the first third of the whole job.
        onProgress: (p) => setState((st) => (st.kind === 'processing' ? { ...st, percent: p * 33 } : st)),
      })) {
        seconds = chunk.start + chunk.samples.length / SPEECH_SAMPLE_RATE;
      }
      if (abort.signal.aborted) return;
      setState((st) =>
        st.kind === 'processing' ? { ...st, steps: steps('done', `${formatDuration(seconds)} of audio ready`), percent: 33 } : st,
      );
    } catch (err) {
      if (abort.signal.aborted) return;
      setState({ kind: 'error', message: "We couldn't read this episode's audio. Try exporting it again as MP4 (H.264 + AAC)." });
      console.error(err);
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setState((st) => (st.kind === 'processing' ? { kind: 'ready', file: st.file, info: st.info } : st));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void open(e.dataTransfer.files[0]);
  }

  const ready = state.kind === 'ready' ? state : null;
  const length = ready?.info.durationSeconds ?? 0;
  const tooLong = !!ready && length > maxEpisodeSeconds + LIMIT_GRACE_SECONDS;
  const overLimit = !!ready && !tooLong && length > remainingSeconds + LIMIT_GRACE_SECONDS;
  const blocked = tooLong || overLimit;

  return (
    <main className="new-episode">
      <h1 className="page-title">New episode</h1>
      <p className="muted">
        {plan.name} plan ·{' '}
        {plan.episodesPerPeriod !== null
          ? `${plan.episodesPerPeriod} episode (up to ${formatDuration(maxEpisodeSeconds)}) left this ${plan.period}`
          : `${formatDuration(remainingSeconds)} of episodes left this ${plan.period}`}
      </p>

      {state.kind !== 'processing' && (
        <div
          className={`dropzone ${dragging ? 'dropzone-active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Meter bars={40} peaks={dragging ? [12, 13, 14, 27, 28] : []} className="meter-small" />
          <p className="dropzone-title">Drop your episode video here</p>
          <p className="muted small">MP4, MOV or WebM · any length</p>
          <button type="button" className="btn btn-outline btn-inline" onClick={() => inputRef.current?.click()}>
            Choose file
          </button>
          <input
            ref={inputRef}
            id="episode-file"
            type="file"
            accept="video/*,.mkv"
            hidden
            onChange={(e) => {
              void open(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {state.kind === 'reading' && <p className="muted" role="status">Opening {state.file.name}…</p>}

      {state.kind === 'processing' && (
        <>
          <p className="episode-name processing-name">{state.file.name}</p>
          <Progress steps={state.steps} percent={state.percent} onCancel={cancel} />
        </>
      )}

      {state.kind === 'error' && (
        <p className="error" role="alert">
          {state.message}
        </p>
      )}

      {ready && (
        <section className="card episode-card" aria-label="Selected episode">
          <p className="episode-name">{ready.file.name}</p>
          <dl className="episode-facts">
            <div>
              <dt>Length</dt>
              <dd>{formatDuration(ready.info.durationSeconds)}</dd>
            </div>
            <div>
              <dt>Video</dt>
              <dd>
                {ready.info.width}×{ready.info.height}
              </dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatSize(ready.file.size)}</dd>
            </div>
          </dl>
          {tooLong && (
            <p className="notice">
              This episode is {formatDuration(length)}. On the {plan.name} plan, episodes can be up to{' '}
              {formatDuration(maxEpisodeSeconds)} long. Upgrade to Pro for episodes of any length.
            </p>
          )}
          {overLimit && (
            <p className="notice">
              This episode is {formatDuration(length)} and you have {formatDuration(remainingSeconds)} left this{' '}
              {plan.period}. Upgrade to Pro for 10 hours a month.
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={blocked}
            onClick={() => void findClips(ready.file, ready.info)}
          >
            Find my best clips
          </button>
        </section>
      )}

      <p className="muted small">Your video and audio stay on your computer. Only the written transcript is sent to find the best moments.</p>
    </main>
  );
}
