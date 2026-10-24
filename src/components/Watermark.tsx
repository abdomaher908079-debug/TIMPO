import LogoMark from './LogoMark';
import { BRAND_NAME } from '../lib/brand';

// Preview of the Free plan's watermark, placed like the one drawn on exported clips (lib/draw.ts).
export default function Watermark() {
  return (
    <span className="watermark" aria-label={`Watermark: Made with ${BRAND_NAME}`}>
      <LogoMark size={16} />
      Made with {BRAND_NAME}
    </span>
  );
}
