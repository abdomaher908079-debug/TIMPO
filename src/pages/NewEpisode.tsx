import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isPhone } from '../lib/device';
import Meter from '../components/Meter';
import ClipsScreen from '../components/ClipsScreen';
import Progress, { type Step } from '../components/Progress';
import { useAccount } from '../lib/account';
import { formatDuration, formatSize, type EpisodeInfo } from '../lib/format';
import { clipsFromMoments, type Clip } from '../lib/clips';
import { fingerprint, InLine } from '../lib/moments';
import { cloudAvailable, deviceLooksSlow } from '../lib/cloud';
import type { Segment } from '../lib/speech';
import { ApiError } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useWakeLock } from '../lib/wakeLock';
import { deleteProject, getProject, getVideo, isSameVideo, keepVideo, KEEP_DAYS, listProjects, saveProject, type Project, type ProjectSummary } from '../lib/projects';

const MIN_SECONDS = 60;

type State =
  | { kind: 'empty' }
  // `cloud`: listening on our server (`jobId` once the audio is sent), so leaving the page is fine.
  | { kind: 'processing'; file: File; info: EpisodeInfo; steps: Step[]; percent: number; cloud?: boolean; jobId?: string }
  | { kind: 'done'; file: File; info: EpisodeInfo; segments: Segment[]; clips: Clip[] }
  // Transcribing worked but picking moments didn't: keep the transcript so a retry is quick.
  // `limit` means the plan's limits stopped it, so trying again won't help.
  | { kind: 'moments-failed'; file: File; info: EpisodeInfo; segments: Segment[]; message: string; limit: boolean }
  | { kind: 'reading'; file: File }
  // Opening a saved episode (from the Library, or after a refresh).
  | { kind: 'opening' }
  // A saved episode whose video isn't on this device: choosing the same video again reopens it.
  | { kind: 'reopen'; project: Project }
  // `notice`: why cloud listening wasn't possible (e.g. the plan's limit).
  | { kind: 'ready'; file: File; info: EpisodeInfo; notice?: string }
  // `detail`: the technical reason, shown small so people can send it to us.
  // `retry`: listening on this device failed, so the same episode can go to the cloud instead.
  | { kind: 'error'; message: string; detail?: string; retry?: { file: File; info: EpisodeInfo } };

function restored(project: Project, file: File): State {
  const { info, segments, clips } = project;
  return clips.length ? { kind: 'done', file, info, segments, clips } : { kind: 'moments-failed', file, info, segments, message: 'Finding the best moments stopped.', limit: false };
}

const LANGUAGE_KEY = 'isla_episode_language';

// Under the cloud listening buttons: why phones have limits and computers don't.
const CLOUD_LIMITS_NOTE =
  'Phones listen in the cloud, using shared AI tools with daily limits, so on busy days an episode may wait in line. On a computer, Isla listens on your own device: no daily limits, and your audio stays with you.';

// Shown while the free AI's daily limit is used up and the episode waits in line.
const IN_LINE =
  'Isla is very busy today, so your episode is in line. It will finish on its own, usually within a few hours. You can close this page: your clips will be waiting here.';

// Listened to on this device; now finding the moments.
function momentSteps(detail?: string): Step[] {
  return [
    { label: 'Getting speech recognition ready', state: 'done' },
    { label: 'Listening to every word', state: 'done' },
    { label: 'Finding the best moments', state: 'active', detail },
  ];
}

function cloudSteps(phase: 0 | 1 | 2, detail?: string): Step[] {
  return [
    { label: 'Sending the audio', state: phase > 0 ? 'done' : 'active', detail: phase === 0 ? detail : undefined },
    {
      label: 'Listening to every word, in the cloud',
      state: phase > 1 ? 'done' : phase === 1 ? 'active' : 'waiting',
      detail: phase === 1 ? (detail === IN_LINE ? detail : `${detail} · you can leave this page, we'll keep going`) : undefined,
    },
    { label: 'Finding the best moments', state: phase === 2 ? 'active' : 'waiting', detail: phase === 2 ? detail : undefined },
  ];
}

