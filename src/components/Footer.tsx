import { Link, useLocation } from 'react-router-dom';
import { BRAND_NAME, LEGAL } from '../lib/brand';

const LINKS: [string, string][] = [
  ['/about', 'About'],
  ['/pricing', 'Pricing'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
  ['/refunds', 'Refunds'],
  ['/status', 'Status'],
];

export default function Footer() {
  // Links to every page but the one you're on.
  const here = useLocation().pathname;
  return (
    <footer className="footer">
      <nav aria-label="Site">
        {LINKS.filter(([to]) => to !== here).map(([to, label]) => (
          <Link key={to} to={to}>
            {label}
          </Link>
        ))}
        <a href={`mailto:${LEGAL.email}`}>Contact</a>
        {here !== '/diagnose' && <Link to="/diagnose">Check my browser</Link>}
      </nav>
      <p>
        © {new Date().getFullYear()} {BRAND_NAME} · Made by {LEGAL.owner}
      </p>
    </footer>
  );
}
