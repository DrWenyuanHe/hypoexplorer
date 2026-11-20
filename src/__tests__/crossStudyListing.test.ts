import { describe, expect, it } from 'vitest';
import { geneRow, pathwayRow } from '../data/crossDatasetRows';
import {
  GENE_KEYS, PATHWAY_KEYS, listCrossStudy, type CrossStudyListing,
} from '../statistics/crossStudyListing';
import type { PathwayTrackRow, TrackRow } from '../types';

// The cross-study listing decides, for every view, what leads, the order and
// what is counted. These tables are the contract: a view test only checks that
// the listing reaches the page.

interface Group<R> { id: string; tracks: R[] }

/** A gene track named `id`, built through geneRow so its tier is the builder's. */
function gene(id: string, logFC: number, fdr: number | null, pval: number): TrackRow {
  return geneRow({ trackId: id, label: id, type: 'Tissue', logFC, fdr, pval, se: null, lowPower: false });
}

function pathway(id: string, NES: number, padj: number, pval: number): PathwayTrackRow {
  return pathwayRow({ trackId: id, label: id, type: 'Tissue', NES, padj, pval, size: 20, db: 'HALLMARK' });
}

const ids = <G, R extends { trackId: string }>(rows: CrossStudyListing<G, R>['lead']) => rows.map((r) => r.track.trackId);

// Tiers at a glance: F = FDR < 0.05, N = raw p < 0.05 only, X = neither.
const groups: Group<TrackRow>[] = [
  { id: 'A', tracks: [
    gene('F1', 1.0, 0.01, 0.0001),
    gene('N1', -0.5, 0.20, 0.010),
    gene('X1', 0.2, 0.60, 0.300),
  ] },
  { id: 'B', tracks: [
    gene('F2', -2.0, 0.01, 0.0002), // q ties F1; larger |effect|
    gene('N2', 0.8, 0.30, 0.002),
  ] },
  { id: 'C', tracks: [gene('X2', 0.0, 0.10, 0.040 + 0.02)] },
  { id: 'D', tracks: [] },
];

describe('listCrossStudy: what leads and the order', () => {
  it.each([
    {
      mode: 'nominal' as const, order: 'significance' as const,
      lead: ['F2', 'F1', 'N2', 'N1'], rest: ['X2', 'X1'],
      why: 'fdr by q (tie → |effect|), then nominal by p, then the rest by p',
    },
    {
      mode: 'fdr' as const, order: 'significance' as const,
      lead: ['F2', 'F1'], rest: ['X2', 'N1', 'N2', 'X1'],
      why: 'fdr by q, then every other tier as one band by q',
    },
    {
      mode: 'nominal' as const, order: 'effect' as const,
      lead: ['F2', 'F1', 'N2', 'N1'], rest: ['X1', 'X2'],
      why: 'tier bands, each by |effect| alone',
    },
    {
      mode: 'fdr' as const, order: 'effect' as const,
      lead: ['F2', 'F1'], rest: ['N2', 'N1', 'X1', 'X2'],
      why: 'fdr first, then the rest as one band by |effect|',
    },
  ])('$mode mode, $order order: $why', ({ mode, order, lead, rest }) => {
    const listing = listCrossStudy(groups, mode, GENE_KEYS, order);
    expect(ids(listing.lead)).toEqual(lead);
    expect(ids(listing.rest)).toEqual(rest);
  });

  it('keeps each row with the group it came from', () => {
    const listing = listCrossStudy(groups, 'nominal', GENE_KEYS, 'significance');
    expect(listing.lead.map((r) => `${r.group.id}:${r.track.trackId}`)).toEqual(['B:F2', 'A:F1', 'B:N2', 'A:N1']);
  });

  it('takes the tier from the row, never from the keys', () => {
    // A row whose stored tier disagrees with its numbers still lists by its tier.
    const odd = { ...gene('odd', 1, 0.9, 0.9), tier: 'fdr' as const, significant: true };
    const listing = listCrossStudy([{ id: 'A', tracks: [odd] }], 'fdr', GENE_KEYS, 'significance');
    expect(ids(listing.lead)).toEqual(['odd']);
  });
});

