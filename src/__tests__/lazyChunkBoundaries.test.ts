import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Guards the code-splitting boundaries that keep the landing hub small.
//
// These are the cheapest possible insurance against a silent, expensive
// regression. Each of the heavy libraries below is confined to exactly one
// module, reached only through a dynamic import(), so it becomes its own chunk
// and is fetched on demand. Add a STATIC import of any of them anywhere else and
// Rollup pulls it straight back into the eager bundle — the app still builds,
// every test still passes, and the landing page silently grows by hundreds of KB.
// Nothing else in the suite would notice; that is what these tests are for.
//
// Measured weights at the time of writing (raw / gzipped):
//   recharts + d3 ('charts')  319 KB / 80 KB   — only BarSEMChartImpl.tsx
//   xlsx                      419 KB / 139 KB  — only via utils/lazyExport.ts
//   html2canvas               198 KB / 47 KB   — only via utils/lazyExport.ts
//
// If a boundary genuinely needs to move, update the expectation here AND
// re-check the eager asset list in dist/index.html — that is the ground truth.

const SRC = join(process.cwd(), 'src');

// Only files that ship. Tests are never part of a bundle, so a static import
// there cannot widen the eager chunk — and the local-dataset importer's tests
// legitimately load xlsx directly to exercise the workbook parser.
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Files with a STATIC `import … from '<spec>'` (ignores dynamic `import(...)`). */
function staticImportersOf(spec: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((f) => {
      const src = readFileSync(f, 'utf8');
      // Static import statements only: `import x from 'y'` / `import 'y'`.
      // A dynamic `import('y')` never matches, because it has a `(` after the
      // keyword rather than a binding or a bare specifier.
      const re = /^\s*import\s+(?!\()[^;]*?from\s+['"]([^'"]+)['"]/gm;
      let m = re.exec(src);
      while (m !== null) {
        // `import type { … }` erases at compile time and pulls in no runtime
        // code, so it cannot drag a library into the bundle.
        const isTypeOnly = /^\s*import\s+type\b/.test(m[0]);
        if (!isTypeOnly && spec.test(m[1])) return true;
        m = re.exec(src);
      }
      return false;
    })
    .map((f) => relative(process.cwd(), f).replace(/\\/g, '/'));
}

/**
 * Every file the entry module reaches through static, value-carrying imports
 * and re-exports (the eager graph), mapped to the file that first imported it.
 * Dynamic `import()` is the split point, so it is never followed; `import type`
 * and imports whose every specifier is `type` are erased, so they are skipped.
 */
function eagerGraph(entry: string): Map<string, string | null> {
  const resolveSpec = (from: string, spec: string): string | null => {
    const base = join(from, '..', spec);
    for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
      try { if (statSync(base + ext).isFile()) return base + ext; } catch { /* next candidate */ }
    }
    return null;
  };
  const seen = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  const re = /^\s*(import|export)\s+(?!\()(type\s)?([^;]*?)\s*from\s+['"](\.[^'"]+)['"]|^\s*import\s+['"](\.[^'"]+)['"]/gm;
  while (queue.length) {
    const file = queue.shift()!;
    if (!/\.tsx?$/.test(file)) continue;
    const src = readFileSync(file, 'utf8');
    for (let m = re.exec(src); m !== null; m = re.exec(src)) {
      if (m[2]) continue;
      const names = m[3] ?? '';
      if (/^\{[^}]*\}$/.test(names.trim())
        && names.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith('type '))) continue;
      const spec = m[4] ?? m[5];
      if (spec.endsWith('.css')) continue;
      const target = resolveSpec(file, spec);
      if (target && !seen.has(target)) { seen.set(target, file); queue.push(target); }
    }
  }
  return seen;
}

describe('lazy chunk boundaries', () => {
  it('the entry graph reaches neither evidence ledger', () => {
    // The internal QC (~3.9 MB) and author-validation (~1 MB) ledgers load with
    // the views that show evidence, never on the hub's first paint. The router
    // sits in the entry graph, so it holds study selection's value and URL form
    // (crossdataset/studySelectionLink.ts) and must not reach the derivation
    // hook, whose catalog and quality imports pull in both ledgers.
    const graph = eagerGraph(join(SRC, 'main.tsx'));
    const chain = (file: string) => {
      const steps: string[] = [];
      for (let at: string | null | undefined = file; at; at = graph.get(at)) steps.unshift(relative(process.cwd(), at).replace(/\\/g, '/'));
      return steps.join(' -> ');
    };
    const ledgers = [
      join(process.cwd(), 'data', 'internal-qc', 'assessments.generated.json'),
      join(process.cwd(), 'data', 'author-validation', 'validation-records.generated.json'),
    ];
    expect(ledgers.filter((ledger) => graph.has(ledger)).map(chain)).toEqual([]);
    // The walk is live: it does reach the router and the light selection module.
    expect(graph.has(join(SRC, 'appRouter.ts'))).toBe(true);
    expect(graph.has(join(SRC, 'crossdataset', 'studySelectionLink.ts'))).toBe(true);
  });

  it('recharts is imported by exactly one module', () => {
    expect(staticImportersOf(/^recharts$/)).toEqual(['src/gene-explorer/BarSEMChartImpl.tsx']);
  });

  it('the recharts implementation is never imported statically (that would un-split it)', () => {
    // BarSEMChart.tsx may `import type` from it (erased) and `import()` it
    // dynamically — neither counts. A value import from anywhere, including the
    // wrapper itself, puts 319 KB back on the hub's critical path.
    expect(staticImportersOf(/BarSEMChartImpl$/)).toEqual([]);
  });

  it('xlsx and html2canvas are never imported statically', () => {
    // Both are reached only through utils/lazyExport.ts's dynamic imports, from
    // export click handlers.
    expect(staticImportersOf(/^xlsx$/)).toEqual([]);
    expect(staticImportersOf(/^html2canvas$/)).toEqual([]);
  });

  it('the internal QC ledger is imported statically only by the quality modules', () => {
    // The ledger chunk is ~3.9 MB. The quality views render it, so they import
    // it through these two modules. Export provenance reaches it only through
    // utils/lazyExport.ts's dynamic import on the first export, which keeps it
    // out of the explorer tabs. A static import anywhere else (exportProvenance.ts
    // once had one) puts it back on every explorer tab.
    expect(staticImportersOf(/(^|\/)internalQc$/).sort()).toEqual([
      'src/data/datasetQuality.ts',
      'src/data/datasetQualityR460.ts',
    ]);
  });
});
