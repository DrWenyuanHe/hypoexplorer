import { fmtBytes } from '../utils/format';
import { ProgressBar } from './ProgressBar';
import { Spinner } from './Spinner';

interface LoadingOverlayProps {
  message?: string;
  fixed?: boolean;
  zIndex?: number;
  /**
   * Bytes of the download this veil is covering, when one is being followed.
   * Omit for a wait that has no measurable payload — the spinner then stands
   * alone, exactly as before.
   */
  progress?: { loaded: number; total: number | null } | null;
}

/** "1.4 MB of 2.4 MB · 58%", or "1.4 MB" when the total is unknown. */
function progressText({ loaded, total }: { loaded: number; total: number | null }): string {
  if (total == null) return loaded > 0 ? fmtBytes(loaded) : 'Downloading…';
  const pct = Math.min(100, Math.round((loaded / total) * 100));
  return `${fmtBytes(loaded)} of ${fmtBytes(total)} · ${pct}%`;
}

/**
 * Translucent loading veil. Defaults to covering its nearest positioned
 * ancestor (`absolute`); pass `fixed` to cover the viewport. The faint blur +
 * tint keeps prior content readable underneath so a population switch feels
 * like a refresh rather than a blank wait.
 *
 * With `progress`, the spinner is joined by a bar and a byte readout. Track
 * bundles run 1–10 MB, so the wait is long enough that "is this moving?" is a
 * real question — and the bar answers it even when only the SIZE is known and
 * not the position (an off-origin deploy without CORS reports no chunks), by
 * going indeterminate rather than vanishing.
 */
export function LoadingOverlay({ message = 'Loading…', fixed = false, zIndex = 50, progress }: LoadingOverlayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: fixed ? 'fixed' : 'absolute',
        inset: 0,
        zIndex,
        background: 'rgba(255, 255, 255, 0.82)',
        backdropFilter: 'blur(1.5px)',
        WebkitBackdropFilter: 'blur(1.5px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--sp-3)',
      }}
    >
      <Spinner size={24} />
      <div style={{ fontSize: 'var(--fs-13)', color: 'var(--text-muted)', fontWeight: 500 }}>{message}</div>
      {progress && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-2)', width: 240 }}>
          <ProgressBar
            label={message}
            value={progress.total ? progress.loaded / progress.total : null}
          />
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
            {progressText(progress)}
          </div>
        </div>
      )}
    </div>
  );
}
