import {
  NOMENCLATURE_AUTHORITIES,
  NOMENCLATURE_STATUS,
  type NomenclatureAuthority,
  type NomenclatureStatus,
} from '../../src/data/nomenclatureWire';

export interface NomenclatureRow {
  symbol: string;
  authority: NomenclatureAuthority;
  status: NomenclatureStatus;
  currentSymbol: string;
  geneName: string;
  aliases: string[];
  prevSymbols: string[];
  authorityId: string;
  locusType: string;
  datasetCount: number;
}

export const NOMENCLATURE_TSV_COLUMNS = [
  'symbol',
  'authority',
  'status',
  'current_symbol',
  'gene_name',
  'aliases',
  'previous_symbols',
  'authority_id',
  'locus_type',
  'n_datasets',
] as const;

export function nomenclatureKey(authority: NomenclatureAuthority, symbol: string): string {
  return `${authority}\x00${symbol}`;
}

/** Read retained decisions without reinterpreting another authority's namespace. */
export function parseRetainedNomenclature(text: string): Map<string, NomenclatureRow> {
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.shift() !== NOMENCLATURE_TSV_COLUMNS.join('\t')) {
    throw new Error('Retained nomenclature TSV has an unexpected header');
  }
  const rows = new Map<string, NomenclatureRow>();
  for (const [offset, line] of lines.entries()) {
    const cells = line.split('\t');
    const [
      symbol,
      authority,
      status,
      currentSymbol,
      geneName,
      aliases,
      prevSymbols,
      authorityId,
      locusType,
      count,
    ] = cells;
    const datasetCount = Number(count);
    if (
      cells.length !== NOMENCLATURE_TSV_COLUMNS.length ||
      !symbol ||
      !NOMENCLATURE_AUTHORITIES.includes(authority as NomenclatureAuthority) ||
      !NOMENCLATURE_STATUS.includes(status as NomenclatureStatus) ||
      !/^\d+$/.test(count) ||
      !Number.isSafeInteger(datasetCount) ||
      datasetCount < 1
    ) {
      throw new Error(`Invalid retained nomenclature row ${offset + 2}`);
    }
    const row: NomenclatureRow = {
      symbol,
      authority: authority as NomenclatureAuthority,
      status: status as NomenclatureStatus,
      currentSymbol,
      geneName,
      aliases: aliases ? aliases.split('|') : [],
      prevSymbols: prevSymbols ? prevSymbols.split('|') : [],
      authorityId,
      locusType,
      datasetCount,
    };
    const key = nomenclatureKey(row.authority, symbol);
    if (rows.has(key))
      throw new Error(`Duplicate retained nomenclature decision: ${authority} ${symbol}`);
    rows.set(key, row);
  }
  return rows;
}

/** Only incidence counts may change outside the explicitly refreshed authority. */
export function reuseRetainedNomenclature(
  retained: ReadonlyMap<string, NomenclatureRow>,
  authority: NomenclatureAuthority,
  symbol: string,
  datasetCount: number,
): NomenclatureRow {
  const row = retained.get(nomenclatureKey(authority, symbol));
  if (!row) {
    throw new Error(
      `New ${authority} symbol '${symbol}' has no retained classification. ` +
        'The bounded RGD refresh cannot classify another authority; run a full authority rebuild.',
    );
  }
  return { ...row, datasetCount };
}

export interface NomenclatureSourceFacts {
  url: string;
  file: string;
  bytes: number;
  records: number;
}

/** Preserve all other source metadata, including authority release descriptions. */
export function refreshRetainedRgdSources<
  T extends { builtFrom: Record<string, NomenclatureSourceFacts> },
>(retained: T, rgd: NomenclatureSourceFacts, obsolete: NomenclatureSourceFacts): T {
  if (!retained.builtFrom.rgd || !retained.builtFrom.rgdObsolete) {
    throw new Error('Retained nomenclature sources do not declare both RGD files');
  }
  return { ...retained, builtFrom: { ...retained.builtFrom, rgd, rgdObsolete: obsolete } };
}
