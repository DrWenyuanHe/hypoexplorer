// Figure downloads for the compare grid: one chart tile as PNG or SVG, one
// gene's row of tiles as PNG, and every gene's row at once.
//
// A single chart's PNG is its SVG (below) drawn onto a canvas with the page's
// loaded fonts inlined. The row and whole-grid PNGs go through html2canvas
// (loaded on first use by utils/lazyExport, the same path as the Gene
// Explorer's "Export PNG"), so what is saved is what is on screen: caption,
// unit, P and the per-animal dots. The SVG is the chart's own
// recharts <svg>, cloned with its computed colours and fonts written inline,
// because a standalone .svg cannot see the page's stylesheet or resolve
// `var(--font-sans)`. A caption is drawn above it from the caller's text, since
// the tile's caption is HTML outside the <svg>.
//
// Filenames are the export-provenance module's `exportName`, like every other
// download; the SVG also carries the provenance snapshot in its <metadata>.
// No new dependency: "all charts" stitches the per-gene snapshots into ONE PNG
// when the result fits a canvas every browser accepts, and only falls back to
// one file per gene when it would not. "Individual charts" writes one file per
// tile into a ZIP built by utils/zip (stored entries; PNGs are compressed already).

import { loadHtml2Canvas, withHtml2Canvas } from '../utils/lazyExport';
import { downloadFile } from '../utils/exportAction';
import { exportName, exportProvenance, trackSubject } from '../utils/exportProvenance';
import { fmtP } from '../utils/format';
import { zipStore, type ZipEntry } from '../utils/zip';
import { FONT_MONO, FONT_SANS, NEUTRAL_TEXT_COLOR } from '../styles/constants';
import type { ChartScale } from '../utils/chartScale';
import type { PopData } from '../types';

/** Mark an element (a download button, a remove link) to be left out of a snapshot. */
export const EXPORT_IGNORE_ATTR = 'data-export-ignore';

type Html2Canvas = Awaited<ReturnType<typeof loadHtml2Canvas>>;

// Canvas limits differ by browser: iOS Safari refuses a canvas over ~16.7M
// pixels, and several engines cap a side at 16384. Staying inside both keeps
// a 60-population grid from coming back as a blank image on a phone.
const MAX_CANVAS_SIDE = 16_384;
const MAX_CANVAS_AREA = 16_000_000;
// Retina-sharp when it fits; the Gene Explorer snapshot uses the same 2x.
const PREFERRED_SCALE = 2;
// Below this a stitched grid gets too soft to read, so it is split per gene.
const MIN_COMBINED_SCALE = 1;
// Vertical gap between stitched gene rows, in CSS pixels.
const ROW_GAP = 12;
// Browsers drop anchor clicks that arrive in the same tick; a short pause
// between files lets each one through.
const MULTI_FILE_DELAY_MS = 300;

function fitScale(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return PREFERRED_SCALE;
  const byArea = Math.sqrt(MAX_CANVAS_AREA / (width * height));
  const bySide = MAX_CANVAS_SIDE / Math.max(width, height);
  return Math.min(PREFERRED_SCALE, byArea, bySide);
}

