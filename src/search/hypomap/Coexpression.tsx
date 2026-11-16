import { useState } from 'react';
import { type Gene, loadAtlasGene, type ReadyAtlas } from './atlas';
import {
  CATEGORIES, type Category, categoryLabels, comparisonCsv, type DatasetOutcome, loadComparison, loadRanking, unsupportedReason,
} from './codetection';
import { type Csv, CsvDialog } from './CsvDialog';
import { useLoad } from './useLoad';
import './preview.css';
import './coexpression.css';

const format = new Intl.NumberFormat('en-US');
const colors = ['#225d88', '#618bb1', '#bc753d', '#e1e8ef'];
const percent = (n: number | null) => n === null ? '—' : `${n.toFixed(2)}%`;

function Retry({ children, onClick }: { children: string; onClick: () => void }) {
  return <button type="button" className="portal-secondary" onClick={onClick}>{children}</button>;
}

function UnsupportedList({ rows, query, partner }: { rows: DatasetOutcome[]; query: Gene; partner: Gene }) {
  return (
    <ul className="hm-unsupported">{rows.map(row => row.state === 'unsupported' && (
      <li key={row.dataset}>{row.label} · {unsupportedReason(row, query, partner)}</li>
    ))}</ul>
  );
}

function PairExplorer({ atlas }: { atlas: ReadyAtlas }) {
  const { gene, metadata } = atlas;
  const [query, setQuery] = useState('');
  const [queryError, setQueryError] = useState('');
  const [choices, setChoices] = useState<string[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [partner, setPartner] = useState<Gene | null>(null);
  const [datasets, setDatasets] = useState(metadata.datasets);
  const [population, setPopulation] = useState('');
  const [expanded, setExpanded] = useState<Category | null>(null);
  const [csv, setCsv] = useState<Csv | null>(null);

  const ranking = useLoad(gene[0], signal => loadRanking(atlas, signal));
  const comparison = useLoad(partner && datasets.length ? `${partner[0]}|${datasets.join(',')}` : null,
    signal => loadComparison(atlas, partner as Gene, datasets, signal));

  function selectPartner(next: Gene) {
    setQuery(next[1]);
    setQueryError('');
    setChoices([]);
    if (next[0] === partner?.[0]) return;
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

  const result = comparison.state === 'loaded' ? comparison.value : null;
  const data = result && (result.state === 'ready' || result.state === 'partial') ? result : null;
  const group = data?.c7.find(row => row.label === population);
  const row = group ?? data?.whole;
  const scope = group?.label ?? 'All hypothalamic cells';
  let end = 0;
  const stops = CATEGORIES.map((key, i) => {
    const start = end;
    end += row?.percentages[key] ?? 0;
    return `${colors[i]} ${start}% ${end}%`;
  });
  const labels = partner ? categoryLabels(gene, partner) : null;
  const rankingValue = ranking.state === 'loaded' ? ranking.value : null;
  const total = metadata.datasets.length;

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
      {ranking.state === 'loading' && <p role="status">Loading recommendations…</p>}
      {ranking.state === 'failed' && <p role="status">Could not load recommendations. <Retry onClick={ranking.retry}>Retry</Retry></p>}
      {rankingValue?.state === 'rejected' && <p role="alert">{rankingValue.message}</p>}
      {rankingValue?.state === 'ready' && (
        <>
          <p className="portal-note">Ranked by the share of {gene[1]}-positive cells that also detect the partner across {rankingValue.datasetCount === total
            ? `all ${total}` : `${rankingValue.datasetCount} of ${total}`} HypoMap datasets.</p>
          {rankingValue.partners.length ? <ol className="hm-ranking">{rankingValue.partners.map(candidate => (
            <li key={candidate.gene[0]}>
              <button type="button" className="portal-secondary" aria-pressed={partner?.[0] === candidate.gene[0]} disabled={lookingUp}
                title={`${format.format(candidate.both)} of ${format.format(rankingValue.queryPositive)} cells`} onClick={() => selectPartner(candidate.gene)}>
                <span>{candidate.gene[1]}</span><strong>{percent(candidate.conditionalPercent)}</strong>
              </button>
              <small className="hm-reverse-rank">{gene[1]} ranks #{format.format(candidate.reverseRank)} for {candidate.gene[1]}</small>
            </li>
          ))}</ol> : <p>No co-detected partners in the atlas.</p>}
        </>
      )}
      {partner && labels && <section className="hm-card hm-pair" aria-label={`${gene[1]} × ${partner[1]}`}>
        <h4>{gene[1]} × {partner[1]}</h4>
        {comparison.state === 'idle' ? <p>Select at least one dataset.</p>
          : comparison.state === 'failed' ? <p role="status">Comparison could not be loaded. <Retry onClick={comparison.retry}>Retry comparison</Retry></p>
          : !result ? <p role="status">Loading measured comparison…</p>
          : result.state === 'rejected' ? <p role="alert">{result.message}</p>
          : result.state === 'unsupported' ? (
            <>
              <p role="status">No selected dataset measures both {gene[1]} and {partner[1]}, so there is no co-detection to show.</p>
              <UnsupportedList rows={result.datasets} query={gene} partner={partner} />
            </>
          ) : data && row && (
          <>
            {data.state === 'partial' && <div role="status" className="hm-partial">
              <p>{format.format(data.datasets.filter(entry => entry.state === 'unsupported').length)} of {format.format(data.datasets.length)} selected
                datasets do not measure both genes and are left out of the pooled counts:</p>
              <UnsupportedList rows={data.datasets} query={gene} partner={partner} />
            </div>}
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
              <div className="hm-quadrants">{CATEGORIES.map((key, i) => (
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
            <button type="button" className="portal-secondary" onClick={() => setCsv(comparisonCsv(data, gene, partner, group?.label ?? null))}>Preview comparison CSV</button>
          </>
        )}
        <fieldset className="hm-legend">
          <legend>Comparison datasets</legend>
          {metadata.datasets.map((id, i) => (
            <label key={id}><input type="checkbox" checked={datasets.includes(id)} onChange={event => {
              setExpanded(null);
              setDatasets(event.target.checked ? metadata.datasets.filter(dataset => dataset === id || datasets.includes(dataset))
                : datasets.filter(dataset => dataset !== id));
            }} />{metadata.study_cards[i].HypoMap_label}</label>
          ))}
        </fieldset>
      </section>}
      <details className="hm-coexpression-method">
        <summary>How co-detection is calculated</summary>
        <p>A gene is detected when a cell has at least one stored raw count. The conditional score divides cells detecting both genes by cells detecting {gene[1]}. Reverse rank is the position of {gene[1]} among all genes co-detected with the partner. Ties use higher total detection, then atlas index order. Category percentages divide by all eligible cells. Counts are pooled across the selected datasets before percentages are calculated; a selected dataset that does not measure both genes is listed and left out of the pool.</p>
      </details>
      {csv && <CsvDialog csv={csv} onClose={() => setCsv(null)} />}
    </>
  );
}

export function Coexpression({ symbol }: { symbol: string }) {
  const atlas = useLoad(symbol, () => loadAtlasGene(symbol));
  const value = atlas.state === 'loaded' ? atlas.value : null;
  return (
    <section className="portal-card portal-card--wide hm-coexpression" aria-labelledby="hm-coexpression-title">
      <h2 id="hm-coexpression-title" className="portal-card-title">Co-expression</h2>
      <p className="portal-note">Single-cell co-detection in the mouse HypoMap atlas.</p>
      {atlas.state === 'loading' && <p role="status">Loading HypoMap gene…</p>}
      {atlas.state === 'failed' && <p role="status">Could not load HypoMap. <Retry onClick={atlas.retry}>Retry</Retry></p>}
      {value && (value.state === 'ready' ? <PairExplorer atlas={value} /> :
        <p>{value.state === 'ambiguous' ? `Multiple features match ${symbol}: ${value.candidates.join(', ')}.` : `No atlas feature matched ${symbol}.`}</p>)}
    </section>
  );
}
