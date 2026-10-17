import { useLocation, useNavigate } from 'react-router-dom';

// "← Back" at the top of every page but home: the previous page in this visit, or home if there's none.
export default function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  if (location.pathname === '/') return null;
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  return (
    <button type="button" className="back-button" onClick={() => (canGoBack ? navigate(-1) : navigate('/'))}>
      ← Back
    </button>
  );
}
