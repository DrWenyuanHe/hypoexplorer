import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { assertRectangular } from '../../scripts/lib/matrixShape.mjs';

// The guard the four matrix parsers share (scripts/lib/matrixShape.mts).
//
// R's write.table with row names writes N header fields over N+1 data fields.
// Both read.delim and fread absorb the extra leading column silently, which is
// why a DE table and its SE sidecar come out correct while the bundle built from
// the same matrix is shifted by one column. Every parser in scripts/ indexes by
// header position, and `+row[colIdx[s]] || 0` turns each out-of-range read into
// a believable 0 — so the failure ships as a full-size gene list of plausible
// numbers attached to the wrong samples.
//
// These run against the REAL files on disk, not fixtures, because the claim
// being made is about this repo's data: three deposited matrices carry the
// broken shape and are one config edit from being ingested, and one matrix the
// pipeline uses today is ragged in a way that must NOT trip the guard.

const at = (rel: string) => resolve(__dirname, '..', '..', rel);
const readGz = (rel: string) => gunzipSync(readFileSync(at(rel))).toString('utf8');
const split = (l: string) => l.split('\t');
const rowsOf = (rel: string) => readGz(rel).split(/\r?\n/).filter((l) => l.length);

describe('assertRectangular', () => {
  it('passes a matrix whose header and first data row agree', () => {
    expect(() => assertRectangular('m', ['gene', 'a', 'b'], ['Pomc', '1', '2'])).not.toThrow();
  });

  it('names the row-names cause on the one-extra-field case', () => {
    expect(() => assertRectangular('GSE1.txt', ['a', 'b'], ['Pomc', '1', '2']))
      .toThrow(/GSE1\.txt: matrix is not rectangular — 2 header field\(s\) over 3/);
    expect(() => assertRectangular('GSE1.txt', ['a', 'b'], ['Pomc', '1', '2']))
      .toThrow(/row names written without a header/);
  });

  it('reports a non-row-names mismatch without blaming row names', () => {
    // A one-field header over 90 data fields is a comment line defeating the
    // delimiter sniffer (GSE167264), not row names. Saying "row.names = FALSE"
    // there would send the reader to fix the wrong thing.
    const msg = (() => { try { assertRectangular('x', ['all'], new Array(90).fill('v')); } catch (e) { return String(e); } })();
    expect(msg).toMatch(/1 header field\(s\) over 90/);
    expect(msg).not.toMatch(/row names/);
  });

  it('ignores a header-only file rather than throwing on the absent row', () => {
    expect(() => assertRectangular('m', ['gene', 'a'], undefined)).not.toThrow();
  });

  it('blocks each of the three deposited matrices that carry the broken shape', () => {
    const cases: Array<[string, number, number]> = [
      ['geo_replication/datasets/GSE295250_mmus_hypo_hibernation/raw/GSE295250_FtoE3KO_Fed_Adult_CountsEns_Fed2023.txt.gz', 6, 7],
      ['geo_replication/datasets/GSE294478_mmus_hypothalamus_fasting/raw/GSE294478_refeed_Feb2023.txt.gz', 10, 11],
      ['geo_replication/datasets/GSE167264_mmus_hypothalamus_obob/raw/GSE167264_counts.txt.gz', 1, 90],
    ];
    for (const [rel, nHeader, nRow] of cases) {
      const lines = rowsOf(rel);
      const header = split(lines[0]);
      expect(header.length).toBe(nHeader);
      expect(split(lines[1]).length).toBe(nRow);
      expect(() => assertRectangular(rel, header, split(lines[1]))).toThrow(/not rectangular/);
    }
  });

  it('leaves the ragged-final-row matrix the pipeline actually uses alone', () => {
    // GSE135639_Newborn.txt.gz is in use and legitimately ends short. Comparing
    // the FIRST data row only is what keeps it buildable — a whole-file check
    // would reject a matrix that has been correct all along.
    const lines = rowsOf('geo_replication/datasets/GSE135639_mmus_pomc_maternal_hfd/raw/GSE135639_Newborn.txt.gz');
    const header = split(lines[0]);
    expect(header.length).toBe(33);
    expect(() => assertRectangular('GSE135639_Newborn.txt.gz', header, split(lines[1]))).not.toThrow();
  });
});
