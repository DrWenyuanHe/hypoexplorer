import { useEffect, useState } from 'react';
import { loadAtlasGene } from './atlas';
import { type Csv, CsvDialog } from './CsvDialog';
import './preview.css';
import './coexpression.css';

type Ready = Extract<Awaited<ReturnType<typeof loadAtlasGene>>, { state: 'ready' }>;
type Gene = Ready['gene'];
const categories = ['both', 'queryOnly', 'partnerOnly', 'neither'] as const;
type Category = typeof categories[number];
type Counts = {
  eligible: number;
  counts: Record<Category, number>;
  percentages: Record<Category, number | null>;
  conditionalPercent: number | null;
};
type Population = Counts & { label: string };
type Comparison = {
  cohort: string;
  query: string;
  partner: string;
  whole: Counts;
  c7: Population[];
  datasets: (Counts & { dataset: string; c7: Population[] })[];
};
type Ranking = { cohort: string; record: [number, number[], number, [number, number, number][]] };
const format = new Intl.NumberFormat('en-US');
const colors = ['#225d88', '#618bb1', '#bc753d', '#e1e8ef'];
const percent = (n: number | null) => n === null ? '—' : `${n.toFixed(2)}%`;

async function read<T>(endpoint: string, params: Record<string, string>, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/hypomap-preview-api/${endpoint}?${new URLSearchParams(params)}`, { signal });
  if (!response.ok) throw new Error('HypoMap comparison request failed');
  return response.json();
}

function PairExplorer({ atlas }: { atlas: Ready }) {
  const { gene, metadata, record, geneAt } = atlas;
  const [ranking, setRanking] = useState<Ranking['record'] | 'error' | null>(null);
  const [rankingAttempt, retryRanking] = useState(0);
  const [query, setQuery] = useState('');
  const [queryError, setQueryError] = useState('');
  const [choices, setChoices] = useState<string[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [partner, setPartner] = useState<Gene | null>(null);
  const [datasets, setDatasets] = useState(metadata.datasets);
  const [comparison, setComparison] = useState<Comparison | 'error' | null>(null);
  const [pairAttempt, retryPair] = useState(0);
  const [population, setPopulation] = useState('');
  const [expanded, setExpanded] = useState<Category | null>(null);
  const [csv, setCsv] = useState<Csv | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `rankingAttempt` is the Retry trigger, not read inside.
  useEffect(() => {
    const controller = new AbortController();
    read<Ranking>('recommendations', { gene: gene[0] }, controller.signal).then(data => {
      if (data.cohort !== metadata.cohort || data.record[0] !== record[0]) throw new Error('Ranking identity mismatch');
      if (!controller.signal.aborted) setRanking(data.record);
    }).catch(() => { if (!controller.signal.aborted) setRanking('error'); });
    return () => controller.abort();
  }, [gene, metadata, record, rankingAttempt]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `pairAttempt` is the Retry trigger, not read inside.
  useEffect(() => {
    if (!partner || !datasets.length) return;
    const controller = new AbortController();
    read<Comparison>('compare', { a: gene[0], b: partner[0], datasets: datasets.join(',') }, controller.signal).then(data => {
      if (data.cohort !== metadata.cohort || data.query !== gene[0] || data.partner !== partner[0]) {
        throw new Error('Comparison identity mismatch');
      }
      if (!controller.signal.aborted) setComparison(data);
    }).catch(() => { if (!controller.signal.aborted) setComparison('error'); });
    return () => controller.abort();
  }, [gene, metadata, partner, datasets, pairAttempt]);

  function selectPartner(next: Gene) {
    setQuery(next[1]);
    setQueryError('');
    setChoices([]);
    if (next[0] === partner?.[0]) return;
    setComparison(null);
    setPopulation('');
    setExpanded(null);
    setPartner(next);
  }

  async function findPartner(input: string) {
    setLookingUp(true);
    setQueryError('');
    setChoices([]);
    try {
      const result = await loadAtlasGene(input);
      if (result.state === 'ambiguous') setChoices([...result.candidates]);
      else if (result.state === 'missing') setQueryError(`No atlas feature matched ${input}.`);
      else if (result.gene[0] === gene[0]) setQueryError('Choose a different gene.');
      else selectPartner(result.gene);
    } catch {
      setQueryError('Could not look up this gene. Try again.');
    } finally {
      setLookingUp(false);
    }
  }

  const data = comparison && comparison !== 'error' ? comparison : null;
  const group = data?.c7.find(row => row.label === population);
  const row = group ?? data?.whole;
  const scope = group?.label ?? 'All hypothalamic cells';
  let end = 0;
  const stops = categories.map((key, i) => {
    const start = end;
    end += row?.percentages[key] ?? 0;
    return `${colors[i]} ${start}% ${end}%`;
  });

  const labels = { both: 'Both genes', queryOnly: `${gene[1]} only`, partnerOnly: `${partner?.[1]} only`, neither: 'Neither gene' };

  function exportPair() {
    if (!data || !partner) return;
    const blocks = [
      { dataset: 'Aggregate', label: 'Aggregate', values: row },
      ...data.datasets.map(block => ({
        dataset: block.dataset,
        label: metadata.study_cards[metadata.datasets.indexOf(block.dataset)].HypoMap_label,
        values: group ? block.c7.find(entry => entry.label === group.label) : block,
      })),
    ];
    setCsv({
      title: `${gene[1]} × ${partner[1]} · ${scope}`,
      headers: ['Dataset', 'Accession', 'Eligible cells', ...categories.flatMap(key => [`${labels[key]} (cells)`, `${labels[key]} (%)`]),
        `${gene[1]}-positive cells`, `${partner[1]}-positive cells`, 'Conditional co-detection (%)'],
      rows: blocks.map(block => {
        const counts = block.values?.counts;
        return [block.label, block.dataset === 'Aggregate' ? null : block.dataset, block.values?.eligible ?? 0,
          ...categories.flatMap(key => [counts?.[key] ?? 0, block.values?.percentages[key] ?? null]),
          counts ? counts.both + counts.queryOnly : 0, counts ? counts.both + counts.partnerOnly : 0,
          block.values?.conditionalPercent ?? null];
      }),
    });
  }

  return (
    <>
      <form className="hm-coexpression-search" onSubmit={event => {
        event.preventDefault();
        if (query.trim() && !lookingUp) void findPartner(query.trim());
      }}>
        <label>Compare with a mouse gene <input value={query} onChange={event => setQuery(event.target.value)} placeholder="e.g. Agrp" /></label>
        <button type="submit" className="portal-secondary" disabled={lookingUp || !query.trim()}>Compare genes</button>
      </form>
      {queryError && <p role="status">{queryError}</p>}
      {!!choices.length && <p role="status">Multiple matches. Search a canonical symbol: {choices.join(', ')}.</p>}
      <h4>Top 5 co-detected genes</h4>
      <p className="portal-note">Ranked by the share of {gene[1]}-positive cells that also detect the partner across all 18 HypoMap datasets.</p>
      {ranking === null && <p role="status">Loading recommendations…</p>}
      {ranking === 'error' && <p role="status">Could not load recommendations. <button type="button" className="portal-secondary" onClick={() => {
        setRanking(null);
        retryRanking(n => n + 1);
      }}>Retry</button></p>}
      {ranking && ranking !== 'error' && (
        ranking[3].length ? <ol className="hm-ranking">{ranking[3].map(([i, both, reverseRank]) => {
          const candidate = geneAt(i);
          return (
            <li key={candidate[0]}>
              <button type="button" className="portal-secondary" aria-pressed={partner?.[0] === candidate[0]}
                disabled={lookingUp} title={`${format.format(both)} of ${format.format(ranking[2])} cells`} onClick={() => selectPartner(candidate)}>
                <span>{candidate[1]}</span><strong>{percent(100 * both / ranking[2])}</strong>
              </button>
              <small className="hm-reverse-rank">{gene[1]} ranks #{format.format(reverseRank)} for {candidate[1]}</small>
            </li>
          );
        })}</ol> : <p>No co-detected partners in the atlas.</p>
      )}
      {partner && <section className="hm-card hm-pair" aria-label={`${gene[1]} × ${partner[1]}`}>
        <h4>{gene[1]} × {partner[1]}</h4>
        {!datasets.length ? <p>Select at least one dataset.</p> : comparison === 'error' ? (
          <p role="status">Comparison could not be loaded. <button type="button" className="portal-secondary" onClick={() => {
            setComparison(null);
            retryPair(n => n + 1);
          }}>Retry comparison</button></p>
        ) : !row || !data ? <p role="status">Loading measured comparison…</p> : (
          <>
            <label className="hm-region">Population <select value={group?.label ?? ''} onChange={event => {
              setPopulation(event.target.value);
              setExpanded(null);
            }}>
              <option value="">All hypothalamic cells</option>
              {data.c7.map(entry => <option key={entry.label}>{entry.label}</option>)}
            </select></label>
            <p><strong>{percent(row.conditionalPercent)}</strong> of {gene[1]}-positive cells also detect {partner[1]} · {format.format(row.counts.both)} of {format.format(row.counts.both + row.counts.queryOnly)} cells</p>
            <p className="portal-note">Whole hypothalamus · {format.format(row.eligible)} eligible cells in {scope.toLowerCase()}</p>
            <div className="hm-pair-chart">
              <div className="hm-donut" aria-hidden="true" style={{ background: row.eligible ? `conic-gradient(${stops.join(',')})` : '#e1e8ef' }}>
                <div><strong>{format.format(row.eligible)}</strong><small>eligible cells</small></div>
              </div>
              <div className="hm-quadrants">{categories.map((key, i) => (
              <button key={key} type="button" className="portal-secondary" disabled={!!group}
                aria-expanded={group ? undefined : expanded === key} onClick={() => setExpanded(expanded === key ? null : key)}>
                <span className="hm-swatch" style={{ background: colors[i] }} />{labels[key]} <strong>{percent(row.percentages[key])}</strong>
                <small>{format.format(row.counts[key])} cells</small>
              </button>
              ))}</div>
            </div>
            {expanded && !group && <section aria-label={`C7 breakdown of ${labels[expanded]}`}>
              <h5>{labels[expanded]} · C7 composition</h5>
              <ul>{[...data.c7].sort((a, b) => b.counts[expanded] - a.counts[expanded]).map(entry => (
                <li key={entry.label}>{entry.label} · {format.format(entry.counts[expanded])} cells · {percent(row.counts[expanded] ? 100 * entry.counts[expanded] / row.counts[expanded] : null)}</li>
              ))}</ul>
            </section>}
            <button type="button" className="portal-secondary" onClick={exportPair}>Preview comparison CSV</button>
          </>
        )}
        <fieldset className="hm-legend">
          <legend>Comparison datasets</legend>
          {metadata.datasets.map((id, i) => (
            <label key={id}><input type="checkbox" checked={datasets.includes(id)} onChange={event => {
              setComparison(null);
              setExpanded(null);
              setDatasets(event.target.checked ? [...datasets, id] : datasets.filter(dataset => dataset !== id));
            }} />{metadata.study_cards[i].HypoMap_label}</label>
          ))}
        </fieldset>
      </section>}
      <details className="hm-coexpression-method">
        <summary>How co-detection is calculated</summary>
        <p>A gene is detected when a cell has at least one stored raw count. The conditional score divides cells detecting both genes by cells detecting {gene[1]}. Reverse rank is the position of {gene[1]} among all genes co-detected with the partner. Ties use higher total detection, then atlas index order. Category percentages divide by all eligible cells. Counts are pooled across the selected datasets before percentages are calculated.</p>
      </details>
      {csv && <CsvDialog csv={csv} onClose={() => setCsv(null)} />}
    </>
  );
}

export function Coexpression({ symbol }: { symbol: string }) {
  const [atlas, setAtlas] = useState<Awaited<ReturnType<typeof loadAtlasGene>> | 'error' | null>(null);
  const [attempt, retry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the Retry trigger, not read inside.
  useEffect(() => {
    let active = true;
    loadAtlasGene(symbol).then(
      data => { if (active) setAtlas(data); },
      () => { if (active) setAtlas('error'); },
    );
    return () => { active = false; };
  }, [symbol, attempt]);

  return (
    <section className="portal-card portal-card--wide hm-coexpression" aria-labelledby="hm-coexpression-title">
      <h2 id="hm-coexpression-title" className="portal-card-title">Co-expression</h2>
      <p className="portal-note">Single-cell co-detection in the mouse HypoMap atlas.</p>
      {atlas === null && <p role="status">Loading HypoMap gene…</p>}
      {atlas === 'error' && <p role="status">Could not load HypoMap. <button type="button" className="portal-secondary" onClick={() => {
        setAtlas(null);
        retry(n => n + 1);
      }}>Retry</button></p>}
      {atlas && atlas !== 'error' && (atlas.state === 'ready' ? <PairExplorer atlas={atlas} /> :
        <p>{atlas.state === 'ambiguous' ? `Multiple features match ${symbol}: ${atlas.candidates.join(', ')}.` : `No atlas feature matched ${symbol}.`}</p>)}
    </section>
  );
}
