// The homepage's search box: one field for genes and pathways together.
//
// A thin wrapper over the shared UnifiedSearchBox. Submitting a term opens the
// unified results page, which breaks results down into genes and pathways; the
// full search dialog, with its study filters, stays in the hub's top nav.
//
// The autocomplete vocabulary is fetched the first time the field is focused,
// never on mount, so the homepage requests no data files until a visitor
// starts a search.

import { UnifiedSearchBox } from '../search/UnifiedSearchBox';

export function HubSearch({ onSearch }: {
  /** Open the results page for a typed term, a gene symbol or a pathway id. */
  onSearch: (query: string) => void;
}) {
  return <UnifiedSearchBox variant="hub" onSearch={onSearch} />;
}
