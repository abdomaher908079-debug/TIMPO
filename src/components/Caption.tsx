import type { CSSProperties } from 'react';
import type { Caption as CaptionData, CaptionLook } from '../lib/clips';

// A caption as it will appear on the exported clip (drawCaption in lib/draw.ts draws the same).
// `inline` renders it small, for style samples.
export default function Caption({ caption, look, inline }: { caption: CaptionData; look: CaptionLook; inline?: boolean }) {
  if (look.style === 'none') return inline ? <span className="caption-off">Off</span> : null;
  const style = {
    fontFamily: `"${look.font}", Inter, system-ui, sans-serif`,
    fontWeight: look.weight,
    color: look.textColor,
    '--cap-accent': look.accentColor,
    '--cap-box': look.boxColor,
    ...(inline ? {} : { top: `${look.position * 100}%` }),
  } as CSSProperties;
  return (
    <span className={`caption caption-${look.style} ${inline ? 'caption-inline' : ''}`} style={style}>
      {caption.words.map((w, i) => (
        <span key={i} className={i === caption.active ? 'caption-word-on' : undefined}>
          {w}{' '}
        </span>
      ))}
    </span>
  );
}
