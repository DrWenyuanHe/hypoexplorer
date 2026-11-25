// React binding for the symbol rename table. Kept out of ./symbolRenames.ts so
// that module stays React-free, as useAliasIndex.ts does for the alias index.

import { useEffect, useState } from 'react';
import { loadSymbolRenames, type SymbolRenames } from './symbolRenames';

/**
 * The rename table once it has arrived, or null until then or if it never
 * does. One nullable value for both states, like useAliasIndex: every caller
 * must render correctly without it.
 */
export function useSymbolRenames(): SymbolRenames | null {
  const [renames, setRenames] = useState<SymbolRenames | null>(null);
  useEffect(() => {
    let alive = true;
    loadSymbolRenames().then((r) => { if (alive) setRenames(r); });
    return () => { alive = false; };
  }, []);
  return renames;
}
