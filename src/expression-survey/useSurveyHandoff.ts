// The survey page's handover of one gene to its gene page.
//
// A single gene surveyed on the expression survey page opens its gene page,
// whose expression card then surveys every source in the scope the survey
// page had. The handover belongs to that one visit: once its gene page has
// been on screen, leaving it drops the handover, so reaching the gene later
// by ordinary search opens its page plainly. It is not dropped before the
// page first shows, because the route may settle a render after the handover.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SurveyScope } from './expressionSurvey';

export interface SurveyHandoff {
  /** Record a handover; the caller then navigates to the gene's page. */
  handOff: (gene: string, scope: SurveyScope) => void;
  /** The handed-over scope when `gene`'s page is the one the handover opened. */
  scopeFor: (gene: string) => SurveyScope | undefined;
}

export function useSurveyHandoff(view: string, reportGene: string | null | undefined): SurveyHandoff {
  const [handoff, setHandoff] = useState<{ gene: string; scope: SurveyScope } | null>(null);
  // Whether the handover's gene page has been on screen yet.
  const shown = useRef(false);

  useEffect(() => {
    if (!handoff) return;
    if (view === 'report' && reportGene === handoff.gene) shown.current = true;
    else if (shown.current) {
      shown.current = false;
      setHandoff(null);
    }
  }, [view, reportGene, handoff]);

  const handOff = useCallback((gene: string, scope: SurveyScope) => {
    shown.current = false;
    setHandoff({ gene, scope });
  }, []);
  const scopeFor = useCallback(
    (gene: string) => (handoff?.gene === gene ? handoff.scope : undefined),
    [handoff],
  );
  return { handOff, scopeFor };
}
