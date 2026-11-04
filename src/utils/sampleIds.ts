// Per-group replicate sample-id helpers, shared by the QC tab's Sizes section
// (which lists the kept/dropped ids per arm) and the explorer hero pills (which
// surface the active track's ids in a tooltip).
//
// The track bundle carries both the full per-group membership
// (TrackMeta.groupSamples) and the QC-retained subset (TrackQC.samplesKept). A
// sample present in a group but absent from samplesKept was dropped by QC — the
// distinction the macaque 2v3 case turns on, and the reason aggregate
// nNormal/nObese counts alone don't tell the whole story.

import { groupSamplesOf } from '../data/rawTrack';
import type { RawTrack } from '../types';

interface GroupSamplePartition {
  /** Samples retained after QC. */
  kept: string[];
  /** Samples assigned to the group but dropped by QC (absent from samplesKept). */
  dropped: string[];
}

// Shared donor/sample-set prefix derived from the data (the common leading
// underscore-delimited segments), so display ids can drop a redundant donor stem
// (e.g. "HCA_Macaque001_") without a per-dataset hardcode. The last segment is
// never consumed, so the sample id itself always survives. For the macaque set
// this strips exactly "HCA_Macaque001_"; a heterogeneous set (no shared stem)
// keeps the full ids.
export function commonSamplePrefix(sampleKeys: string[]): string {
  if (sampleKeys.length === 0) return '';
  const split = sampleKeys.map((k) => String(k).split('_'));
  const first = split[0];
  let common = 0;
  for (let i = 0; i < first.length - 1; i++) {
    if (split.every((s) => s[i] === first[i])) common++;
    else break;
  }
  return common > 0 ? `${first.slice(0, common).join('_')}_` : '';
}

// Strip the shared prefix for compact display; falls back to the raw id.
export function stripSamplePrefix(id: string, prefix: string): string {
  return prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

// The per-group sample membership carried by a track bundle. The legacy-shape
// rule (meta.groupSamples, else the normalSamples/obeseSamples pair) is the
// raw-track reader's — this used to hand-spell it under a comment promising it
// "mirrors buildPopData", a mirror nothing enforced. A track that declares
// neither reads as {} HERE (this surface enumerates the record; buildPopData,
// whose consumers index it, substitutes its own empty arms instead).
export function trackGroupSamples(track: RawTrack | null | undefined): Record<string, string[]> {
  return groupSamplesOf(track) ?? {};
}

// The QC-retained sample set for a track (carried on both qc and meta).
export function trackSamplesKept(track: RawTrack | null | undefined): string[] | undefined {
  return track?.qc?.samplesKept ?? track?.meta?.samplesKept;
}

// Partition one group's samples into kept vs dropped using the QC-retained set.
// When samplesKept is absent (not every bundle records it), every sample reads
// as kept — we never claim a drop we cannot see.
export function partitionGroupSamples(
  groupSamples: Record<string, string[]> | undefined,
  samplesKept: string[] | undefined,
  groupKey: string,
): GroupSamplePartition {
  const all = groupSamples?.[groupKey] ?? [];
  if (!samplesKept) return { kept: [...all], dropped: [] };
  const keptSet = new Set(samplesKept);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const id of all) (keptSet.has(id) ? kept : dropped).push(id);
  return { kept, dropped };
}

// A one-line tooltip listing one group's retained (and any dropped) sample ids,
// for the explorer hero pills. Returns undefined when the track has no ids for
// the group yet (e.g. the bundle hasn't resolved) so the pill simply has no
// tooltip rather than an empty one.
export function groupSampleTooltip(
  groupSamples: Record<string, string[]> | undefined,
  samplesKept: string[] | undefined,
  group: { key: string; label: string },
): string | undefined {
  const { kept, dropped } = partitionGroupSamples(groupSamples, samplesKept, group.key);
  if (kept.length === 0 && dropped.length === 0) return undefined;
  const prefix = commonSamplePrefix([...kept, ...dropped]);
  const fmt = (ids: string[]) => ids.map((id) => stripSamplePrefix(id, prefix)).join(', ');
  const noun = kept.length === 1 ? 'sample' : 'samples';
  let out = `${group.label} — ${kept.length} ${noun}: ${fmt(kept)}`;
  if (dropped.length > 0) out += ` · dropped by QC: ${fmt(dropped)}`;
  return out;
}
