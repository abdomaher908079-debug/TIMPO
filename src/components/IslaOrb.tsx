import { useEffect, useId, useState } from 'react';
import { ORB } from '../lib/brand';

export type IslaMood = 'idle' | 'listening' | 'found' | 'done';

// The fixed body shape; the living version morphs between these (SMIL works in every browser).
const SHAPES = [
  'M80 22 C113 22 138 47 138 80 C138 113 113 138 80 138 C47 138 22 113 22 80 C22 47 47 22 80 22 Z',
  'M82 20 C118 24 140 50 136 82 C132 116 110 140 78 138 C44 136 20 112 24 78 C28 46 48 18 82 20 Z',
  'M78 24 C112 18 142 46 138 80 C134 114 114 136 80 140 C46 142 24 116 22 82 C20 48 44 30 78 24 Z',
];

/**
 * Isla, the agent: a living green-to-orange orb with a glass visor and two eye-lights.
 * `mood` changes her eyes, `look` (-1..1 on each axis) where she's looking, and `still` turns off
 * all movement (logos, small icons). People who prefer less motion always get her still.
 */
export default function IslaOrb({
  size = 120,
  mood = 'idle',
  look = { x: 0, y: 0 },
  still = false,
  className = '',
}: {
  size?: number;
  mood?: IslaMood;
  look?: { x: number; y: number };
  still?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const calm = usePrefersReducedMotion();
  if (calm) still = true;
  const eyeColor = mood === 'found' ? ORB.orange : ORB.green;
  const dx = Math.max(-1, Math.min(1, look.x)) * 6;
  const dy = Math.max(-1, Math.min(1, look.y)) * 3;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      className={`isla-orb ${still ? '' : 'isla-live'} isla-${mood} ${className}`}
      role="img"
      aria-label="Isla"
    >
      <defs>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b4ff5a" />
          <stop offset=".45" stopColor="#e6bd22" />
          <stop offset="1" stopColor={ORB.orange} />
        </linearGradient>
        <radialGradient id={`s${id}`} cx="35%" cy="28%" r="80%">
          <stop offset=".5" stopColor="#000" stopOpacity="0" />
          <stop offset=".85" stopColor="#5a1d00" stopOpacity=".18" />
          <stop offset="1" stopColor="#3a1200" stopOpacity=".42" />
        </radialGradient>
        <linearGradient id={`v${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c232b" />
          <stop offset="1" stopColor={ORB.visor} />
        </linearGradient>
        <filter id={`g${id}`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`e${id}`} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g className="isla-body">
        {[`b${id}`, `s${id}`].map((fill, i) => (
          <path key={fill} d={SHAPES[0]} fill={`url(#${fill})`} filter={i === 0 ? `url(#g${id})` : undefined}>
            {!still && (
              <animate
                attributeName="d"
                dur={mood === 'listening' ? '3s' : '7s'}
                repeatCount="indefinite"
                values={`${SHAPES[0]};${SHAPES[1]};${SHAPES[2]};${SHAPES[0]}`}
              />
            )}
          </path>
        ))}
        <ellipse cx="59" cy="45" rx="15" ry="6.5" fill="#fff" opacity=".4" transform="rotate(-28 59 45)" />
        <circle cx="47" cy="58" r="2.6" fill="#fff" opacity=".55" />
      </g>
      <rect x="42" y="62" width="76" height="30" rx="15" fill={`url(#v${id})`} opacity=".92" />
      <rect x="42" y="62" width="76" height="30" rx="15" fill="none" stroke="#fff" strokeOpacity=".12" />
      <path d="M50 66.5 Q60 64.5 76 65" stroke="#fff" strokeOpacity=".28" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <g className="isla-eyes" style={{ transform: `translate(${dx}px, ${dy}px)` }}>
        <g className="isla-blink" filter={`url(#e${id})`}>
          {mood === 'done' ? (
            <g fill="none" stroke={eyeColor} strokeWidth="4" strokeLinecap="round">
              <path d="M60 80 Q67 72 74 80" />
              <path d="M86 80 Q93 72 100 80" />
            </g>
          ) : mood === 'listening' ? (
            <g fill={eyeColor}>
              <rect x="60" y="73" width="14" height="8" rx="4" />
              <rect x="86" y="73" width="14" height="8" rx="4" />
            </g>
          ) : mood === 'found' ? (
            <g fill={eyeColor}>
              <rect x="60" y="68" width="14" height="18" rx="7" />
              <rect x="86" y="68" width="14" height="18" rx="7" />
            </g>
          ) : (
            <g fill={eyeColor}>
              <rect x="61" y="70" width="12" height="14" rx="6" />
              <rect x="87" y="70" width="12" height="14" rx="6" />
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}

/** The system "reduce motion" setting, live. */
function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const update = () => setReduced(m.matches);
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, []);
  return reduced;
}
