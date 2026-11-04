import { Component, Fragment } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { FONT_MONO, FONT_SANS } from './styles/constants';

// After this many failed resets we stop offering "Reload this tab". A crash that
// recurs immediately on remount is almost always a bad prop / persistent state,
// not a transient hiccup — retrying forever just lets the user spin.
const MAX_RESETS = 3;

interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  resetCount: number;
}

// Tab-level error boundary. Prevents one component crash from white-screening the
// whole app. The reset button bumps a remount key (resetCount) used to key the
// child subtree below, so a reset truly UNMOUNTS and rebuilds the children rather
// than just re-rendering the same (still-broken) elements. Once MAX_RESETS resets
// have failed, the button is replaced with a terminal message so the user can't
// get stuck in a reload→re-throw loop.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, resetCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Preserve resetCount — getDerivedStateFromError is a partial-state merge, so
    // a recurring crash keeps incrementing toward MAX_RESETS across resets.
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  // Clear the error AND bump resetCount: the bump both remounts the subtree (via
  // the keyed Fragment in render) and bounds how many times we'll retry.
  reset = (): void =>
    this.setState((s) => ({ hasError: false, error: null, resetCount: s.resetCount + 1 }));

  render() {
    if (this.state.hasError) {
      const exhausted = this.state.resetCount >= MAX_RESETS;
      return (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 32, gap: 12, background: 'var(--bg-panel)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            Something went wrong in this tab
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: FONT_MONO, maxWidth: 520, textAlign: 'center' }}>
            {this.state.error?.message || 'Unknown error'}
          </div>
          {exhausted ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 520, textAlign: 'center', fontFamily: FONT_SANS }}>
              This tab keeps failing after {MAX_RESETS} attempts. Try switching tracks or reloading the page.
            </div>
          ) : (
            <button type="button" onClick={this.reset}
              style={{
                marginTop: 8, fontSize: 12, padding: '6px 14px',
                border: '1px solid var(--border-dark)', borderRadius: 4,
                background: 'var(--bg-app)', cursor: 'pointer',
                fontFamily: FONT_SANS,
              }}>
              Reload this tab
            </button>
          )}
        </div>
      );
    }
    // Keying the wrapper by resetCount is what makes reset() a true remount: when
    // the count changes, React discards the old subtree and mounts a fresh one.
    return <Fragment key={this.state.resetCount}>{this.props.children}</Fragment>;
  }
}
