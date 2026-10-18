import IslaOrb from './IslaOrb';

// The logo mark: Isla's orb, still (it moves only where she's working).
export default function LogoMark({ size = 26 }: { size?: number }) {
  return <IslaOrb size={size} still className="logo-mark" />;
}
