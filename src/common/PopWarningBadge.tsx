import { COLOR_WARNING_FG, COLOR_WARNING_BG, COLOR_WARNING_TEXT, FONT_SANS } from '../styles/constants';
import { isLowPower } from '../utils/qcFlags';

interface PopWarningBadgeProps {
  is3v3?: boolean;
  nNormal?: number;
  nObese?: number;
  samplesKept?: string[];
  compact?: boolean;
}

export function PopWarningBadge({ is3v3, nNormal, nObese, samplesKept, compact = false }: PopWarningBadgeProps) {
  // Warn only when a group is genuinely under-powered: fewer than 3 replicates on
  // one side (e.g. the macaque 2v3 case where a sample was dropped). Balanced or
  // larger bulk designs (7v8, 3v4, …) are normal and must NOT trigger this badge.
  // Single-sourced via isLowPower so QC KPI, sidebar badge, and this badge agree.
  if (is3v3 || !isLowPower({ nNormal, nObese })) return null;

  const text = `⚠ n=${nNormal} vs ${nObese} · low power · treat cautiously`;
  const tooltip = `One group has fewer than 3 replicates (n=${nNormal} vs ${nObese}). Comparisons with n<3 on one side have reduced statistical power; results are exploratory.${samplesKept ? ` Kept: ${samplesKept.join(', ')}` : ''}`;

  return (
    <span
      role="status"
      aria-live="polite"
      title={tooltip}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, fontFamily: FONT_SANS,
        padding: '1px 6px', borderRadius: 4,
        background: COLOR_WARNING_BG,
        border: `1px solid ${COLOR_WARNING_FG}`,
        color: COLOR_WARNING_TEXT,
        whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      {compact ? '⚠' : text}
    </span>
  );
}
