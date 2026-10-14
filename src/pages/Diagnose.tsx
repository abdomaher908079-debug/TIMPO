import { useState, type FormEvent } from 'react';
import ModelNumberHelp from '../components/ModelNumberHelp';
import DiagnosisResult from '../components/DiagnosisResult';
import { getAccessToken } from '../lib/auth';
import { resizeToJpeg } from '../lib/image';
import { APPLIANCES, MAX_PHOTOS, type Appliance, type DiagnoseResponse } from '../shared/types';

export default function Diagnose() {
  const [appliance, setAppliance] = useState<Appliance | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [modelNumber, setModelNumber] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DiagnoseResponse | null>(null);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setError(null);
    const room = MAX_PHOTOS - photos.length;
    const chosen = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (chosen.length < files.length) setError('Only photos can be added.');
    if (chosen.length > room) setError(`You can add up to ${MAX_PHOTOS} photos.`);
    const results = await Promise.allSettled(chosen.slice(0, room).map(resizeToJpeg));
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (ok.length < results.length) setError("Some photos couldn't be read. Try JPEG or PNG.");
    setPhotos((prev) => [...prev, ...ok].slice(0, MAX_PHOTOS));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!appliance) return setError('Choose which appliance has the problem.');
    if (photos.length === 0 && !description.trim()) return setError('Add a photo or describe the problem.');
    setError(null);
    setBusy(true);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ appliance, description, modelNumber, photos }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.diagnosis) {
        setError(data?.error ?? 'Something went wrong. Please try again.');
        return;
      }
      setResult(data as DiagnoseResponse);
      window.scrollTo(0, 0);
    } catch {
      setError("Couldn't reach FixMyCode. Check your internet connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setResult(null);
    setAppliance(null);
    setPhotos([]);
    setDescription('');
    setModelNumber('');
    window.scrollTo(0, 0);
  }

  if (result) return <DiagnosisResult result={result} onStartOver={startOver} />;

  return (
    <main className="diagnose">
      <h1 className="page-title">New diagnosis</h1>
      <form className="card" onSubmit={submit}>
        <p className="field-label">1. Which appliance?</p>
        <div className="chips" role="radiogroup" aria-label="Appliance">
          {APPLIANCES.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={appliance === a}
              className={`chip ${appliance === a ? 'chip-on' : ''}`}
              onClick={() => {
                setAppliance(a);
                setError(null);
              }}
            >
              {a}
            </button>
          ))}
        </div>

        <p className="field-label">2. Photos: the error display and the model label</p>
        <div className="photos">
          {photos.map((src, i) => (
            <div key={i} className="thumb">
              <img src={src} alt={`Photo ${i + 1}`} />
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => {
                  setPhotos((p) => p.filter((_, j) => j !== i));
                  setError(null);
                }}>
                ×
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label className="add-photo">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  void addPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
              <span>
                + Add
                <br />
                photo
              </span>
            </label>
          )}
        </div>

        <label className="field-label" htmlFor="description">
          3. What's happening?
        </label>
        <textarea
          id="description"
          rows={3}
          maxLength={2000}
          placeholder="e.g. Shows OE and water stays in the drum after the cycle"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setError(null);
          }}
        />

        <div className="label-row">
          <label className="field-label" htmlFor="model">
            4. Model number <span className="optional">(optional)</span>
          </label>
          <button type="button" className="link-button" onClick={() => setShowHelp(true)}>
            Where's my model number?
          </button>
        </div>
        <input
          id="model"
          type="text"
          maxLength={100}
          autoCapitalize="characters"
          placeholder="e.g. WM3400CW"
          value={modelNumber}
          onChange={(e) => setModelNumber(e.target.value)}
        />

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Diagnosing… (up to 30 seconds)' : 'Diagnose my appliance'}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
      <p className="muted small">⚠ Unplug the appliance and turn off the water before opening anything.</p>

      {showHelp && <ModelNumberHelp onClose={() => setShowHelp(false)} />}
    </main>
  );
}
