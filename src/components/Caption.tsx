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
    ...(inline ? {} : { top: `${look.position * 100}%`, fontSize: look.size ? `calc(clamp(1.1rem, 6.5cqw, 1.7rem) * ${look.size})` : undefined }),
  } as CSSProperties;
  return (
    // dir="auto": Arabic and other right-to-left captions read from the right, like on the exported clip.
    <span className={`caption caption-${look.style} ${inline ? 'caption-inline' : ''} ${!inline && look.motion ? `caption-${look.motion}` : ''}`} style={style} dir="auto">
      {caption.words.map((w, i) => (
        <span
          key={i}
          className={[i === caption.active ? 'caption-word-on' : '', caption.emphasis?.[i] ? 'caption-word-em' : ''].join(' ').trim() || undefined}
        >
          {w}{' '}
        </span>
      ))}
    </span>
  );
}
