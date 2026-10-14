import type { DiagnoseResponse } from '../shared/types';

// Part 3: a plain view of everything the AI returned, so we can check its
// answers. Part 4 turns this into the designed results page.
export default function DiagnosisResult({ result, onStartOver }: { result: DiagnoseResponse; onStartOver: () => void }) {
  const d = result.diagnosis;
  const heading = [d.brand, d.appliance, d.model_number && `Model ${d.model_number}`].filter(Boolean).join(' · ');

  return (
    <main className="result">
      {result.provider === 'sample' && (
        <p className="sample-banner">Sample answer: no AI key is set yet, so this is a fixed example, not a real diagnosis.</p>
      )}

      <section className="card">
        <div className="result-head">
          {d.error_code && <span className="lcd lcd-small">{d.error_code}</span>}
          <span className="muted small">{heading}</span>
        </div>
        <h1 className="result-summary">{d.summary}</h1>
        <p className="muted small">
          Difficulty: {d.difficulty.replace('_', ' ')} · Confidence: {d.confidence}
        </p>
        {d.need_more_info && <p className="notice">To be more sure: {d.need_more_info}</p>}
      </section>

      {d.safety_warnings.length > 0 && (
        <section className="card">
          <h2 className="section-title">Safety</h2>
          <ul>{d.safety_warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </section>
      )}

      {d.likely_causes.length > 0 && (
        <section className="card">
          <h2 className="section-title">Likely causes</h2>
          <ul>
            {d.likely_causes.map((c, i) => (
              <li key={i}>
                <strong>{c.cause}</strong> ({c.likelihood}): {c.explanation}
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.steps.length > 0 && (
        <section className="card">
          <h2 className="section-title">How to fix it</h2>
          <ol>{d.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </section>
      )}

      {d.parts.length > 0 && (
        <section className="card">
          <h2 className="section-title">Parts you may need</h2>
          <ul>
            {d.parts.map((p, i) => (
              <li key={i}>
                <strong>{p.name}</strong>: {p.plain_name}. {p.why}
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.call_a_pro_if.length > 0 && (
        <section className="card">
          <h2 className="section-title">Call a professional if…</h2>
          <ul>{d.call_a_pro_if.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </section>
      )}

      <button className="btn btn-primary" onClick={onStartOver}>
        Diagnose something else
      </button>
    </main>
  );
}
