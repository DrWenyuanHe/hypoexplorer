import { useEffect, useState } from 'react';

/** Shared with the 900px responsive layout breakpoint. */
export function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia?.('(max-width: 900px)').matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 900px)');
    if (!query) return;
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}
