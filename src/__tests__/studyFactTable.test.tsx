import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StudyFactTable, type StudyFacts } from '../common/StudyMetadata';
import { getDataset } from '../data/datasets';
import { getActiveContrast, listContrasts } from '../data/contrasts';
import type { Dataset } from '../types';

// The shared study record, exercised as a component rather than through either
// of its two callers.
//
// Both surfaces now render this one table, so the branches that decide WHICH
// rows exist — the accession the chips already carry, the Groups row a two-arm
// design does not need, the caveat naming which comparison the replicate counts
// belong to — are the ones that can silently say the wrong thing on one surface
// and not the other. None of them had a test of their own; the callers' tests
// only ever hit the shape their own dataset happens to produce.

const FACTS: StudyFacts = {
  trackCount: 3, trackLabel: 'Arcuate nucleus', nGenes: 12345,
  nBaseline: 4, nCase: 4, nVaries: false, lowPowerTracks: 0,
};

/** The value cell of one labelled row, whitespace-collapsed, or null if absent. */
function row(field: string): string | null {
  const label = screen.queryByText(field);
  const tr = label?.closest('tr');
  if (!tr) return null;
  return (tr.querySelector('td')?.textContent || '').replace(/\s+/g, ' ').trim();
}

describe('StudyFactTable — the Source band', () => {
  it('drops the Accession row when the link chips already carry that accession', () => {
    const dataset = getDataset('mouse_arc_hfd_gse225038')!;
    const { container } = render(
      <StudyFactTable dataset={dataset} facts={FACTS} contrasts={listContrasts(dataset)} showLinks />,
    );
    // Not a row any more — but still reachable, once, as a chip that links out.
    expect(row('Accession')).toBeNull();
    const chips = [...container.querySelectorAll('a')].filter(
      (a) => a.getAttribute('href') === 'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE225038',
    );
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('GSE225038');

    // Folded in here because it needs a fully populated record: the Measurement
    // row states the track count, then the features detected in the dataset's
    // OWN vocabulary rather than a hardcoded "genes".
    expect(row('Tracks')).toBe('3 tracks · 12,345 genes detected');
  });

  it('keeps the Accession row when the repository accession resolves to no URL', () => {
    // No shipping dataset has one today, so this is the branch that would rot:
    // an accession the link builder cannot turn into a chip must not vanish from
    // the record along with the chip it never produced.
    const base = getDataset('mouse_arc_hfd_gse225038')!;
    const dataset: Dataset = { ...base, geo: 'CNP0003785' };
    render(<StudyFactTable dataset={dataset} facts={FACTS} showLinks />);
    expect(row('Accession')).toBe('CNP0003785');
    expect(screen.queryByRole('link', { name: /CNP0003785/ })).toBeNull();
  });

  it("states the depositor's upstream processing, marked as deposited", () => {
    const dataset = getDataset('mouse_arc_hfd_gse225038')!;
    render(<StudyFactTable dataset={dataset} facts={FACTS} />);
    expect(row('Upstream processing')).toBe('STAR 2.5.2b · mm10 · featureCounts 1.5.1 (as deposited)');
  });

  it('states the reviewed macaque methods and qualifies unstated reference details', () => {
    // The macaque atlas has no geo field; its record is keyed by the CNGB project.
    const dataset = getDataset('macaque_snrna')!;
    render(<StudyFactTable dataset={dataset} facts={FACTS} />);
    expect(row('Upstream processing')).toBe('STAR 2.5.3 · Macaca_fascicularis_5.0 (pre-mRNA reference) (as deposited)');
    expect(screen.getByTitle(/Annotation provider\/release and the snRNA-seq counting tool are not stated/)).toBeTruthy();
  });

  it('states the accession as a row and renders no Links row when showLinks is off', () => {
    const dataset = getDataset('mouse_arc_hfd_gse225038')!;
    render(<StudyFactTable dataset={dataset} facts={FACTS} />);
    expect(row('Accession')).toBe('GSE225038 · GEO');
    expect(row('Links')).toBeNull();
  });
});

