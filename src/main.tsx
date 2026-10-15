import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { AccountProvider } from './lib/account';
import { AuthProvider } from './lib/auth';
import './styles.css';

// After an update, a page opened before it may ask for files that no longer exist: reload once to get the new ones.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('hookcut_reloaded')) return;
    sessionStorage.setItem('hookcut_reloaded', '1');
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AccountProvider>
            <App />
          </AccountProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
