// How specific a pathway's recurrence is to one gene's conditions.
//
// The condition-pathways card follows a gene to the tracks where it changes and
// lists the pathways enriched there. Counting how many of those tracks share a
// pathway puts housekeeping sets first: KEGG ribosome is enriched in 104 of the
// 223 tracks that test it, so it recurs among almost any gene's conditions. The
// question the card asks is the narrower one, "what is enriched HERE more often
// than everywhere?", so each pathway's recurrence is set against its base rate
// across every pathway-capable track.
//
// THE MODEL. The corpus is the M tracks where the pathway was tested; it is
// significant in K of them. The gene's n read conditions are a draw from those
// tracks, and the pathway is significant in k of them. If the gene's conditions
// were an arbitrary set of tracks, k would follow a hypergeometric distribution,
// so the upper tail P(X >= k) says how surprising the recurrence is given the
// base rate. A pathway significant in every track scores 1 however often it
// recurs; one confined to the gene's conditions scores near 0.
//
// A RANKING AID, NOT A TEST. Tracks of one study share animals and processing,
// and the gene's conditions were chosen because the gene changes there, so the
// draws are not independent and the tail is not a calibrated p-value. The card
// says so and never labels it significant.

/** A pathway's significance across the corpus: K significant of M tested tracks. */
export interface CorpusRate {
  significant: number;
  tested: number;
}

export interface Specificity {
  /** Followed conditions counted as draws: min(read conditions, tracks tested). */
  draws: number;
  /** Hits expected among those draws at the corpus base rate. */
  expected: number;
  /** Observed hits over expected; Infinity never occurs because K >= k >= 1. */
  enrichment: number;
  /** Hypergeometric upper tail P(X >= hits). Lower is more specific. */
  tail: number;
}

const logFactorials: number[] = [0];

function logFactorial(n: number): number {
  for (let i = logFactorials.length; i <= n; i++) logFactorials[i] = logFactorials[i - 1] + Math.log(i);
  return logFactorials[n];
}

function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/**
 * P(X >= k) for X ~ Hypergeometric(population M, successes K, draws n).
 * Exact summation over log-binomials; M is a track count (a few hundred), so
 * the sum has at most a few hundred terms.
 */
export function hypergeometricUpperTail(k: number, K: number, M: number, n: number): number {
  const lo = Math.max(k, 0, n - (M - K));
  const hi = Math.min(n, K);
  if (lo > hi) return 0;
  const denom = logChoose(M, n);
  let tail = 0;
  for (let x = lo; x <= hi; x++) tail += Math.exp(logChoose(K, x) + logChoose(M - K, n - x) - denom);
  return Math.min(1, tail);
}

/**
 * The specificity of `hits` recurrences among `read` followed conditions,
 * given the pathway's corpus rate. Null when the rate is missing or
 * inconsistent with the hits (a file from another build would be refused
 * before this, so that is a defect, not a state to rank).
 */
export function pathwaySpecificity(hits: number, read: number, corpus: CorpusRate | null): Specificity | null {
  if (!corpus) return null;
  const { significant: K, tested: M } = corpus;
  if (!(Number.isInteger(K) && Number.isInteger(M) && K >= 1 && M >= K && hits >= 1 && hits <= K)) return null;
  // A followed condition that did not test the pathway cannot be a hit. The
  // rows do not say which ones tested it, so cap the draws at the corpus count;
  // with every database run on every track, M is within a few of the track
  // total for nearly every pathway and the cap rarely binds.
  const draws = Math.min(read, M);
  if (hits > draws) return null;
  const expected = (draws * K) / M;
  return { draws, expected, enrichment: hits / expected, tail: hypergeometricUpperTail(hits, K, M, draws) };
}