function snapshot(html2canvas: Html2Canvas, el: HTMLElement, scale: number): Promise<HTMLCanvasElement> {
  return html2canvas(el, {
    backgroundColor: '#ffffff',
    scale,
    ignoreElements: (node: Element) => node.hasAttribute(EXPORT_IGNORE_ATTR),
  });
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Save one element (a chart tile, a gene's row of tiles) as a PNG. */
export function saveElementPng(el: HTMLElement, filename: string): Promise<void> {
  return withHtml2Canvas(async (html2canvas) => {
    const { width, height } = el.getBoundingClientRect();
    const canvas = await snapshot(html2canvas, el, Math.max(0.5, fitScale(width, height)));
    downloadFile(filename, canvas.toDataURL('image/png'));
  });
}

export interface ChartBlock {
  el: HTMLElement;
  /** The file this block is saved as when the grid is too large for one image. */
  filename: string;
}

/**
 * Save every gene's row of charts. One stitched PNG when the whole grid fits a
 * canvas at readable resolution, otherwise one PNG per gene (the description
 * in the export menu says so).
 */
export function saveChartBlocksPng(blocks: readonly ChartBlock[], combinedFilename: string): Promise<void> {
  return withHtml2Canvas(async (html2canvas) => {
    if (!blocks.length) return;
    const rects = blocks.map((b) => b.el.getBoundingClientRect());
    const width = Math.max(...rects.map((r) => r.width));
    const height = rects.reduce((sum, r) => sum + r.height, 0) + ROW_GAP * (blocks.length - 1);
    const scale = fitScale(width, height);

    if (blocks.length === 1 || scale >= MIN_COMBINED_SCALE) {
      // Sequential, not Promise.all: each html2canvas pass clones the whole
      // document, and running sixty of those at once stalls the tab.
      const canvases: HTMLCanvasElement[] = [];
      for (const block of blocks) canvases.push(await snapshot(html2canvas, block.el, scale));
      const out = document.createElement('canvas');
      out.width = Math.max(...canvases.map((c) => c.width));
      out.height = canvases.reduce((sum, c) => sum + c.height, 0) + Math.round(ROW_GAP * scale) * (canvases.length - 1);
      const ctx = out.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      let y = 0;
      for (const canvas of canvases) {
        ctx.drawImage(canvas, 0, y);
        y += canvas.height + Math.round(ROW_GAP * scale);
      }
      downloadFile(blocks.length === 1 ? blocks[0].filename : combinedFilename, out.toDataURL('image/png'));
      return;
    }

    for (const [i, block] of blocks.entries()) {
      const r = rects[i];
      const canvas = await snapshot(html2canvas, block.el, Math.max(0.5, fitScale(r.width, r.height)));
      downloadFile(block.filename, canvas.toDataURL('image/png'));
      if (i < blocks.length - 1) await pause(MULTI_FILE_DELAY_MS);
    }
  });
}

// ── SVG ─────────────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

// The presentation properties a recharts chart actually varies. Copying the
// whole computed style would add ~300 declarations per node for nothing.
const INLINE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'opacity', 'visibility',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline',
] as const;
const VAR_ATTRS = ['fill', 'stroke', 'font-family', 'style'] as const;

// Used only where nothing resolves (no stylesheet, as in tests): the faces
// typography.css names, then the platform's own.
const SANS_FALLBACK = "'Hanken Grotesk', 'Source Sans 3', -apple-system, 'Segoe UI', sans-serif";

/**
 * Replace each `var(--name, fallback)` with the custom property's value on the
 * document root. A standalone SVG has no :root to resolve them against, so a
 * font of `var(--font-sans)` would otherwise fall back to Times.
 */
function resolveCssVars(value: string): string {
  if (!value.includes('var(')) return value;
  const root = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null;
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_m, name: string, fallback?: string) =>
    root?.getPropertyValue(name).trim() || fallback?.trim() || '');
}

/** The sans stack as a literal, resolved from FONT_SANS (a CSS variable). */
function sansStack(): string {
  return resolveCssVars(FONT_SANS) || SANS_FALLBACK;
}

function inlineStyles(src: Element, dst: Element): void {
  const computed = getComputedStyle(src);
  const decls: string[] = [];
  for (const prop of INLINE_PROPS) {
    let value = computed.getPropertyValue(prop);
    if (!value) continue;
    if (value.includes('var(')) value = resolveCssVars(value);
    if (prop === 'font-family' && !value) value = sansStack();
    if (value) decls.push(`${prop}:${value}`);
  }
  for (const attr of VAR_ATTRS) {
    const raw = dst.getAttribute(attr);
    if (raw && raw.includes('var(')) {
      const resolved = resolveCssVars(raw) || (attr === 'font-family' ? sansStack() : '');
      if (resolved) dst.setAttribute(attr, resolved); else dst.removeAttribute(attr);
    }
  }
  if (decls.length) {
    const existing = dst.getAttribute('style');
    dst.setAttribute('style', existing ? `${existing};${decls.join(';')}` : decls.join(';'));
  }
  const srcKids = src.children;
  const dstKids = dst.children;
  for (let i = 0; i < srcKids.length && i < dstKids.length; i += 1) inlineStyles(srcKids[i], dstKids[i]);
}

/** The chart's own plot <svg> inside a tile — not an icon in a button. */
function chartSvgIn(tile: HTMLElement): SVGSVGElement | null {
  const candidates = [...tile.querySelectorAll('svg')].filter((svg) => !svg.closest(`[${EXPORT_IGNORE_ATTR}]`));
  const surface = candidates.find((svg) => svg.classList.contains('recharts-surface'));
  if (surface) return surface;
  const area = (svg: SVGSVGElement) => (Number(svg.getAttribute('width')) || 0) * (Number(svg.getAttribute('height')) || 0);
  return candidates.sort((a, b) => area(b) - area(a))[0] ?? null;
}

export interface SvgCaption {
  /** First line, in the mono data face (the gene). */
  title: string;
  /** Lines under the title (population, statistic): one line each, since a chart is too narrow to wrap them. */
  subtitle?: string | readonly string[];
}

const LINE_HEIGHT = 16;
const captionLines = (caption: SvgCaption): readonly string[] =>
  caption.subtitle === undefined ? [] : typeof caption.subtitle === 'string' ? [caption.subtitle] : caption.subtitle;

/**
 * A standalone SVG document of the tile's chart with its caption above it, or
 * null when the tile has no chart drawn yet (the lazy chunk still loading).
 */
