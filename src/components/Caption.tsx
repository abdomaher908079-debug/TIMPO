import type { Caption as CaptionData, CaptionStyleId } from '../lib/clips';

// A caption as it will appear on the exported clip. `inline` renders it small, for style samples.
export default function Caption({ caption, styleId, inline }: { caption: CaptionData; styleId: CaptionStyleId; inline?: boolean }) {
  return (
    <span className={`caption caption-${styleId} ${inline ? 'caption-inline' : ''}`}>
      {caption.words.map((w, i) => (
        <span key={i} className={i === caption.active ? 'caption-word-on' : undefined}>
          {w}{' '}
        </span>
      ))}
    </span>
  );
}
