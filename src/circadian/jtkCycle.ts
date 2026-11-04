// JTK_CYCLE numerical procedure: Hughes, Hogenesch & Kornacker (2010),
// doi:10.1177/0748730410379711; validated against MetaCycle 1.2.1 JTKv3.1p.R.
// This independent implementation evaluates the grouped permutation null with
// exact BigInt q-multinomial coefficients, rather than the reference R code's
// Harding/Shewchuk algorithm. No third-party source is imported into the app.
import type { RhythmOptions, RhythmResult, RhythmSeries } from './rhythmicity';

// biome-ignore lint/suspicious/noApproximativeNumericConstant: Canonical JTK requires rounded pi to break reference ties identically to MetaCycle.
const PI_HAT = 3.1416;
const MAX_OBSERVATIONS = 160;
const MAX_TIMEPOINTS = 160;
const MAX_CACHED_PLANS = 16;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_TEMPLATE_WORK = 500_000;

export interface JtkSupport {
  supported: boolean;
  reason: string | null;
  interval: number | null;
  /** Requested periods that are integer sampling intervals and fit the series. */
  periods: number[];
}

/** Explicitly expose JTK's regular-sampling and integer-period constraints. */
export function jtkSupport(times: number[], requested: number[]): JtkSupport {
  const unique = [...new Set(times.filter(Number.isFinite))].sort((a, b) => a - b);
  const fail = (reason: string): JtkSupport => ({ supported: false, reason, interval: null, periods: [] });
  if (times.length < 4) return fail('JTK_CYCLE needs at least four observations.');
  if (times.length > MAX_OBSERVATIONS) return fail(`JTK_CYCLE supports at most ${MAX_OBSERVATIONS} observations per series.`);
  if (unique.length < 3) return fail('JTK_CYCLE needs at least three sampling times.');
  const interval = Math.min(...unique.slice(1).map((t, i) => t - unique[i]));
  const origin = unique[0];
  const slots = unique.map((t) => (t - origin) / interval);
  if (slots.some((s) => Math.abs(s - Math.round(s)) > 1e-7)) {
    return fail('JTK_CYCLE requires a regular sampling grid; use COSINOR or Lomb–Scargle for irregular times.');
  }
  const nSlots = Math.round(slots.at(-1) ?? 0) + 1;
  if (nSlots > MAX_TIMEPOINTS) return fail(`JTK_CYCLE supports at most ${MAX_TIMEPOINTS} scheduled sampling times.`);
  const periods = [...new Set(requested)].filter((p) => {
    const units = p / interval;
    return Number.isFinite(p) && units >= 2 && units <= nSlots + 1e-7
      && Math.abs(units - Math.round(units)) < 1e-7;
  }).sort((a, b) => a - b);
  if (!periods.length) {
    return { supported: false, reason: `No requested JTK period is an integer multiple of ${interval} h within the sampled duration.`, interval, periods };
  }
  const templates = periods.reduce((sum, p) => sum + Math.round(p / interval), 0);
  const n = times.length;
  const estimatedBytes = templates * (n * (n - 1) / 2 + 16 * n) + 4 * n * n;
  // Bound both stored reference arrays and the pair/Walsh-average work before
  // allocation. Every accepted plan fits the bounded cache, avoiding per-gene
  // rebuilds of an oversized template family during a whole-transcriptome scan.
  if (estimatedBytes > MAX_CACHE_BYTES || templates * n * n > MAX_TEMPLATE_WORK) {
    return { supported: false, reason: 'The requested JTK template family exceeds the browser work or memory limit; reduce the period family or use COSINOR or Lomb–Scargle.', interval, periods: [] };
  }
  return { supported: true, reason: null, interval, periods };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** Hodges–Lehmann location: median of all Walsh averages, including the diagonal. */
function hodgesLehmann(values: number[]): number {
  const averages: number[] = [];
  for (let i = 0; i < values.length; i++) {
    for (let j = i; j < values.length; j++) averages.push((values[i] + values[j]) / 2);
  }
  return median(averages);
}

interface Template {
  periodSlots: number;
  lagIndex: number;
  pairs: Int8Array;
  /** Original observation indices in full cycles, with cosine signs. */
  full: Array<{ index: number; sign: number }>;
}
interface Plan {
  templates: Template[];
  maximumS: number;
  /** Cumulative exact grouped inversion counts, normalized to probabilities. */
  cumulative: Float64Array;
  bytes: number;
}
const plans = new Map<string, Plan>();
let cacheBytes = 0;

/**
 * Exact multiset-inversion distribution, product of Gaussian binomials:
 *   [n]!_q / product([replicate_count]!_q).
 * Integer polynomial multiply/divide recurrences avoid cancellation and match
 * the canonical grouped Jonckheere null, including unequal replication.
 */
function permutationNull(counts: number[], maximumS: number): Float64Array {
  const coefficients = Array<bigint>(maximumS + 1).fill(0n);
  coefficients[0] = 1n;
  let previous = 0;
  for (const count of counts) {
    if (!count) continue;
    for (let s = 1; s <= count; s++) {
      const power = previous + s;
      for (let i = maximumS; i >= power; i--) coefficients[i] -= coefficients[i - power];
      for (let i = s; i <= maximumS; i++) coefficients[i] += coefficients[i - s];
    }
    previous += count;
  }
  let total = 0n;
  for (const v of coefficients) total += v;
  const denominator = Number(total);
  let running = 0n;
  return Float64Array.from(coefficients, (v) => {
    running += v;
    return Number(running) / denominator;
  });
}

function makePlan(slots: number[], periodSlots: number[]): Plan {
  const key = `${slots.join(',')}|${periodSlots.join(',')}`;
  const cached = plans.get(key);
  if (cached) {
    plans.delete(key); plans.set(key, cached); // Bounded least-recently-used cache.
    return cached;
  }
  const n = slots.length;
  const counts = Array<number>((slots.at(-1) ?? 0) + 1).fill(0);
  for (const s of slots) counts[s]++;
  const maximumS = (n * n - counts.reduce((s, c) => s + c * c, 0)) / 2;
  const cumulative = permutationNull(counts, maximumS);
  const templates: Template[] = [];
  for (const period of periodSlots) {
    const omega = 2 * PI_HAT / period;
    const fullEnd = Math.floor(counts.length / period) * period;
    for (let lagIndex = 0; lagIndex < period; lagIndex++) {
      const reference = slots.map((t) => Math.cos(t * omega + lagIndex * omega / 2));
      const pairs = new Int8Array(n * (n - 1) / 2);
      let pair = 0;
      for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) pairs[pair++] = Math.sign(reference[i] - reference[j]);
      }
      const full = slots.flatMap((t, index) => t < fullEnd ? [{ index, sign: Math.sign(reference[index]) }] : []);
      templates.push({ periodSlots: period, lagIndex, pairs, full });
    }
  }
  const bytes = cumulative.byteLength + templates.reduce((sum, t) => sum + t.pairs.byteLength + t.full.length * 16, 0);
  const plan = { templates, maximumS, cumulative, bytes };
  if (bytes <= MAX_CACHE_BYTES) {
    while (plans.size >= MAX_CACHED_PLANS || cacheBytes + bytes > MAX_CACHE_BYTES) {
      const oldest = plans.keys().next().value as string;
      cacheBytes -= (plans.get(oldest) as Plan).bytes;
      plans.delete(oldest);
    }
    plans.set(key, plan);
    cacheBytes += bytes;
  }
  return plan;
}

