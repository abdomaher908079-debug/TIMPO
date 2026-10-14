import { LOGO_BARS, LOGO_GREEN, LOGO_ORANGE, LOGO_PEAK } from '../lib/brand';

// `white` is the watermark version: white bars with the orange peak.
export default function LogoMark({ size = 22, white = false }: { size?: number; white?: boolean }) {
  // 5 bars of width 3 with gaps of 2 in a 23×24 box.
  return (
    <svg width={size} height={size} viewBox="0 0 23 24" aria-hidden="true" className="logo-mark">
      {LOGO_BARS.map((h, i) => (
        <rect key={i} x={i * 5} y={24 - h * 24} width={3} height={h * 24} rx={1.5} fill={i === LOGO_PEAK ? LOGO_ORANGE : white ? '#fff' : LOGO_GREEN} />
      ))}
    </svg>
  );
}
