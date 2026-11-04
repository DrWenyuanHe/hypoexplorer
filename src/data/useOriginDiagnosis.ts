// Run the data-origin diagnosis while an error is on screen, and only then.
//
// Deliberately reactive to a failure rather than polling: a healthy session
// must never spend a request asking whether it is healthy, and a banner that
// is not showing has nothing to explain. The probe itself is memoized in
// originHealth, so several failures in a row still cost one request.

import { useEffect, useState } from 'react';
import { diagnoseDataOrigin, type OriginDiagnosis } from './originHealth';

/**
 * @param active whether an error is currently displayed. Going false clears the
 *   diagnosis, so a recovered session does not keep a stale explanation around.
 */
export function useOriginDiagnosis(active: boolean): OriginDiagnosis | null {
  const [diagnosis, setDiagnosis] = useState<OriginDiagnosis | null>(null);

  useEffect(() => {
    if (!active) {
      setDiagnosis(null);
      return;
    }
    let live = true;
    diagnoseDataOrigin().then((d) => {
      // Guarded: the banner can clear while the probe is in flight, and a late
      // resolve must not re-explain an error the visitor no longer sees.
      if (live) setDiagnosis(d);
    });
    return () => {
      live = false;
    };
  }, [active]);

  return diagnosis;
}
