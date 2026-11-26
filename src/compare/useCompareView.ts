// The shell's hold on Compare's view: the link it last showed for a dataset,
// so leaving Compare and coming back resumes it and the URL can name it.
//
// CompareTab owns the view while it is open and reads where to start only
// when it mounts. So a link that LANDS (a Compare URL, Back or Forward onto
// one) bumps `epoch`, which the shell uses as CompareTab's key to remount it
// on the landed view; a change CompareTab REPORTS keeps the epoch, so the tab
// the user is working in is never remounted under them.

import { useCallback, useState } from 'react';
import type { CompareViewState } from '../utils/analysisState';
import { sameCompareLink } from './compareView';

interface Held {
  datasetId: string;
  link: CompareViewState;
  epoch: number;
}

export interface CompareViewHold {
  /** The link held for the active dataset, or undefined when none is (another dataset's is not resumed). */
  link: CompareViewState | undefined;
  /** CompareTab's key: changes only when a link lands. */
  epoch: number;
  /** A Compare link landed on `datasetId`: remount Compare on it. */
  land: (datasetId: string, link: CompareViewState) => void;
  /** CompareTab reporting what it shows for the active dataset. A link equal to the held one changes nothing. */
  report: (link: CompareViewState) => void;
}

export function useCompareView(activeDatasetId: string): CompareViewHold {
  const [held, setHeld] = useState<Held>({ datasetId: '', link: {}, epoch: 0 });
  const land = useCallback((datasetId: string, link: CompareViewState) => {
    setHeld((prev) => ({ datasetId, link, epoch: prev.epoch + 1 }));
  }, []);
  const report = useCallback((link: CompareViewState) => {
    setHeld((prev) => (prev.datasetId === activeDatasetId && sameCompareLink(prev.link, link)
      ? prev : { datasetId: activeDatasetId, link, epoch: prev.epoch }));
  }, [activeDatasetId]);
  return {
    link: held.datasetId === activeDatasetId ? held.link : undefined,
    epoch: held.epoch,
    land,
    report,
  };
}