export function chartSvgMarkup(tile: HTMLElement, caption: SvgCaption, provenance?: unknown): string | null {
  return chartSvg(tile, caption, provenance)?.markup ?? null;
}

/** The SVG document and its size; `css` is added as a <style> (embedded fonts for rasterising). */
function chartSvg(
  tile: HTMLElement, caption: SvgCaption, provenance?: unknown, css = '',
): { markup: string; width: number; height: number } | null {
  const src = chartSvgIn(tile);
  if (!src) return null;
  const rect = src.getBoundingClientRect();
  const width = Number(src.getAttribute('width')) || rect.width || 300;
  const height = Number(src.getAttribute('height')) || rect.height || 220;
  const subtitles = captionLines(caption);
  const captionHeight = 8 + LINE_HEIGHT * (1 + subtitles.length);

  const clone = src.cloneNode(true) as SVGSVGElement;
  inlineStyles(src, clone);
  clone.setAttribute('x', '0');
  clone.setAttribute('y', String(captionHeight));
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.removeAttribute('style');

  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('xmlns', SVG_NS);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height + captionHeight));
  root.setAttribute('viewBox', `0 0 ${width} ${height + captionHeight}`);
  if (provenance !== undefined) {
    const meta = document.createElementNS(SVG_NS, 'metadata');
    meta.textContent = JSON.stringify(provenance);
    root.appendChild(meta);
  }
  if (css) {
    const style = document.createElementNS(SVG_NS, 'style');
    style.textContent = css;
    root.appendChild(style);
  }
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#ffffff');
  root.appendChild(bg);

  const text = (content: string, y: number, attrs: Record<string, string>) => {
    const el = document.createElementNS(SVG_NS, 'text');
    el.setAttribute('x', '8');
    el.setAttribute('y', String(y));
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.textContent = content;
    root.appendChild(el);
  };
  // Fixed ink on the fixed white background: an exported figure must not
  // inherit a dark theme's light text.
  text(caption.title, 16, { 'font-family': FONT_MONO, 'font-size': '12', 'font-weight': '600', fill: '#1f1f1f' });
  subtitles.forEach((line, i) => {
    text(line, 16 + LINE_HEIGHT * (i + 1), { 'font-family': sansStack(), 'font-size': '11', fill: NEUTRAL_TEXT_COLOR });
  });
  root.appendChild(clone);

  return {
    markup: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(root)}`,
    width,
    height: height + captionHeight,
  };
}

// ── PNG from the chart's own SVG ────────────────────────────────────────────
//
// A per-chart PNG is the chart's SVG drawn onto a canvas: milliseconds per
// chart, where an html2canvas snapshot re-clones the whole page each time (a
// 60-population grid took over a minute for its charts one by one). An SVG
// drawn as an image cannot fetch anything, so the web fonts the page has
// actually loaded are inlined as data URLs; without them the PNG would fall
// back to the system sans and differ from the screen and the stitched grid.

const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, '');

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

let fontCss: Promise<string> | null = null;

/** @font-face rules for the faces this page has loaded, their files inlined. Cached. */
function embeddedFontCss(): Promise<string> {
  fontCss ??= (async () => {
    const loaded = typeof document.fonts?.forEach === 'function'
      ? [...document.fonts].filter((f) => f.status === 'loaded') : [];
    const families = new Set(loaded.map((f) => unquote(f.family)));
    const ranges = new Set(loaded.map((f) => `${unquote(f.family)}|${f.unicodeRange}`));
    const rules: Array<{ rule: CSSFontFaceRule; base: string }> = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let cssRules: CSSRuleList;
      try { cssRules = sheet.cssRules; } catch { continue; } // a cross-origin sheet
      for (const rule of Array.from(cssRules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        if (!families.has(unquote(rule.style.getPropertyValue('font-family')))) continue;
        rules.push({ rule, base: sheet.href ?? document.baseURI });
      }
    }
    // Only the subsets actually in use (the Latin files); every subset of a
    // family only when the browser serialises unicode-range differently.
    const inUse = rules.filter(({ rule }) =>
      ranges.has(`${unquote(rule.style.getPropertyValue('font-family'))}|${rule.style.getPropertyValue('unicode-range')}`));
    const out: string[] = [];
    for (const { rule, base } of inUse.length ? inUse : rules) {
      const match = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue('src'));
      if (!match) continue;
      try {
        const res = await fetch(new URL(match[1], base).href);
        if (!res.ok) continue;
        const data = await blobDataUrl(await res.blob());
        const s = rule.style;
        out.push(`@font-face{font-family:${s.getPropertyValue('font-family')};`
          + `font-weight:${s.getPropertyValue('font-weight') || 'normal'};font-style:${s.getPropertyValue('font-style') || 'normal'};`
          + `src:url(${data}) format("woff2");${s.getPropertyValue('unicode-range') ? `unicode-range:${s.getPropertyValue('unicode-range')};` : ''}}`);
      } catch { /* a font that cannot be read falls back to the system face */ }
    }
    return out.join('\n');
  })();
  return fontCss;
}

/** One tile's chart as PNG bytes at 2×, or null when the chart has not drawn yet. */
async function chartPngBytes(tile: HTMLElement, caption: SvgCaption): Promise<Uint8Array<ArrayBuffer> | null> {
  const svg = chartSvg(tile, caption, undefined, await embeddedFontCss());
  if (!svg) return null;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.markup)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(svg.width * PREFERRED_SCALE);
  canvas.height = Math.round(svg.height * PREFERRED_SCALE);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvasBytes(canvas);
}

/** Save one tile's chart as PNG. Returns false when there is no chart to save. */
export async function saveChartPng(tile: HTMLElement, filename: string, caption: SvgCaption): Promise<boolean> {
  const bytes = await chartPngBytes(tile, caption);
  if (!bytes) return false;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  downloadFile(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/** Save one tile's chart as SVG. Returns false when there is no chart to save. */
export function saveChartSvg(tile: HTMLElement, filename: string, caption: SvgCaption, provenance?: unknown): boolean {
  const markup = chartSvgMarkup(tile, caption, provenance);
  if (!markup) return false;
  downloadFile(filename, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
  return true;
}

// ── One chart tile, as a file ───────────────────────────────────────────────

/**
 * How one chart tile names, captions and records itself when saved — shared
 * by the tile's own download menu and the "individual charts" ZIP, so a chart
 * is the same file whichever way it was saved.
 */
export function chartTileExport({ pd, gene, label, pValue, chartScale }: {
  pd: PopData; gene: string; label: string; pValue: number | null | undefined; chartScale: ChartScale;
}): { filename: (ext: string) => string; caption: SvgCaption; provenance: () => unknown } {
  const subject = trackSubject(pd);
  return {
    filename: (ext) => exportName(subject, [gene, 'bar_chart'], ext),
    caption: { title: gene, subtitle: [label, `mean ± SEM · P = ${fmtP(pValue)}`] },
    // A getter: tiles describe themselves on every render, but the snapshot
    // reads the QC ledger, which loads only when a file is saved
    // (withExportEvidence).
    provenance: () => exportProvenance('compare', subject, { figure: 'bar_chart', gene, chartScale }),
  };
}

export interface ChartTileFile {
  el: HTMLElement;
  /** The folder inside the archive (the gene's row). */
  folder: string;
  filename: (ext: string) => string;
  caption: SvgCaption;
  /** The tile's provenance snapshot; call inside withExportEvidence. */
  provenance: () => unknown;
}

function canvasBytes(canvas: HTMLCanvasElement): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('The chart could not be encoded as PNG.')); return; }
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
    }, 'image/png');
  });
}

/**
 * Save every chart tile as its own file — PNG snapshots or SVG vectors — in
 * one ZIP, a folder per gene, with the export's provenance as metadata.json.
 * Tiles whose chart has not drawn yet are skipped for SVG (there is nothing
 * to clone); a PNG snapshot captures whatever is on screen.
 */
export async function saveChartTilesZip(
  tiles: readonly ChartTileFile[],
  format: 'png' | 'svg',
  zipName: string,
  provenance: unknown,
): Promise<void> {
  if (!tiles.length) return;
  const entries: ZipEntry[] = [];
  const used = new Set<string>();
  const add = (folder: string, name: string, data: Uint8Array) => {
    // Two populations can share a track id across datasets; never let one
    // file silently replace another inside the archive.
    let path = `${folder}/${name}`;
    for (let i = 2; used.has(path); i++) path = `${folder}/${name.replace(/(\.[^.]+)$/, `_${i}$1`)}`;
    used.add(path);
    entries.push({ name: path, data });
  };

  if (format === 'svg') {
    const encoder = new TextEncoder();
    for (const tile of tiles) {
      const markup = chartSvgMarkup(tile.el, tile.caption, tile.provenance());
      if (markup) add(tile.folder, tile.filename('svg'), encoder.encode(markup));
    }
  } else {
    for (const tile of tiles) {
      const bytes = await chartPngBytes(tile.el, tile.caption);
      if (bytes) add(tile.folder, tile.filename('png'), bytes);
    }
  }
  if (!entries.length) {
    window.alert('The charts are still drawing. Try again in a moment.');
    return;
  }
  entries.push({ name: 'metadata.json', data: new TextEncoder().encode(`${JSON.stringify(provenance, null, 2)}\n`) });

  const url = URL.createObjectURL(new Blob([zipStore(entries)], { type: 'application/zip' }));
  downloadFile(zipName, url);
  // The click has handed the URL to the download; free it once that has begun.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