export function canonicalJtk(series: RhythmSeries, options: RhythmOptions): RhythmResult | null {
  const observations = series.times.map((time, index) => ({ time, value: series.values[index] }))
    .filter((o) => Number.isFinite(o.time) && Number.isFinite(o.value))
    .sort((a, b) => a.time - b.time);
  if (observations.length < 4) return null;
  const times = observations.map((o) => o.time);
  const support = jtkSupport(times, options.periods);
  if (!support.supported || support.interval == null) return null;
  const interval = support.interval;
  const origin = times[0];
  const slots = times.map((t) => Math.round((t - origin) / interval));
  const values = observations.map((o) => o.value);
  const plan = makePlan(slots, support.periods.map((p) => Math.round(p / interval)));
  const pairs = new Int8Array(values.length * (values.length - 1) / 2);
  let pair = 0;
  for (let i = 0; i < values.length - 1; i++) {
    for (let j = i + 1; j < values.length; j++) pairs[pair++] = Math.sign(values[i] - values[j]);
  }
  const candidates = plan.templates.map((template) => {
    let S = 0;
    for (let i = 0; i < pairs.length; i++) S += pairs[i] * template.pairs[i];
    const cutoff = (plan.maximumS - Math.abs(S)) / 2;
    const lo = Math.floor(cutoff), hi = Math.ceil(cutoff);
    const tail = (plan.cumulative[lo] + plan.cumulative[hi]) / 2;
    const p = S === 0 ? 1 : Math.min(1, 2 * tail * plan.templates.length);
    return { template, S, p };
  });
  const p = Math.min(...candidates.map((c) => c.p));
  let amplitude = 0, period = 0, acrophase = 0, stat = 0;
  const centres = new Map<number, number>();
  for (const candidate of candidates) {
    if (candidate.p !== p) continue;
    const { template, S } = candidate;
    const s = Math.sign(S) || 1;
    let centre = centres.get(template.periodSlots);
    if (centre == null) {
      centre = hodgesLehmann(template.full.map((o) => values[o.index]));
      centres.set(template.periodSlots, centre);
    }
    const amp = hodgesLehmann(template.full.map((o) => s * (values[o.index] - centre) * Math.SQRT2 * o.sign));
    if (amp > amplitude) {
      amplitude = amp;
      period = template.periodSlots * interval;
      const lag = (template.periodSlots + (1 - s) * template.periodSlots / 4 - template.lagIndex / 2) % template.periodSlots;
      acrophase = ((origin + lag * interval) % period + period) % period;
      stat = Math.abs(S / plan.maximumS);
    }
  }
  return { method: 'jtk', p, period, acrophase, amplitude,
    mesor: hodgesLehmann(values), stat, n: values.length, nTimepoints: new Set(times).size,
    periodsTested: support.periods };
}

/** Bounded cache metrics used in the validation performance benchmark. */
export function jtkCacheSize(): number { return plans.size; }
export function jtkCacheBytes(): number { return cacheBytes; }
