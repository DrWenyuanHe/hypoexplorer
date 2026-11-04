// Standard D3-style "nice ticks" — generates evenly-spaced tick values that
// include domain endpoints when they round cleanly.
export function niceTicks(min: number, max: number, target: number): number[] {
  const span = max - min;
  if (span <= 0 || !Number.isFinite(span)) return [min];
  const rough = span / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / pow;
  const step = ((norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * pow) / 2;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + step * 1e-6; v += step) {
    ticks.push(+v.toFixed(10));
  }
  return ticks;
}

// ─── Category-axis labels ─────────────────────────────────────────────────────
// Group labels come from each study's own design and some are long ("Four-week
// corticosterone"); on one line they run into the neighbouring bar's label.

/** Wrapped lines past this are cut with an ellipsis. */
export const MAX_LABEL_LINES = 3;

let measureCtx: CanvasRenderingContext2D | null | undefined;

// Rendered width of `text` in the app's sans face. Canvas measurement where
// available (the face is a CSS variable, which canvas cannot read, so it is
// resolved first); jsdom and other contexts without 2D canvas fall back to an
// average glyph width.
function textWidth(text: string, fontSize: number): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  }
  if (measureCtx) {
    const face = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif';
    measureCtx.font = `${fontSize}px ${face}`;
    return measureCtx.measureText(text).width;
  }
  return text.length * fontSize * 0.56;
}

/**
 * Greedy word wrap of `text` into lines no wider than `maxWidth` px. A single
 * word wider than the slot keeps its own line rather than being broken. More
 * than MAX_LABEL_LINES lines are cut, the last one ending in an ellipsis.
 */
export function wrapLabel(text: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last != null && textWidth(`${last} ${word}`, fontSize) <= maxWidth) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  if (lines.length <= MAX_LABEL_LINES) return lines.length ? lines : [''];
  const kept = lines.slice(0, MAX_LABEL_LINES);
  let tail = kept[MAX_LABEL_LINES - 1];
  while (tail.includes(' ') && textWidth(`${tail}…`, fontSize) > maxWidth) tail = tail.slice(0, tail.lastIndexOf(' '));
  kept[MAX_LABEL_LINES - 1] = `${tail}…`;
  return kept;
}
