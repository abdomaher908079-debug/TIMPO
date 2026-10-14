// Decorative audio-level waveform. Bars at `peaks` positions glow, like the
// moments Hookcut picks out of an episode.
export default function Meter({ bars = 60, peaks = [], className = '' }: { bars?: number; peaks?: number[]; className?: string }) {
  const hot = new Set(peaks);
  return (
    <div className={`meter ${className}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => {
        const h = Math.round(18 + 72 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.37)));
        return <i key={i} className={hot.has(i) ? 'hot' : undefined} style={{ height: `${h}%` }} />;
      })}
    </div>
  );
}