function problemWith(info: EpisodeInfo): string | null {
  if (!info.audioCodec) return "This video has no sound. Isla needs the episode's audio to find the best moments.";
  if (!info.videoCodec) return 'This file has no video. Choose the video version of your episode.';
  if (!info.canDecodeVideo || !info.canDecodeAudio) {
    return "Your browser can't read this video format. Try exporting the episode as MP4 (H.264), or use the latest Chrome.";
  }
  if (info.durationSeconds < MIN_SECONDS) return 'This video is shorter than a minute. Isla is made for full episodes.';
  return null;
}

const RESETS = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export default function NewEpisode() {
  const { plan, usage, period, packs, check, recordDemoEpisode, refresh, loading: accountLoading } = useAccount();
  const [state, setState] = useState<State>({ kind: 'empty' });
  const { user } = useAuth();
  const userId = user?.id ?? 'demo';
  // Identifies each opened file, so retrying an episode doesn't use the plan twice.
  const fingerprints = useRef(new WeakMap<File, string>());

  const keepDays = plan.id === 'free' ? KEEP_DAYS.free : KEEP_DAYS.paid;
  // The open episode is in the address (?episode=…), so a refresh or a link from the Library opens it.
  const [params, setParams] = useSearchParams();
  const episodeParam = params.get('episode');
  const openFingerprint = 'file' in state ? fingerprints.current.get(state.file) : undefined;
  const openRef = useRef(openFingerprint);
  openRef.current = openFingerprint;
  useEffect(() => {
    if (!episodeParam || openRef.current === episodeParam) return;
    let live = true;
    setState({ kind: 'opening' });
    void (async () => {
      const project = await getProject(userId, episodeParam).catch((err) => (console.warn(err), null));
      if (!live) return;
      if (!project) {
        setParams({}, { replace: true });
        setState({
          kind: 'error',
          message: `This episode is no longer saved. Episodes are kept for ${KEEP_DAYS.free} day on Free and ${KEEP_DAYS.paid} days on Pro and Studio after you last work on them.`,
        });
        return;
      }
      const file = await getVideo(userId, project.fingerprint);
      if (!live) return;
      if (!file) return setState({ kind: 'reopen', project });
      fingerprints.current.set(file, project.fingerprint);
      reopen(project, file);
    })();
    return () => {
      live = false;
    };
  }, [episodeParam, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // An episode with saved work goes in the address once it's open.
  const savable = state.kind === 'done' || state.kind === 'moments-failed' || (state.kind === 'processing' && !!state.cloud);
  useEffect(() => {
    if (savable && openFingerprint && episodeParam !== openFingerprint) setParams({ episode: openFingerprint }, { replace: true });
  }, [savable, openFingerprint, episodeParam, setParams]);

  // Save the work as it changes: the transcript once, the clips after every edit. The video stays
  // on this device only.
  const savedSegments = useRef<Segment[] | null>(null);
  const keptVideo = useRef<File | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'failed' | null>(null);
  useEffect(() => {
    if (state.kind !== 'done' && state.kind !== 'moments-failed') return;
    const fp = fingerprints.current.get(state.file);
    if (!fp) return;
    setSaveStatus('saving');
    const id = setTimeout(() => {
      const full = savedSegments.current !== state.segments;
      saveProject(
        userId,
        {
          fingerprint: fp,
          fileName: state.file.name,
          fileSize: state.file.size,
          info: state.info,
          segments: state.segments,
          clips: state.kind === 'done' ? state.clips : [],
          listening: false,
        },
        full,
        keepDays,
      ).then(
        () => {
          savedSegments.current = state.segments;
          setSaveStatus('saved');
        },
        (err) => {
          console.warn('Episode not saved', err);
          setSaveStatus('failed');
        },
      );
      if (keptVideo.current !== state.file) {
        keptVideo.current = state.file;
        void keepVideo(userId, fp, state.file);
      }
    }, 800);
    return () => clearTimeout(id);
  }, [state, userId, keepDays]);

  // Leaving while an episode is being listened to on this device would lose that work (in the
  // cloud it carries on, once the audio is sent).
  const processing = state.kind === 'processing';
  useWakeLock(processing);
  const mustStay = processing && !(state.kind === 'processing' && state.jobId);
  useEffect(() => {
    if (!mustStay) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [mustStay]);
  // Phones and computers without a graphics card get cloud listening by default.
  const [slowDevice, setSlowDevice] = useState(false);
  useEffect(() => {
    if (cloudAvailable) void deviceLooksSlow().then(setSlowDevice);
  }, []);
  // The language spoken: listening on this device only understands English, so other languages
  // (Arabic, …) are listened to in the cloud. Arabic browsers start on "another language".
  const [english, setEnglishState] = useState(() => {
    try {
      const saved = localStorage.getItem(LANGUAGE_KEY);
      if (saved) return saved === 'en';
    } catch {
      // Blocked storage: fall back to the browser's language.
    }
    return !/^ar\b/i.test(navigator.language);
  });
  const setEnglish = (value: boolean) => {
    setEnglishState(value);
    try {
      localStorage.setItem(LANGUAGE_KEY, value ? 'en' : 'other');
    } catch {
      // Not remembered; it still applies now.
    }
  };
  // Cloud listening by default: slow devices, and every language but English.
  const cloudFirst = cloudAvailable && (slowDevice || !english);
  // The speech model's first download is the longest wait of a first episode, so on devices that will listen
  // themselves it starts as soon as people are choosing their episode (the same model, from the browser's cache
  // afterwards). Not on phones or slow computers, which listen in the cloud.
  const choosing = state.kind === 'empty' || state.kind === 'reading' || state.kind === 'ready';
  useEffect(() => {
    if (!choosing || accountLoading || !english) return;
    let on = true;
    void (cloudAvailable ? deviceLooksSlow() : Promise.resolve(false)).then(async (slow) => {
      if (!on || slow) return;
      const { warmSpeech } = await import('../lib/speech');
      if (on) warmSpeech(plan.quality);
    });
    return () => {
      on = false;
    };
  }, [choosing, accountLoading, english, plan.quality]);
  // Freed when people leave this page, unless it's back by then (React mounts it twice in development).
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void import('../lib/speech').then(({ releaseSpeech }) => !mounted.current && releaseSpeech());
    };
  }, []);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Ignores results from an earlier file if the user picks another one quickly.
  const latest = useRef(0);

  const stateRef = useRef(state);
  stateRef.current = state;
  // Saved work: clips open as they were; an episode still with the cloud continues there.
  function reopen(project: Project, file: File) {
    savedSegments.current = project.segments.length ? project.segments : null;
    if (project.listening && !project.segments.length) void findClipsInCloud(file, project.info);
    else setState(restored(project, file));
  }

  const reopening = useRef<Project | null>(null);
  reopening.current = state.kind === 'reopen' ? state.project : null;

  async function open(file: File | undefined) {
    if (!file) return;
    abortRef.current?.abort();
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name)) {
      setState({ kind: 'error', message: `"${file.name}" isn't a video. Choose your episode's video file (MP4, MOV or WebM).` });
      return;
    }
    const id = ++latest.current;
    // The saved episode waiting for its video, before "reading" replaces it.
    const saved = reopening.current;
    setState({ kind: 'reading', file });
    try {
      // The video library is large, so it loads only when a file is chosen.
      const { probeEpisode } = await import('../lib/probe');
      const info = await probeEpisode(file);
      const fp = await fingerprint(file, info.durationSeconds);
      fingerprints.current.set(file, fp);
      if (id !== latest.current) return;
      // The video of a saved episode, chosen again (maybe renamed, or on another device): reopen it.
      if (saved && isSameVideo(saved, file, fp, info.durationSeconds)) {
        fingerprints.current.set(file, saved.fingerprint);
        void keepVideo(userId, saved.fingerprint, file);
        keptVideo.current = file;
        reopen(saved, file);
        return;
      }
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
    const total = info.durationSeconds;
    let loading = 'Starting…';
    let device = '';
    let listening = '';
    const steps = (phase: 0 | 1 | 2): Step[] => [
      { label: 'Getting speech recognition ready', state: phase > 0 ? 'done' : 'active', detail: phase > 0 ? device : loading },
      { label: 'Listening to every word', state: phase > 1 ? 'done' : phase === 1 ? 'active' : 'waiting', detail: phase >= 1 ? listening : undefined },
      { label: 'Finding the best moments', state: phase === 2 ? 'active' : 'waiting' },
    ];
    const update = (phase: 0 | 1 | 2, percent: number) =>
      setState((st) => (st.kind === 'processing' && abortRef.current === abort ? { ...st, steps: steps(phase), percent } : st));

    setState({ kind: 'processing', file, info, steps: steps(0), percent: 0 });
    let segments: Segment[];
    try {
      // Speech recognition is large, so it loads only when it's needed.
      const { transcribeEpisode } = await import('../lib/speech');
      let listenStart = 0;
      segments = await transcribeEpisode(file, {
        signal: abort.signal,
        quality: plan.quality,
        onLoading: (loaded, size) => {
          loading = `Downloading ${Math.round(loaded / 1e6)} of ${Math.round(size / 1e6)} MB · only the first time`;
          update(0, (loaded / size) * 10);
        },
        onReady: (d, model) => {
          const where = `running on your ${d === 'webgpu' ? 'graphics card' : 'processor'}`;
          device =
            plan.quality === 'quick'
              ? `Quick AI · ${where}`
              : model === 'best'
                ? `Best AI · ${where}`
                : // Paid plan on a computer without a graphics card: the larger speech model would be too slow.
                  `Best AI · ${where}. The larger speech model needs a graphics card; moments are still picked by Best AI`;
          listening = `0 of ${formatDuration(total)}`;
          listenStart = performance.now();
          update(1, 10);
        },
        onProgress: (seconds) => {
          const elapsed = (performance.now() - listenStart) / 1000;
          const left = seconds > 0 ? (elapsed / seconds) * (total - seconds) : 0;
          listening = `${formatDuration(Math.min(seconds, total))} of ${formatDuration(total)}`;
          if (left > 30) listening += ` · about ${Math.round(left / 60) || 1} min left`;
          update(1, 10 + 80 * Math.min(1, seconds / total));
        },
      });
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error(err);
      setState({
        kind: 'error',
        message: cloudAvailable
          ? "This device couldn't listen to the episode. Let our cloud listen instead, it only takes the audio."
          : "We couldn't listen to this episode. Try the latest Chrome or Edge, or export the episode again as MP4 (H.264 + AAC).",
        detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        retry: cloudAvailable ? { file, info } : undefined,
      });
      return;
    }
    if (!segments.length) {
      setState({ kind: 'error', message: "We didn't hear anyone speaking in this episode. Check that it has the podcast's audio." });
      return;
    }
    listening = `${segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0).toLocaleString()} words heard`;
    update(2, 92);
    await pickBest(file, info, segments, abort);
  }

  // For devices too slow to listen in the browser: only the audio is uploaded, a few minutes at a
  // time; our server listens and picks the moments on its own, so people can leave the page once
  // the audio is sent. Captions' word timing still happens on the device when exporting.
  async function findClipsInCloud(file: File, info: EpisodeInfo) {
    // Not listening on this device after all.
    void import('../lib/speech').then(({ releaseSpeech }) => releaseSpeech());
    const abort = new AbortController();
    abortRef.current = abort;
    const fp = fingerprints.current.get(file)!;
    setState({ kind: 'processing', file, info, steps: cloudSteps(0, 'Only the audio, never the video'), percent: 0, cloud: true });
    // Saved right away, so a closed tab, a refresh or another device comes back to this episode.
    void saveProject(userId, { fingerprint: fp, fileName: file.name, fileSize: file.size, info, segments: [], clips: [], listening: true }, true, keepDays).catch(
      (err) => console.warn('Episode not saved', err),
    );
    keptVideo.current = file;
    void keepVideo(userId, fp, file);
    let jobId: string;
    try {
      const { sendToCloud } = await import('../lib/cloud');
      jobId = await sendToCloud(file, info.durationSeconds, fp, {
        signal: abort.signal,
        onProgress: (p) => update(abort, cloudSteps(0, `${Math.round(p * 100)}% · keep this page open for a moment`), p * 20),
      });
    } catch (err) {
      return cloudFailed(abort, err);
    }
    setState((st) => (st.kind === 'processing' && abortRef.current === abort ? { ...st, jobId } : st));
    await followCloud(file, info, jobId, abort);
  }

  // `local`: listened to on this device, only the moments are in line on our server.
  async function followCloud(file: File, info: EpisodeInfo, jobId: string, abort: AbortController, local = false) {
    let job;
    try {
      const { followJob } = await import('../lib/cloud');
      job = await followJob(jobId, {
        signal: abort.signal,
        onUpdate: (j) => {
          const detail = j.waiting_until ? IN_LINE : undefined;
          if (j.status === 'finishing') return update(abort, local ? momentSteps(detail) : cloudSteps(2, detail), 95);
          if (j.waiting_until) return update(abort, cloudSteps(1, IN_LINE), 20 + (j.pieces ? j.pieces_done / j.pieces : 0) * 72);
          const p = j.pieces ? j.pieces_done / j.pieces : 0;
          update(abort, cloudSteps(1, `${formatDuration(p * info.durationSeconds)} of ${formatDuration(info.durationSeconds)}`), 20 + p * 72);
        },
      });
    } catch (err) {
      return cloudFailed(abort, err);
    }
    if (abort.signal.aborted) return;
    if (job.status === 'done' && job.moments?.length && job.segments?.length) {
      setState({ kind: 'done', file, info, segments: job.segments, clips: clipsFromMoments(job.moments) });
      recordDemoEpisode(fingerprints.current.get(file)!, info.durationSeconds);
      void refresh();
    } else if (job.status === 'done' && job.segments?.length) {
      // Heard, but picking the moments stopped (often a busy AI): try once more from here.
      update(abort, cloudSteps(2), 95);
      await pickBest(file, info, job.segments, abort);
    } else {
      cloudFailed(abort, new Error(job.error ?? 'Cloud listening stopped. Please try again.'));
    }
  }

  // A saved episode that never got its transcript isn't worth keeping.
  function forgetUnheard() {
    const st = stateRef.current;
    const fp = 'file' in st ? fingerprints.current.get(st.file) : undefined;
    if (fp) void deleteProject(userId, fp).catch(() => {});
    setParams({}, { replace: true });
  }

  function cloudFailed(abort: AbortController, err: unknown) {
    if (abort.signal.aborted) return;
    console.error(err);
    forgetUnheard();
    if (err instanceof ApiError && err.status === 403) {
      setState((st) => (st.kind === 'processing' ? { kind: 'ready', file: st.file, info: st.info, notice: err.message } : st));
      return;
    }
    setState({ kind: 'error', message: err instanceof Error ? err.message : 'Cloud listening stopped. Please try again.' });
  }

  const update = (abort: AbortController, steps: Step[], percent: number) =>
    setState((st) => (st.kind === 'processing' && abortRef.current === abort ? { ...st, steps, percent } : st));

  async function pickBest(file: File, info: EpisodeInfo, segments: Segment[], abort: AbortController) {
    abortRef.current = abort;
    try {
      const { findMoments } = await import('../lib/moments');
      const fp = fingerprints.current.get(file)!;
      const moments = await findMoments(
        segments,
        { count: plan.clipsFound, quality: plan.quality },
        { fingerprint: fp, seconds: info.durationSeconds },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      setState({ kind: 'done', file, info, segments, clips: clipsFromMoments(moments) });
      // The server has counted this episode; show the new usage (demo mode counts it here).
      recordDemoEpisode(fp, info.durationSeconds);
      void refresh();
    } catch (err) {
      if (abort.signal.aborted) return;
      if (err instanceof InLine) return waitInLine(file, info, err.jobId, abort);
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'moments-failed', file, info, segments, message, limit: err instanceof ApiError && err.status === 403 });
    }
  }

  // The AI's daily limit is used up: the moments are picked later on our server, so this page can close.
  async function waitInLine(file: File, info: EpisodeInfo, jobId: string, abort: AbortController) {
    const fp = fingerprints.current.get(file)!;
    // Saved as an episode still with the cloud: coming back follows the same job (its transcript is there).
    void saveProject(userId, { fingerprint: fp, fileName: file.name, fileSize: file.size, info, segments: [], clips: [], listening: true }, true, keepDays).catch(
      (err) => console.warn('Episode not saved', err),
    );
    setState({ kind: 'processing', file, info, steps: momentSteps(IN_LINE), percent: 95, cloud: true, jobId });
    await followCloud(file, info, jobId, abort, true);
  }

  function retryMoments(file: File, info: EpisodeInfo, segments: Segment[]) {
    const abort = new AbortController();
    setState({ kind: 'processing', file, info, steps: momentSteps(), percent: 92 });
    void pickBest(file, info, segments, abort);
  }

  function cancel() {
    abortRef.current?.abort();
    if (state.kind === 'processing' && state.cloud) {
      if (state.jobId) void import('../lib/cloud').then(({ cancelJob }) => cancelJob(state.jobId!));
      forgetUnheard();
    }
    setState((st) => (st.kind === 'processing' ? { kind: 'ready', file: st.file, info: st.info } : st));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void open(e.dataTransfer.files[0]);
  }

  const ready = state.kind === 'ready' ? state : null;
  const limitProblem = ready ? check(ready.info.durationSeconds, fingerprints.current.get(ready.file)) : null;
  const remainingSeconds = Math.max(0, plan.hours * 3600 - usage.seconds);
  const episodesLeft = plan.episodesPerPeriod === null ? null : Math.max(0, plan.episodesPerPeriod - usage.episodes);

  return (
    <main className={`new-episode ${state.kind === 'done' ? 'new-episode-wide' : ''}`}>
      <h1 className="page-title">New episode</h1>
      <p className="muted">
        {accountLoading ? (
          'Loading your plan…'
        ) : (
          <>
            <Link to="/account">{plan.name} plan</Link> ·{' '}
            {episodesLeft !== null && plan.id === 'free'
              ? `${episodesLeft} of ${plan.episodesPerPeriod} episode${plan.episodesPerPeriod === 1 ? '' : 's'} left this ${plan.period}`
              : `${formatDuration(remainingSeconds)} of ${plan.hours} hours left this ${plan.period}` +
                (episodesLeft !== null && episodesLeft <= 5 ? ` (${episodesLeft} episode${episodesLeft === 1 ? '' : 's'} left)` : '') +
                (packs.seconds > 0 ? ` + ${formatDuration(packs.seconds)} extra` : '')}{' '}
            · resets {RESETS.format(period.end)}
          </>
        )}
      </p>

      {(state.kind === 'done' || state.kind === 'moments-failed') && (
        <section aria-label="Results">
          <p className="episode-name processing-name">{state.file.name}</p>
          {state.kind === 'done' ? (
            <ClipsScreen
              file={state.file}
              duration={state.info.durationSeconds}
              segments={state.segments}
              clips={state.clips}
              onChange={(clips) => setState((st) => (st.kind === 'done' ? { ...st, clips } : st))}
              exportable={plan.clipsExportable}
              planName={plan.name}
              watermark={plan.watermark}
              // 4K is too heavy for phones: it can freeze the whole device.
              pro4k={plan.maxExport === '4k'}
              allow4k={plan.maxExport === '4k' && !isPhone}
              quality={plan.quality}
            />
          ) : (
            <div className="card">
              {state.limit ? (
                <UpgradeNotice message={state.message} planName={plan.name} />
              ) : (
                <>
                  <p className="error" role="alert">
                    {state.message}
                  </p>
                  <p className="muted small">The episode's words are saved, so trying again only takes a moment.</p>
                  <button type="button" className="btn btn-primary" onClick={() => retryMoments(state.file, state.info, state.segments)}>
                    Try again
                  </button>
                </>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              // This one stays saved in the Library.
              setParams({}, { replace: true });
              setState({ kind: 'empty' });
            }}
          >
            Start a new episode
          </button>
          <p className="muted small save-status" role="status">
            {saveStatus === 'saving' && 'Saving…'}
            {saveStatus === 'saved' && (
              <>
                Saved in your <Link to="/library">Library</Link> for {keepDays === 1 ? '1 day' : `${keepDays} days`} after your last change.
                {plan.id === 'free' && (
                  <>
                    {' '}
                    <Link to="/pricing">Pro keeps it {KEEP_DAYS.paid} days.</Link>
                  </>
                )}
              </>
            )}
            {saveStatus === 'failed' && "Couldn't save to your Library right now. Your work is still here; we'll try again with your next change."}
          </p>
        </section>
      )}

      {state.kind !== 'processing' && state.kind !== 'done' && state.kind !== 'moments-failed' && (
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

      {state.kind === 'reopen' && (
        <div className="notice" role="status">
          {state.project.clips.length ? `Your ${state.project.clips.length} clips from ` : 'Your work on '}
          <b>{state.project.fileName}</b> {state.project.clips.length ? 'are' : 'is'} saved, but the video isn't on this device.
          Choose that video again to continue where you left off.{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setParams({}, { replace: true });
              setState({ kind: 'empty' });
            }}
          >
            Start a new episode instead
          </button>
        </div>
      )}

      {state.kind === 'opening' && <p className="muted" role="status">Opening your episode…</p>}

      {(state.kind === 'empty' || state.kind === 'error') && <RecentEpisodes userId={userId} />}

      {state.kind === 'reading' && <p className="muted" role="status">Opening {state.file.name}…</p>}

      {state.kind === 'processing' && (
        <>
          <p className="episode-name processing-name">{state.file.name}</p>
          <Progress steps={state.steps} percent={state.percent} onCancel={cancel} file={state.file} />
        </>
      )}

      {state.kind === 'error' && (
        <p className="error" role="alert">
          {state.message}
          {state.detail && (
            <small style={{ display: 'block', marginTop: 6, opacity: 0.75, wordBreak: 'break-word' }}>
              Details: {state.detail} · <Link to="/diagnose">Check my browser</Link>
            </small>
          )}
        </p>
      )}
      {state.kind === 'error' && state.retry && (
        <button type="button" className="btn btn-primary" onClick={() => void findClipsInCloud(state.retry!.file, state.retry!.info)}>
          Find my best clips in the cloud
        </button>
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
          {limitProblem && <UpgradeNotice message={limitProblem.message} planName={plan.name} />}
          {!limitProblem && ready.notice && <UpgradeNotice message={ready.notice} planName={plan.name} />}
          <div className="lang-choice" role="group" aria-label="Language spoken in the episode">
            <span>Language spoken</span>
            <button type="button" className={english ? 'on' : ''} aria-pressed={english} onClick={() => setEnglish(true)}>
              English
            </button>
            <button type="button" className={!english ? 'on' : ''} aria-pressed={!english} onClick={() => setEnglish(false)}>
              Arabic or another language
            </button>
          </div>
          {cloudFirst ? (
            <>
              <p className="notice">
                {slowDevice
                  ? "This device would take a long time to listen to a full episode, so we'll listen in the cloud"
                  : 'Listening on this computer only understands English, so for this language we listen in the cloud'}
                : only the audio (never the video) is sent to our AI to write down what's said, and we delete it right after.
                Once the audio is sent you can leave this page; your clips will be waiting here.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!!limitProblem || accountLoading}
                onClick={() => void findClipsInCloud(ready.file, ready.info)}
              >
                Find my best clips in the cloud
              </button>
              {english && (
                <button
                  type="button"
                  className="link-button cloud-alt"
                  disabled={!!limitProblem || accountLoading}
                  onClick={() => void findClips(ready.file, ready.info)}
                >
                  Use this device instead
                </button>
              )}
              <p className="muted small cloud-limits">{CLOUD_LIMITS_NOTE}</p>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!!limitProblem || accountLoading}
                onClick={() => void findClips(ready.file, ready.info)}
              >
                Find my best clips
              </button>
              {cloudAvailable && (
                <button
                  type="button"
                  className="link-button cloud-alt"
                  disabled={!!limitProblem || accountLoading}
                  onClick={() => void findClipsInCloud(ready.file, ready.info)}
                >
                  Slow computer? Listen in the cloud (sends the audio only)
                </button>
              )}
              {cloudAvailable && <p className="muted small cloud-limits">{CLOUD_LIMITS_NOTE}</p>}
            </>
          )}
          {plan.quality === 'quick' && <QuickAiNote />}
        </section>
      )}

      <p className="muted small">
        {cloudFirst
          ? "Your video stays on your device. The audio and transcript are sent to our AI to listen and find the best moments."
          : "Your video and audio stay on your computer. Only the written transcript is sent to our AI to find the best moments."}{' '}
        <Link to="/privacy">How we handle your data</Link>
      </p>
    </main>
  );
}

