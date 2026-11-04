// Single source of truth for FGSEA database list + filter defaults.
// Preprocess emits pathways keyed under these DB names.
import type { DbName } from '../types';

export const DB_NAMES: DbName[] = ['GO_BP', 'HALLMARK', 'KEGG', 'REACTOME'];
export const DB_DEFAULT_FILTER: Record<DbName, boolean> = Object.fromEntries(
  DB_NAMES.map((db) => [db, true]),
) as Record<DbName, boolean>;
