import { Component, StrictMode } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isTauri } from './platform/files';
import { installLogging, logger, logText } from './platform/log';
import { applyTheme, useTheme } from './platform/theme';
import './styles.css';

installLogging({ version: __APP_VERSION__, desktop: isTauri(), userAgent: navigator.userAgent });
// Farbschema vor dem ersten Zeichnen setzen (kein helles Aufblitzen)
applyTheme(useTheme.getState().theme, useTheme.getState().canvasDunkel);

const log = logger('ui');

/** Fängt Darstellungsfehler ab, protokolliert sie und zeigt statt einer leeren Seite einen Hinweis */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error(`Darstellungsfehler: ${error.message}`, `${error.stack ?? ''}\n${info.componentStack ?? ''}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h2>Da ist etwas schiefgelaufen.</h2>
        <p>Das Projekt ist automatisch zwischengespeichert. Nach dem Neuladen geht es an derselben Stelle weiter.</p>
        <pre>{this.state.error.message}</pre>
        <div className="button-row">
          <button className="primary" onClick={() => location.reload()}>
            Neu laden
          </button>
          <button onClick={() => void navigator.clipboard?.writeText(logText())}>Protokoll kopieren</button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