function UpgradeNotice({ message, planName }: { message: string; planName: string }) {
  return (
    <p className="notice" role="alert">
      {message}{' '}
      {planName === 'Studio' ? (
        'Your hours reset at the start of your next billing month.'
      ) : (
        <>
          <Link to="/pricing">Upgrade</Link> for more hours and episodes of any length.
        </>
      )}
    </p>
  );
}

// Free uses our quick AI; be upfront that Pro's is better.
export function QuickAiNote() {
  return (
    <p className="quality-note">
      <b>Free uses our Quick AI.</b> It finds good clips fast. Pro and Studio use our Best AI: a larger speech model that hears
      every word more accurately (sharper captions) and our strongest AI for picking the moments that will perform.{' '}
      <Link to="/pricing">See Pro</Link>
    </p>
  );
}

const WHEN = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function keptFor(expiresAt: number): string {
  const hours = (expiresAt - Date.now()) / 3_600_000;
  if (hours < 1) return 'Deleted within the hour';
  if (hours < 48) return `Deleted in ${Math.round(hours)} hours`;
  return `Deleted in ${Math.round(hours / 24)} days`;
}

// The latest saved episodes, to pick up where you left off.
function RecentEpisodes({ userId }: { userId: string }) {
  const [list, setList] = useState<ProjectSummary[]>([]);
  useEffect(() => {
    let live = true;
    listProjects(userId).then(
      (l) => live && setList(l.slice(0, 3)),
      (err) => console.warn('Saved episodes unavailable', err),
    );
    return () => {
      live = false;
    };
  }, [userId]);
  if (!list.length) return null;
  return (
    <section className="recent" aria-label="Your saved episodes">
      <div className="recent-head">
        <h2 className="recent-title">Continue where you left off</h2>
        <Link to="/library" className="small">
          All episodes
        </Link>
      </div>
      <ul className="recent-list">
        {list.map((p) => (
          <li key={p.fingerprint}>
            <Link to={`/new?episode=${encodeURIComponent(p.fingerprint)}`} className="recent-item">
              <b>{p.fileName}</b>
              <span className="muted small">
                {p.listening ? 'Listening in the cloud' : `${p.clipCount} clips`} · {formatDuration(p.info.durationSeconds)} · {WHEN.format(p.touchedAt)}
              </span>
              <span className="muted small">{keptFor(p.expiresAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
