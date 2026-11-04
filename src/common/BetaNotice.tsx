import { BETA_NOTICE } from '../data/siteInfo';
import './BetaNotice.css';

/** Shared, readable release status across every public app header. */
export function BetaNotice() {
  return (
    <div className="beta-notice">
      <p>{BETA_NOTICE}</p>
      <a href="/about/">About &amp; feedback</a>
    </div>
  );
}
