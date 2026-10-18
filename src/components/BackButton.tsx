import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

// Pages the signed-in menu (sidebar or tabs) always shows: no need for "Back" on them.
const IN_MENU = ['/', '/new', '/library', '/brand-kits', '/account', '/pricing'];

// "← Back" at the top of other pages: the previous page in this visit, or home if there's none.
export default function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  if (location.pathname === '/' || (user && IN_MENU.includes(location.pathname))) return null;
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  return (
    <button type="button" className="back-button" onClick={() => (canGoBack ? navigate(-1) : navigate('/'))}>
      ← Back
    </button>
  );
}
