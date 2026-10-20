// The logo mark: Isla, polished and looking to the right (public/favicon.svg, from design/logo/isla-agent.svg).
// The moving Isla is components/IslaOrb.tsx.
export default function LogoMark({ size = 26 }: { size?: number }) {
  return <img src="/favicon.svg?v=3" width={size} height={size} alt="" aria-hidden="true" className="logo-mark" draggable={false} />;
}
