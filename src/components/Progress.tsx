import Meter from './Meter';

export type StepState = 'waiting' | 'active' | 'done' | 'blocked';

export interface Step {
  label: string;
  state: StepState;
  detail?: string;
}

export default function Progress({ steps, percent, onCancel }: { steps: Step[]; percent: number; onCancel?: () => void }) {
  const lit = Math.round((percent / 100) * 40);
  return (
    <section className="card progress-card" aria-live="polite">
      <Meter bars={40} peaks={Array.from({ length: lit }, (_, i) => i)} className="meter-progress" />
      <p className="progress-percent">{Math.round(percent)}%</p>
      <ol className="progress-steps">
        {steps.map((s) => (
          <li key={s.label} className={`step-${s.state}`}>
            <span className="step-dot" aria-hidden="true" />
            <span>
              {s.label}
              {s.detail && <span className="step-detail">{s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {onCancel && (
        <button type="button" className="btn btn-outline" onClick={onCancel}>
          Cancel
        </button>
      )}
    </section>
  );
}