describe('StudyFactTable — which comparison the replicate counts describe', () => {
  const dataset = getDataset('mouse_pomc_maternal_hfd_gse135639')!;
  const contrasts = listContrasts(dataset);

  it('names the contrast the arms belong to when the study declares several', () => {
    const p0 = getActiveContrast(dataset, 'hfd_vs_chow_p0')!;
    render(
      <StudyFactTable
        dataset={dataset} facts={FACTS}
        baselineGroup={p0.baseline} caseGroup={p0.caseGroup}
        contrasts={contrasts}
      />,
    );
    expect(row('Contrasts')).toContain('Replicates above are for Maternal HFD vs chow · at P0.');
    // And it names exactly one of them — silence about the other three is the
    // whole point of the line.
    expect(row('Contrasts')).not.toContain('at P21.');
  });

  it('falls back to naming the default comparison when the arms match no declared contrast', () => {
    // GSE135639's two POOLED diet arms are part of the design but no contrast
    // draws them, so nothing in `contrasts` matches this pair.
    const [pooledBaseline, pooledCase] = dataset.groups;
    render(
      <StudyFactTable
        dataset={dataset} facts={FACTS}
        baselineGroup={pooledBaseline} caseGroup={pooledCase}
        contrasts={contrasts}
      />,
    );
    expect(row('Contrasts')).toContain("Replicates above are the default comparison's.");
  });

  it('adds no such caveat when the study declares a single comparison', () => {
    const single = getDataset('mouse_arc_hfd_gse225038')!;
    const only = getActiveContrast(single)!;
    render(
      <StudyFactTable
        dataset={single} facts={FACTS}
        baselineGroup={only.baseline} caseGroup={only.caseGroup}
        contrasts={listContrasts(single)}
      />,
    );
    expect(screen.queryByText('Contrasts')).toBeNull();
    expect(row('Contrast')).not.toContain('Replicates above');
  });
});

describe('StudyFactTable — the Groups row', () => {
  it('is omitted when the design holds nothing beyond the two arms', () => {
    const dataset = getDataset('mouse_arc_hfd_gse225038')!;
    const contrast = getActiveContrast(dataset)!;
    render(
      <StudyFactTable
        dataset={dataset} facts={FACTS}
        baselineGroup={contrast.baseline} caseGroup={contrast.caseGroup}
      />,
    );
    // Repeating the same two groups underneath the arms would say nothing new.
    expect(screen.queryByText('Groups')).toBeNull();
    expect(row('Replicates')).toBe('4 Chowvs4 HFD');
  });

  it('lists every group in Replicates when the record has no arms to name', () => {
    const dataset = getDataset('mouse_pomc_maternal_hfd_gse135639')!;
    render(
      <StudyFactTable
        dataset={dataset} facts={FACTS}
        baselineGroup={null} caseGroup={null}
        groupCounts={{ byGroup: { chow_p0: 5, hfd_p21: 4 }, track: null }}
      />,
    );
    const replicates = row('Replicates')!;
    // Counted groups carry their N; the rest render bare rather than borrowing.
    expect(replicates).toContain('5 Chow · P0');
    expect(replicates).toContain('4 HFD · P21');
    expect(replicates).toContain('Maternal chow');
    expect(replicates).not.toMatch(/\d+ Maternal chow/);
    // With no arms there is no second list to draw.
    expect(screen.queryByText('Groups')).toBeNull();
  });
});

describe('StudyFactTable — table semantics', () => {
  it('bands the record and marks every label as a header cell', () => {
    const dataset = getDataset('mouse_arc_hfd_gse225038')!;
    const { container } = render(
      <StudyFactTable dataset={dataset} facts={FACTS} contrasts={listContrasts(dataset)} showLinks />,
    );
    // scope="rowgroup", not "colgroup": these headings introduce the ROWS of a
    // <tbody>. colgroup would tell assistive tech they head a column group,
    // which is a different (and here, wrong) association.
    expect([...container.querySelectorAll('th[scope="rowgroup"]')].map((t) => t.textContent))
      .toEqual(['Comparison', 'Sample', 'Measurement', 'Source']);
    // Each band is a real <tbody>, not a styled spacer row.
    expect(container.querySelectorAll('tbody')).toHaveLength(4);
    // Row labels name the cell beside them; a styled <td> would not.
    const labels = [...container.querySelectorAll('th[scope="row"]')].map((t) => t.textContent);
    expect(labels).toContain('Replicates');
    expect(labels).toContain('Citation');
    expect(container.querySelector('table td[style*="width: 150px"]')).toBeNull();
  });

  it('reports low-power tracks beside the track count', () => {
    const dataset = getDataset('macaque_snrna')!;
    render(
      <StudyFactTable
        dataset={dataset}
        facts={{ ...FACTS, trackCount: 60, nGenes: null, lowPowerTracks: 5 }}
      />,
    );
    const populations = row(
      `${(dataset.trackNoun || 'track').charAt(0).toUpperCase()}${(dataset.trackNoun || 'track').slice(1)}s`,
    );
    expect(populations).toBe('60 populations · 5 below n=3');
    expect(within(screen.getByText('Pathway enrichment').closest('tr')!).getByText(
      dataset.supportsPathways ? 'GO · Hallmark · KEGG · Reactome' : 'Not available for this dataset',
    )).toBeTruthy();
  });
});
