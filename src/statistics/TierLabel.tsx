// A result's significance tier in words, the same everywhere a cross-study
// listing labels its rows: search, the gene report and the pathway report.
// The label belongs to the row (CONTEXT.md, "Significance tier"), so it never
// depends on the listing mode.

import { DEFAULT_FDR_CUTOFF, NOMINAL_P_CUTOFF, type SignificanceTier } from './policy';
import './listingMode.css';

export function TierLabel({ tier, className }: { tier: SignificanceTier; className?: string }) {
  const cls = `${className ? `${className} ` : ''}portal-tier portal-tier--${tier}`;
  if (tier === 'fdr') return <span className={cls}>FDR &lt; {DEFAULT_FDR_CUTOFF}</span>;
  if (tier === 'nominal') return <span className={cls}>p &lt; {NOMINAL_P_CUTOFF} only</span>;
  return <span className={cls}>n.s.</span>;
}