describe('listCrossStudy: counts', () => {
  it.each([
    {
      mode: 'nominal' as const,
      nominal: { tracks: 2, datasets: 0, up: 1, down: 1 },
    },
    { mode: 'fdr' as const, nominal: null },
  ])('$mode mode', ({ mode, nominal }) => {
    const listing = listCrossStudy(groups, mode, GENE_KEYS, 'significance');
    // Tracks and datasets follow the tiers in both modes.
    expect(listing.tracks).toEqual({ measured: 6, fdr: 2, up: 1, down: 1 });
    // D has no tracks: selected, but not measured.
    expect(listing.datasets).toEqual({ measured: 3, fdr: 2 });
    expect(listing.nominal).toEqual(nominal);
  });

  it('counts a dataset as nominal only when it has a nominal track and no fdr track', () => {
    const listing = listCrossStudy([
      { id: 'fdr+nominal', tracks: [gene('a', 1, 0.01, 0.001), gene('b', 1, 0.2, 0.01)] },
      { id: 'nominal', tracks: [gene('c', -1, 0.2, 0.01)] },
      { id: 'none', tracks: [gene('d', 1, 0.9, 0.5)] },
    ], 'nominal', GENE_KEYS, 'significance');
    expect(listing.datasets).toEqual({ measured: 3, fdr: 1 });
    expect(listing.nominal).toEqual({ tracks: 2, datasets: 1, up: 1, down: 1 });
  });

  it('counts a flat row toward its tier and toward neither direction', () => {
    const listing = listCrossStudy([
      { id: 'A', tracks: [gene('flat-fdr', 0, 0.01, 0.001), gene('flat-nominal', 0, 0.2, 0.01)] },
    ], 'nominal', GENE_KEYS, 'significance');
    expect(listing.tracks).toEqual({ measured: 2, fdr: 1, up: 0, down: 0 });
    expect(listing.nominal).toEqual({ tracks: 1, datasets: 0, up: 0, down: 0 });
  });

  it('lists nothing and counts nothing for no groups or only empty groups', () => {
    for (const input of [[], [{ id: 'A', tracks: [] }]]) {
      const listing = listCrossStudy(input as Group<TrackRow>[], 'nominal', GENE_KEYS, 'significance');
      expect(listing.lead).toEqual([]);
      expect(listing.rest).toEqual([]);
      expect(listing.tracks).toEqual({ measured: 0, fdr: 0, up: 0, down: 0 });
      expect(listing.datasets).toEqual({ measured: 0, fdr: 0 });
      expect(listing.nominal).toEqual({ tracks: 0, datasets: 0, up: 0, down: 0 });
    }
  });
});

describe('listCrossStudy: edge cases', () => {
  it('sorts missing and non-finite keys after every finite key', () => {
    const listing = listCrossStudy([{ id: 'A', tracks: [
      gene('nullQ', 3, null, 0.5),
      gene('nanQ', 2, Number.NaN, 0.5),
      gene('q0.9', 0.1, 0.9, 0.5),
      gene('infQ', 1, Number.POSITIVE_INFINITY, 0.5),
    ] }], 'fdr', GENE_KEYS, 'significance');
    // The finite q leads; the missing ones fall back to |effect|.
    expect(ids(listing.rest)).toEqual(['q0.9', 'nullQ', 'nanQ', 'infQ']);
  });

  it('accepts a q of exactly 0 and lets an FDR pass lead even with a missing p', () => {
    const listing = listCrossStudy([{ id: 'A', tracks: [
      gene('nominal', 5, 0.2, 0.001),
      gene('zero', 0.1, 0, Number.NaN),
    ] }], 'nominal', GENE_KEYS, 'significance');
    expect(listing.lead.map((r) => [r.track.trackId, r.track.tier])).toEqual([['zero', 'fdr'], ['nominal', 'nominal']]);
  });

  it('keeps input order on exact ties, so a subset orders as the whole does', () => {
    const tied = (id: string) => gene(id, 1, 0.01, 0.001);
    const all = [
      { id: 'A', tracks: [tied('a1'), tied('a2')] },
      { id: 'B', tracks: [tied('b1')] },
      { id: 'C', tracks: [tied('c1'), tied('c2')] },
    ];
    expect(ids(listCrossStudy(all, 'fdr', GENE_KEYS, 'significance').lead)).toEqual(['a1', 'a2', 'b1', 'c1', 'c2']);
    expect(ids(listCrossStudy([all[0], all[2]], 'fdr', GENE_KEYS, 'significance').lead)).toEqual(['a1', 'a2', 'c1', 'c2']);
  });

  it('never mutates the groups or their track arrays', () => {
    const input = groups.map((g) => ({ ...g, tracks: [...g.tracks] }));
    const before = input.map((g) => g.tracks.map((t) => t.trackId));
    listCrossStudy(input, 'nominal', GENE_KEYS, 'significance');
    expect(input.map((g) => g.tracks.map((t) => t.trackId))).toEqual(before);
  });

  it('orders pathways by padj, p and |NES|', () => {
    const listing = listCrossStudy([{ id: 'A', tracks: [
      pathway('small', 1.2, 0.01, 0.001),
      pathway('large', -2.4, 0.01, 0.001),
      pathway('nominal', 1.9, 0.2, 0.01),
    ] }], 'nominal', PATHWAY_KEYS, 'significance');
    expect(ids(listing.lead)).toEqual(['large', 'small', 'nominal']);
    expect(listing.tracks).toEqual({ measured: 3, fdr: 2, up: 1, down: 1 });
  });
});
