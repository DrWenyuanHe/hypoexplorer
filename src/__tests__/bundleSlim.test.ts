// Pins the bundle wire-size policy (scripts/lib/bundleSlim.mts): the
// threshold-guarded probability rounding and the field-drop rules that both
// the optimizer and the bundle generators apply before serializing. These are
// data-product guarantees, not display niceties — a regression here changes
// what the published bundles claim is significant.
import { describe, it, expect } from 'vitest';
import {
  roundProb,
  roundEffect,
  slimDeTable,
  slimPathwayBlock,
  slimTrackObject,
} from '../../scripts/lib/bundleSlim.mjs';

describe('roundProb (threshold-guarded, 6 significant digits)', () => {
  it('rounds full-double p-values to 6 significant digits', () => {
    expect(roundProb(0.000146752292633445)).toBe(0.000146752);
    expect(roundProb(0.0000928428470190918)).toBe(0.0000928428);
  });

  it('KEEPS full precision when rounding would flip a threshold classification', () => {
    // The documented real-corpus flip: macaque i40 ARRB1 at FDR
    // 0.0499876945504852 — naive rounding to fewer digits lands on 0.05 and
    // fails `< 0.05`. Six digits keeps it below, but a value straddling the
    // cliff at the 7th digit must keep its exact bytes.
    const straddler = 0.04999999949; // rounds to 0.05 → would flip `< 0.05`
    expect(roundProb(straddler)).toBe(straddler);
    // And the classification is preserved for the documented case too.
    const arrb1 = 0.0499876945504852;
    expect((roundProb(arrb1) as number) < 0.05).toBe(true);
  });

  it('guards every classification cliff the app uses', () => {
    for (const t of [0.0001, 0.001, 0.01, 0.05]) {
      const justBelow = t * (1 - 1e-9);
      const r = roundProb(justBelow) as number;
      expect(r < t).toBe(true);
    }
  });

  it('passes null (R NA) and non-numbers through untouched', () => {
    expect(roundProb(null)).toBeNull();
    expect(roundProb(undefined)).toBeUndefined();
  });
});

describe('slimDeTable', () => {
  const table = () => [
    { gene: 'A', logFC: 1.2345, logCPM: 3.8887, PValue: 0.000146752292633445, FDR: 0.165923896463786, se: 0.332063172, rank_score: 0.780112345, rankPos: 1, ens: 'ENSMUSG1' },
    { gene: 'B', logFC: -0.5, logCPM: null, PValue: 0.2, FDR: null, se: null, rank_score: -0.1, rankPos: 2, ens: 'ENSMUSG2' },
  ];

  it('drops rankPos when sequential, null logCPM, and ens; keeps real logCPM', () => {
    const de = table();
    const stats = slimDeTable(de);
    expect(stats.rankPosSequential).toBe(true);
    expect(de[0]).not.toHaveProperty('rankPos');
    expect(de[0]).not.toHaveProperty('ens');
    expect(de[0].logCPM).toBe(3.8887);
    expect(de[1]).not.toHaveProperty('logCPM');
    expect(de[1].FDR).toBeNull();
    expect(de[1].se).toBeNull();
  });

  it('REFUSES to drop rankPos when it does not equal index+1', () => {
    const de = [
      { gene: 'A', rankPos: 2 },
      { gene: 'B', rankPos: 1 },
    ];
    const stats = slimDeTable(de);
    expect(stats.rankPosSequential).toBe(false);
    expect(de[0].rankPos).toBe(2);
    expect(de[1].rankPos).toBe(1);
  });

  it('rounds se and rank_score to 5 significant digits, leaves logFC alone', () => {
    const de = table();
    slimDeTable(de);
    expect(de[0].se).toBe(0.33206);
    expect(de[0].rank_score).toBe(0.78011);
    expect(de[0].logFC).toBe(1.2345);
  });

  it('is idempotent', () => {
    const de = table();
    slimDeTable(de);
    const once = JSON.stringify(de);
    slimDeTable(de);
    expect(JSON.stringify(de)).toBe(once);
  });
});

describe('slimPathwayBlock / slimTrackObject', () => {
  it('rounds pathway pval/padj but never NES, leadingEdge, or pathway names', () => {
    const block = {
      GO_BP: [{ pathway: 'GOBP_X', pval: 0.340909090909091, padj: 0.810080869664186, NES: 1.0976, leadingEdge: ['A', 'B'] }],
    };
    slimPathwayBlock(block);
    expect(block.GO_BP[0].pval).toBe(0.340909);
    expect(block.GO_BP[0].padj).toBe(0.810081);
    expect(block.GO_BP[0].NES).toBe(1.0976);
    expect(block.GO_BP[0].leadingEdge).toEqual(['A', 'B']);
  });

  it('slims de, deByContrast tables and embedded pathways on a track object', () => {
    const track = {
      de: [{ gene: 'A', PValue: 0.123456789012345, rankPos: 1 }],
      deByContrast: { c1: [{ gene: 'B', FDR: 0.987654321098765, rankPos: 1 }] },
      pathways: { KEGG: [{ pathway: 'K', pval: 0.111111111111111 }] },
      cpm: { A: [1.5] },
    };
    const stats = slimTrackObject(track);
    expect(stats.rankPosDropped).toBe(2);
    expect(track.de[0].PValue).toBe(0.123457);
    expect(track.deByContrast.c1[0].FDR).toBe(0.987654);
    expect(track.pathways.KEGG[0].pval).toBe(0.111111);
    expect(track.cpm).toEqual({ A: [1.5] });
  });
});

describe('roundEffect', () => {
  it('rounds numbers to 5 significant digits and passes null through', () => {
    expect(roundEffect(0.000123456789)).toBe(0.00012346);
    expect(roundEffect(null)).toBeNull();
  });
});
