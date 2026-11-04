// The chrome every full-page (non-explorer) view shares: the 4px accent strip,
// the sticky header with the HypoExplorer logo, beta notice, and Home breadcrumb
// trail. CrossDatasetCompare, GeneReport, PathwayReport and StatisticsView are
// its adapters; the explorer shell (App) keeps its own structurally different
// topbar, and the hub/tracker keep their CSS-driven chrome.
//
// Navigation is callback-driven (onHome), matching App's state-driven routing —
// the shell never writes location.hash.
import type { CSSProperties, ReactNode } from 'react';
import { Fragment } from 'react';
import { FONT_MONO, PAGE_ACCENT_GRADIENT } from '../styles/constants';
import { BetaNotice } from './BetaNotice';
import { BrandLink } from './BrandLink';

export interface PageShellBreadcrumb {
  label: ReactNode;
  /** The current page's crumb: emphasized, optionally ellipsized at maxWidth. */
  current?: boolean;
  maxWidth?: CSSProperties['maxWidth'];
}

interface PageShellProps {
  onHome: () => void;
  breadcrumbs: readonly PageShellBreadcrumb[];
  children: ReactNode;
  /** Merged into the <main> style (flex:1 is fixed). Reports pass their
   *  max-width/padding; StatisticsView passes overflowY:'auto'. */
  mainStyle?: CSSProperties;
  mainClassName?: string;
  /**
   * Size the shell to the VIEWPORT rather than to its content.
   *
   * The default shell is a document: `min-height: 100vh`, and a long page grows
   * past it and scrolls the window. That is right for the reports, and wrong for
   * any view that wants two panes scrolling independently. With the shell's own
   * height indefinite, `flex: 1` on <main> resolves its `0%` basis against
   * nothing, so <main> sizes to its CONTENT instead: a tall pane pushes the whole
   * page taller and drags every sibling out of view with it. That is what
   * happened to the library's facet rail — it scrolled away with the results
   * instead of holding still beside them.
   *
   * On desktop, `fill` makes the shell an app frame — a definite 100dvh — so <main> has a real
   * height to divide, and each pane's own `overflow-y: auto` is the only scroller
   * left on the page. At 900px and below, responsive.css restores document
   * scrolling so wrapped controls and the mobile keyboard cannot trap results.
   */
  fill?: boolean;
  /** Utilities pinned to the header's right edge — the compare-set indicator. */
  headerRight?: ReactNode;
}

export function PageShell({ onHome, breadcrumbs, children, mainStyle, mainClassName, fill, headerRight }: PageShellProps) {
  return (
    <div className={fill ? 'page-shell page-shell--fill' : 'page-shell'} style={{
      ...(fill ? { overflow: 'hidden' } : {}),
      background: 'var(--bg-app)', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ height: 4, background: PAGE_ACCENT_GRADIENT }} />

      <header className="site-header" style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
        <div className="site-header-row" style={{ minHeight: 46, display: 'flex', alignItems: 'center', gap: '8px 16px', padding: '8px var(--site-header-padding)' }}>
          <BrandLink onHome={onHome} />
          <nav className="site-header-breadcrumbs" aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONT_MONO, fontSize: 12, color: 'var(--text-muted)' }}>
            <button type="button" onClick={onHome} style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, padding: 0 }}>Home</button>
            {breadcrumbs.map((crumb, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: crumb position is the identity
              <Fragment key={i}>
                <span style={{ color: 'var(--border-dark)' }}>/</span>
                {crumb.current ? (
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, ...(crumb.maxWidth != null ? { maxWidth: crumb.maxWidth, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}) }}>
                    {crumb.label}
                  </span>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </Fragment>
            ))}
          </nav>
          {headerRight != null && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>{headerRight}</div>
          )}
        </div>
        <BetaNotice />
      </header>

      <main className={mainClassName} style={{ flex: 1, ...(fill ? { minHeight: 0 } : null), ...mainStyle }}>{children}</main>
    </div>
  );
}
