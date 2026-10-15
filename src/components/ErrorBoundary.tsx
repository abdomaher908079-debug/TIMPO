import { Component, type ErrorInfo, type ReactNode } from 'react';

// Without this, a crash leaves an empty dark page. Shows what went wrong and a way back instead.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page">
        <div className="card" style={{ marginTop: 40 }}>
          <h2>Something went wrong</h2>
          <p>Please reload the page. If it keeps happening, send us this message:</p>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, opacity: 0.8 }}>
            {error.name}: {error.message}
          </pre>
          <button className="btn btn-primary" onClick={() => window.location.assign('/')}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
