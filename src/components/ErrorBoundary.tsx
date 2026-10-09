import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render-time exceptions in child components and shows a recovery
 * screen instead of letting the whole app crash to a white page. Without
 * this, any unhandled error in a page (e.g. a malformed localStorage entry,
 * a missing icon, an upstream API change) would leave the user with no UI
 * and no way back to the home screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
    try {
      const stack = (info.componentStack || '').slice(0, 500);
      // Surface enough to diagnose without flooding analytics.
      const report = `${error.name}: ${error.message}\n${stack}`;
      // Best-effort: log to localStorage so user can copy if they want to report.
      localStorage.setItem(
        'homehub.lastError',
        JSON.stringify({ when: Date.now(), report }),
      );
    } catch { /* ignore */ }
  }

  private handleReload = () => {
    this.setState({ hasError: false, error: null });
    // Full reload so any corrupted in-memory state is wiped.
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    const err = this.state.error;
    return (
      <div className="min-h-[60vh] grid place-items-center p-6">
        <div className="card p-6 max-w-md text-center space-y-3">
          <div className="mx-auto w-12 h-12 rounded-full bg-tomato-50 text-tomato-600 grid place-items-center">
            <AlertTriangle size={24} />
          </div>
          <h2 className="font-display font-bold text-lg text-sage-900 dark:text-cream-50">
            {this.props.fallbackTitle ?? 'Something went wrong'}
          </h2>
          <p className="text-sm text-sage-600 dark:text-cream-200">
            {err?.message
              ? `The app hit an unexpected error: ${err.message}.`
              : 'The app hit an unexpected error.'}
            Your data is safe — reload to continue.
          </p>
          <div className="flex items-center justify-center gap-2 pt-2">
            <button onClick={this.handleReset} className="btn-secondary">
              Try again
            </button>
            <button onClick={this.handleReload} className="btn-primary">
              <RefreshCw size={14} /> Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
