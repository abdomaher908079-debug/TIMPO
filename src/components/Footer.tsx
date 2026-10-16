import { Link } from 'react-router-dom';
import { BRAND_NAME, LEGAL } from '../lib/brand';

export default function Footer() {
  return (
    <footer className="footer">
      <nav aria-label="Site">
        <Link to="/pricing">Pricing</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/refunds">Refunds</Link>
        <a href={`mailto:${LEGAL.email}`}>Contact</a>
        <Link to="/diagnose">Check my browser</Link>
      </nav>
      <p>
        © {new Date().getFullYear()} {BRAND_NAME}
      </p>
    </footer>
  );
}
