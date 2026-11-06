// The line-icon set the navigation surfaces share.
//
// These lived inside LandingHub while the hub was the only thing that drew them.
// The physiological-signal shortcuts have since moved into the Gene Explorer,
// and they carry their icons with them — an icon is how you find "Leptin
// signaling" in a row of five without reading all five labels, which is most of
// what makes that row scannable.
//
// One 24px grid, 1.8 stroke, `currentColor` throughout, so a caller sets the
// color and nothing here has an opinion about it. Every icon is aria-hidden:
// each one sits beside a text label that carries the meaning, and none of them
// is the only cue for anything (DESIGN.md).

import type { ReactNode } from 'react';

function Icon({ d, paths }: { d?: string; paths?: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d ? <path d={d} /> : paths}
    </svg>
  );
}

export const ICONS: Record<string, ReactNode> = {
  expression: <Icon paths={<><path d="M3 3v18h18" /><rect x="7" y="4" width="13" height="3" rx="0.6" /><rect x="7" y="10" width="7" height="3" rx="0.6" /><rect x="7" y="16" width="10" height="3" rx="0.6" /></>} />,
  gene: <Icon paths={<><path d="M3 3v18h18" /><circle cx="8" cy="14" r="1.3" /><circle cx="12" cy="8" r="1.3" /><circle cx="16" cy="15" r="1.3" /><circle cx="18" cy="6" r="1.3" /><circle cx="7" cy="9" r="1.3" /></>} />,
  cells: <Icon paths={<><circle cx="7" cy="7" r="2" /><circle cx="17" cy="7" r="2" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /><circle cx="12" cy="12" r="2" /></>} />,
  contrast: <Icon paths={<><circle cx="8" cy="12" r="4.5" /><circle cx="16" cy="12" r="3" /></>} />,
  insulin: <Icon d="M3 12c3 0 3-5 6-5s3 10 6 10 3-5 6-5" />,
  leptin: <Icon paths={<><path d="M12 3v4M12 17v4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M3 12h4M17 12h4" /><circle cx="12" cy="12" r="3" /></>} />,
  inflammatory: <Icon paths={<><path d="M12 2c1.5 3 5 4 5 8a5 5 0 0 1-10 0c0-1.5.6-2.6 1.4-3.6" /><path d="M12 13a2.5 2.5 0 0 0 2.5 2.5" /></>} />,
  coexpression: <Icon paths={<><circle cx="5" cy="6" r="1.6" /><circle cx="12" cy="4" r="1.6" /><circle cx="19" cy="7" r="1.6" /><circle cx="7" cy="14" r="1.6" /><circle cx="15" cy="13" r="1.6" /><circle cx="11" cy="20" r="1.6" /><path d="M6.4 6.6 10.6 4.6M13.4 4.4 17.5 6.4M6 7.6 6.7 12.4M12.8 5.4 14.4 11.4M8.4 14.6 13.5 13.4M14.7 14.4 11.6 18.6M8 15.3 10.4 18.7" /></>} />,
  circadian: <Icon paths={<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2.5" /></>} />,
  aging: <Icon paths={<path d="M7 3h10M7 21h10M8 3c0 4 1.5 6 4 7.5C9.5 12 8 14 8 21M16 3c0 4-1.5 6-4 7.5 2.5 1.5 4 3.5 4 10.5" />} />,
  ko: <Icon paths={<><path d="M3 12a4 4 0 0 0 8 0 4 4 0 0 1 8 0" /><path d="M3 12a4 4 0 0 1 8 0 4 4 0 0 0 8 0" /></>} />,
  tracker: <Icon paths={<><path d="M4 5h16M4 12h16M4 19h16" /><circle cx="8" cy="5" r="1.4" /><circle cx="14" cy="12" r="1.4" /><circle cx="11" cy="19" r="1.4" /></>} />,
  library: <Icon paths={<><rect x="3" y="4" width="7.5" height="7" rx="1.4" /><rect x="13.5" y="4" width="7.5" height="7" rx="1.4" /><rect x="3" y="13" width="7.5" height="7" rx="1.4" /><rect x="13.5" y="13" width="7.5" height="7" rx="1.4" /></>} />,
};
