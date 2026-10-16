import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { download } from '../components/ClipsScreen';
import { useAccount } from '../lib/account';
import { useAuth } from '../lib/auth';
import { formatSize } from '../lib/format';
import { deleteAll, deleteClip, KEEP_DAYS, listClips, type LibraryClip } from '../lib/library';

const DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function daysLeft(c: LibraryClip) {
  const d = Math.ceil((c.expiresAt - Date.now()) / 86_400_000);
  return d <= 1 ? 'Deleted tomorrow' : `Deleted in ${d} days`;
}

/** "My clips": exported clips kept on this device for a while (never on our servers). */
export default function Library() {
  const { user } = useAuth();
  const { plan } = useAccount();
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
  const keep = plan.id === 'free' ? KEEP_DAYS.free : KEEP_DAYS.paid;
  return (
    <main className="library">
      <h1 className="page-title">My clips</h1>
      <p className="muted">
        Clips you export are kept on this device for {keep} days, then deleted automatically. Download the ones you want to keep.
        {plan.id === 'free' && (
          <>
            {' '}
            <Link to="/account">Pro keeps them {KEEP_DAYS.paid} days.</Link>
          </>
        )}
      </p>
      {clips === null ? (
        <p className="muted">Loading…</p>
      ) : !clips.length ? (
        <div className="card">
          <p>No clips yet. Clips appear here when you export them.</p>
          <Link to="/new" className="btn btn-primary btn-inline">
            New episode
          </Link>
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
    </main>
  );
}
