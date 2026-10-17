import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { download } from '../components/ClipsScreen';
import { useAccount } from '../lib/account';
import { useAuth } from '../lib/auth';
import { formatDuration, formatSize } from '../lib/format';
import { deleteProject, listProjects, type ProjectSummary } from '../lib/projects';
import { keptFor } from './NewEpisode';
import { deleteAll, deleteClip, KEEP_DAYS, listClips, type LibraryClip } from '../lib/library';

const DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function daysLeft(c: LibraryClip) {
  const d = Math.ceil((c.expiresAt - Date.now()) / 86_400_000);
  return d <= 1 ? 'Deleted tomorrow' : `Deleted in ${d} days`;
}

/** The Library: saved episodes (work to come back to) and exported clips. */
export default function Library() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'clips' ? 'clips' : 'episodes';
  const { plan } = useAccount();
  const keep = plan.id === 'free' ? KEEP_DAYS.free : KEEP_DAYS.paid;
  const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);
  return (
    <main className="library">
      <h1 className="page-title">Library</h1>
      <p className="muted">
        Everything is kept for {days(keep)} after you last work on it, then deleted automatically.
        {plan.id === 'free' && (
          <>
            {' '}
            <Link to="/pricing">Pro keeps it {days(KEEP_DAYS.paid)}.</Link>
          </>
        )}
      </p>
      <div className="library-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'episodes'} className={`library-tab ${tab === 'episodes' ? 'on' : ''}`} onClick={() => setParams({}, { replace: true })}>
          Episodes
        </button>
        <button type="button" role="tab" aria-selected={tab === 'clips'} className={`library-tab ${tab === 'clips' ? 'on' : ''}`} onClick={() => setParams({ tab: 'clips' }, { replace: true })}>
          Exported clips
        </button>
      </div>
      {tab === 'episodes' ? <Episodes /> : <Clips />}
    </main>
  );
}

const WHEN = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Episodes() {
  const { user } = useAuth();
  const userId = user?.id ?? 'demo';
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    listProjects(userId).then(
      (l) => live && setList(l),
      (err) => {
        console.warn(err);
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [userId]);

  async function remove(p: ProjectSummary) {
    if (!window.confirm(`Delete "${p.fileName}" and its clips and edits? Your video file isn't touched.`)) return;
    await deleteProject(userId, p.fingerprint);
    setList((l) => l?.filter((x) => x.fingerprint !== p.fingerprint) ?? null);
  }

  if (failed) return <p className="error">We couldn't load your episodes. Check your internet connection and try again.</p>;
  if (!list) return <p className="muted">Loading…</p>;
  if (!list.length) {
    return (
      <div className="card">
        <p>No saved episodes. Your work on each episode is saved here automatically.</p>
      </div>
    );
  }
  return (
    <ol className="episode-list">
      {list.map((p) => (
        <li key={p.fingerprint} className="card episode-row">
          <b>{p.fileName}</b>
          <span className="muted small">
            {p.listening ? 'Listening in the cloud' : `${p.clipCount} clips`} · {formatDuration(p.info.durationSeconds)} · last change{' '}
            {WHEN.format(p.touchedAt)}
          </span>
          <span className="muted small">
            {keptFor(p.expiresAt)} · {p.videoHere ? 'Video on this device' : "You'll choose the video again on this device"}
          </span>
          <div className="library-actions">
            <Link to={`/new?episode=${encodeURIComponent(p.fingerprint)}`} className="btn btn-primary btn-inline">
              Open
            </Link>
            <button type="button" className="link-button" onClick={() => void remove(p)}>
              Delete
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Exported clips, kept on this device (never on our servers). */
function Clips() {
  const { user } = useAuth();
  const userId = user?.id ?? 'demo';
  const [clips, setClips] = useState<LibraryClip[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    void listClips(userId).then((list) => live && setClips(list));
    return () => {
      live = false;
    };
  }, [userId]);

  // One playable address per clip, freed when the page closes.
  useEffect(() => {
    if (!clips) return;
    const next = Object.fromEntries(clips.map((c) => [c.id, URL.createObjectURL(c.blob)]));
    setUrls(next);
    return () => Object.values(next).forEach((u) => URL.revokeObjectURL(u));
  }, [clips]);

  async function remove(id: string) {
    await deleteClip(id);
    setClips((list) => list?.filter((c) => c.id !== id) ?? null);
  }

  async function removeAll() {
    if (!window.confirm('Delete all your clips from this device? Download any you want to keep first.')) return;
    await deleteAll(userId);
    setClips([]);
  }

  async function share(c: LibraryClip) {
    const file = new File([c.blob], c.fileName, { type: c.blob.type });
    try {
      await navigator.share({ files: [file], title: c.title });
    } catch {
      // Closed the share sheet.
    }
  }
  const canShare = (c: LibraryClip) => {
    try {
      return !!navigator.canShare?.({ files: [new File([c.blob], c.fileName, { type: c.blob.type })] });
    } catch {
      return false;
    }
  };

  const total = clips?.reduce((n, c) => n + c.blob.size, 0) ?? 0;
  return (
    <>
      <p className="muted small">Exported clips stay on this device only. Download the ones you want to keep.</p>
      {clips === null ? (
        <p className="muted">Loading…</p>
      ) : !clips.length ? (
        <div className="card">
          <p>No clips yet. Clips appear here when you export them.</p>
        </div>
      ) : (
        <>
          <div className="library-head">
            <span className="muted small">
              {clips.length} {clips.length === 1 ? 'clip' : 'clips'} · {formatSize(total)} on this device
            </span>
            <button type="button" className="link-button" onClick={() => void removeAll()}>
              Delete all
            </button>
          </div>
          <ol className="library-list">
            {clips.map((c) => (
              <li key={c.id} className="card library-item">
                {urls[c.id] && <video src={urls[c.id]} controls playsInline preload="metadata" />}
                <div className="library-meta">
                  <b>{c.title}</b>
                  <span className="muted small">
                    {c.episode} · {Math.round(c.seconds)}s · {c.quality} · {DATE.format(c.createdAt)}
                  </span>
                  <span className="muted small">{daysLeft(c)}</span>
                  <div className="library-actions">
                    <button type="button" className="btn btn-primary btn-inline" onClick={() => urls[c.id] && download(urls[c.id]!, c.fileName)}>
                      Download
                    </button>
                    {canShare(c) && (
                      <button type="button" className="btn btn-outline btn-inline" onClick={() => void share(c)}>
                        Share
                      </button>
                    )}
                    <button type="button" className="link-button" onClick={() => void remove(c.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}
