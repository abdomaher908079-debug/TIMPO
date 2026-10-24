import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { SOURCES, storedRef } from '../lib/source';
import { supabase } from '../lib/supabase';

// Asked once, to accounts made in the last 30 days: "How did you hear about Isla?" One tap to answer,
// one to skip; either way it isn't asked again.
const ASK_FOR_DAYS = 30;

export default function SourceQuestion() {
  const { user, demo } = useAuth();
  const [show, setShow] = useState(false);
  const [other, setOther] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || demo || !supabase) return;
    const db = supabase;
    let live = true;
    void (async () => {
      const { data: me } = await db.auth.getUser();
      const created = me.user?.created_at ? new Date(me.user.created_at).getTime() : 0;
      if (Date.now() - created > ASK_FOR_DAYS * 86_400_000) return;
      // A row with only the link (saved at sign-up) hasn't been asked yet.
      const { data } = await db.from('signup_sources').select('answer').eq('user_id', user.id).maybeSingle();
      if (live && !data?.answer) setShow(true);
    })();
    return () => {
      live = false;
    };
  }, [user, demo]);

  if (!show || !user || !supabase) return null;

  async function save(answer: string, detail?: string) {
    if (!user || !supabase) return;
    setBusy(true);
    // Without `ref` when this browser doesn't know it, so the link saved at sign-up isn't wiped.
    const ref = storedRef();
    await supabase.from('signup_sources').upsert({ user_id: user.id, answer, detail: detail?.trim().slice(0, 200) || null, ...(ref ? { ref } : {}) });
    setShow(false);
  }

  return (
    <section className="card source-question" aria-labelledby="source-title">
      <p id="source-title" className="source-title">
        Quick question: how did you hear about Isla?
      </p>
      {other === null ? (
        <div className="source-chips">
          {SOURCES.map(([id, label]) => (
            <button key={id} type="button" className="source-chip" disabled={busy} onClick={() => (id === 'other' ? setOther('') : void save(id))}>
              {label}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="source-other"
          onSubmit={(e) => {
            e.preventDefault();
            void save('other', other);
          }}
        >
          <input autoFocus value={other} maxLength={200} placeholder="Where? (a website, a person…)" onChange={(e) => setOther(e.target.value)} />
          <button type="submit" className="btn btn-primary btn-inline" disabled={busy}>
            Send
          </button>
        </form>
      )}
      <button type="button" className="link-button source-skip" disabled={busy} onClick={() => void save('skipped')}>
        Skip
      </button>
    </section>
  );
}
