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

describe('lazy chunk boundaries', () => {
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
});
