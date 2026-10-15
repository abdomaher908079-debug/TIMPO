import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Caption from './Caption';
import { useAccount } from '../lib/account';
import {
  DEFAULT_KIT,
  deleteKit,
  ensureFont,
  FONTS,
  KIT_LIMITS,
  listKits,
  prepareLogo,
  saveKit,
  type BrandKit,
  type NewBrandKit,
} from '../lib/brandKits';
import { captionLook } from '../lib/clips';

const STYLE_NAMES = { bold: 'Bold', highlight: 'Highlight', boxed: 'Boxed' } as const;
const CORNERS = { 'top-left': 'Top left', 'top-right': 'Top right', 'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right' } as const;

// Brand kits on the Account page: your show's caption look and logo, used on every clip.
export default function BrandKits() {
  const { plan, workspace } = useAccount();
  const [kits, setKits] = useState<BrandKit[] | null>(null);
  const [editing, setEditing] = useState<(NewBrandKit & { id?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const workspaceId = workspace?.owner_id;
  const limit = KIT_LIMITS[plan.id];

  useEffect(() => {
    if (!workspaceId || plan.id === 'free') return;
    listKits(workspaceId)
      .then((list) => {
        setKits(list);
        list.forEach((k) => void ensureFont(k.font));
      })
      .catch((e: Error) => setError(e.message));
  }, [workspaceId, plan.id]);

  if (plan.id === 'free') {
    return (
      <section className="card account-card" id="brand-kits" aria-labelledby="kits-title">
        <h2 id="kits-title" className="account-section-title">Brand kits</h2>
        <p className="muted">
          Captions in your show's font and colors, and your logo instead of our watermark, on every clip. Pro includes 1 brand kit;
          Studio has 5, one per show. <Link to="#pricing">See plans</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="card account-card" id="brand-kits" aria-labelledby="kits-title">
      <div className="account-row">
        <h2 id="kits-title" className="account-section-title">Brand kits</h2>
        <span className="muted small">
          {kits?.length ?? 0} of {limit}
        </span>
      </div>
      <p className="muted small">Your show's caption look and logo. Pick one for any clip in the editor{plan.id === 'studio' ? '; your team shares them' : ''}.</p>
      {error && <p className="error">{error}</p>}

      {editing ? (
        <KitEditor
          kit={editing}
          onCancel={() => setEditing(null)}
          onSave={async (k) => {
            const saved = await saveKit(workspaceId!, plan.id, k);
            setKits((list) => (k.id ? (list ?? []).map((x) => (x.id === saved.id ? saved : x)) : [...(list ?? []), saved]));
            setEditing(null);
          }}
        />
      ) : (
        <>
          <ul className="kit-list">
            {kits?.map((k) => (
              <li key={k.id} className="kit-row">
                <KitPreview kit={k} small />
                <div className="kit-info">
                  <b>{k.name}</b>
                  <span className="muted small">
                    {k.font} · {STYLE_NAMES[k.style]}
                    {k.logo ? ' · logo' : ''}
                  </span>
                  <span className="kit-actions">
                    <button type="button" className="link-button" onClick={() => setEditing(k)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        if (!window.confirm(`Delete the brand kit "${k.name}"?`)) return;
                        deleteKit(k.id)
                          .then(() => setKits((list) => (list ?? []).filter((x) => x.id !== k.id)))
                          .catch((e: Error) => setError(e.message));
                      }}
                    >
                      Delete
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {kits && kits.length < limit && (
            <button type="button" className="btn btn-outline" onClick={() => setEditing({ ...DEFAULT_KIT, name: kits.length ? `Show ${kits.length + 1}` : 'My show' })}>
              New brand kit
            </button>
          )}
          {kits && kits.length >= limit && plan.id === 'pro' && (
            <p className="muted small">
              Have more than one show? Studio has 5 brand kits. <Link to="#pricing">See Studio</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}

function KitPreview({ kit, small }: { kit: NewBrandKit; small?: boolean }) {
  const { look } = captionLook({ captionStyle: 'bold', brandKitId: 'preview' }, [{ ...kit, id: 'preview', workspace_id: '' }]);
  return (
    <div className={`phone kit-preview ${small ? 'kit-preview-small' : ''}`} aria-hidden="true">
      {kit.logo && <img className={`phone-logo logo-${kit.logo_corner}`} src={kit.logo} alt="" />}
      <Caption caption={{ words: ['This', 'changed', 'everything'], active: 1 }} look={look} />
    </div>
  );
}

function KitEditor({ kit: initial, onSave, onCancel }: { kit: NewBrandKit & { id?: string }; onSave: (k: NewBrandKit & { id?: string }) => Promise<void>; onCancel: () => void }) {
  const [kit, setKit] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<NewBrandKit>) => setKit((k) => ({ ...k, ...patch }));

  useEffect(() => {
    void ensureFont(kit.font);
  }, [kit.font]);

  return (
    <form
      className="kit-editor"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        onSave({ ...kit, name: kit.name.trim() || 'My show' }).catch((err: Error) => {
          setError(err.message);
          setBusy(false);
        });
      }}
    >
      <KitPreview kit={kit} />
      <div className="kit-fields">
        <label className="field-label" htmlFor="kit-name">
          Name
        </label>
        <input id="kit-name" type="text" value={kit.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />

        <label className="field-label" htmlFor="kit-font">
          Font
        </label>
        <select id="kit-font" className="select" value={kit.font} onChange={(e) => set({ font: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>

        <span className="field-label">Caption style</span>
        <div className="segmented" role="radiogroup" aria-label="Caption style">
          {(Object.keys(STYLE_NAMES) as (keyof typeof STYLE_NAMES)[]).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={kit.style === s} className={kit.style === s ? 'on' : ''} onClick={() => set({ style: s })}>
              {STYLE_NAMES[s]}
            </button>
          ))}
        </div>

        <div className="color-row">
          <label>
            Text
            <input type="color" value={kit.text_color} onChange={(e) => set({ text_color: e.target.value })} />
          </label>
          {kit.style !== 'bold' && (
            <label>
              {kit.style === 'highlight' ? 'Spoken word' : 'Box'}
              <input type="color" value={kit.accent_color} onChange={(e) => set({ accent_color: e.target.value })} />
            </label>
          )}
        </div>

        <label className="field-label" htmlFor="kit-position">
          Caption position
        </label>
        <input
          id="kit-position"
          type="range"
          className="slider"
          min={0.15}
          max={0.8}
          step={0.01}
          value={kit.position}
          onChange={(e) => set({ position: Number(e.target.value) })}
        />
        <div className="slider-labels">
          <span>Higher</span>
          <span>Lower</span>
        </div>

        <span className="field-label">Logo</span>
        {kit.logo ? (
          <div className="logo-row">
            <img src={kit.logo} alt="Your logo" className="logo-thumb" />
            <select className="select" value={kit.logo_corner} onChange={(e) => set({ logo_corner: e.target.value as NewBrandKit['logo_corner'] })} aria-label="Logo corner">
              {Object.entries(CORNERS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <button type="button" className="link-button" onClick={() => set({ logo: null })}>
              Remove
            </button>
          </div>
        ) : (
          <label className="btn btn-outline btn-inline logo-upload">
            Add your logo
            <input
              type="file"
              accept="image/png,image/webp,image/jpeg,image/svg+xml"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) prepareLogo(file).then((logo) => set({ logo }), (err: Error) => setError(err.message));
              }}
            />
          </label>
        )}
        <p className="muted small">A PNG with a transparent background looks best.</p>

        {error && <p className="error">{error}</p>}
        <div className="kit-buttons">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {initial.id ? 'Save changes' : 'Create brand kit'}
          </button>
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
