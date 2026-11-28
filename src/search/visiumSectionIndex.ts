// The curated HYPOMAP Visium section images: precomputed by
// scripts/render_visium_sections.R, pinned in data/expression/visium/ and
// shipped by the Visium builder under /expression/visium/sections/. The gene
// page offers them for the genes the index lists, each section beside its map
// of the authors' regional clusters.

import { EXTERNAL_REFERENCE_ROOTS } from '../expression-survey/externalReferenceFormat';
import { sourceJson } from '../expression-survey/sourceJson';

export interface VisiumSectionFrame { section: number; label: string; width: number; height: number; spots: number }
export interface VisiumSectionImage { section: number; file: string; bytes: number; sha256: string }
export interface VisiumRegionLabel { section: number; region: string; x: number; y: number }
export interface VisiumSectionIndex {
  schemaVersion: 2;
  source: string;
  title: string;
  value: string;
  scale: { min: number; max: number; stops: string[]; above: string };
  order: string;
  sections: VisiumSectionFrame[];
  regions: {
    images: VisiumSectionImage[];
    colours: Array<{ key: string; name: string | null; colour: string }>;
    labels: VisiumRegionLabel[];
  };
  genes: Array<{ symbol: string; images: VisiumSectionImage[] }>;
  notes: string[];
  credit: string;
  license: string;
  licenseUrl: string;
}

const ROOT = `${EXTERNAL_REFERENCE_ROOTS.visium}/sections`;
const FILE = /^(?:regions|[A-Z0-9]+)\/section-\d+\.webp$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;

function invalid(): never {
  throw new Error('Visium section index is inconsistent.');
}

function checkSet(set: string, images: VisiumSectionImage[], sections: number[]): void {
  if (!Array.isArray(images) || images.length !== sections.length) invalid();
  images.forEach((image, at) => {
    if (image.section !== sections[at] || image.file !== `${set}/section-${image.section}.webp` || !FILE.test(image.file)) invalid();
  });
}

/** Checks the index's shape, so a file name from it can only name an image under the sections root, and a colour only a colour. */
export function validateSectionIndex(index: VisiumSectionIndex): VisiumSectionIndex {
  if (index?.schemaVersion !== 2 || !Array.isArray(index.sections) || !Array.isArray(index.genes) || !index.sections.length) invalid();
  if (index.sections.some((frame, at) => frame.section !== at + 1 || !(frame.width > 0) || !(frame.height > 0))) invalid();
  const sections = index.sections.map((frame) => frame.section);
  if (!Array.isArray(index.scale?.stops) || index.scale.stops.length < 2 || !index.scale.stops.every((stop) => HEX.test(stop))) invalid();
  checkSet('regions', index.regions?.images, sections);
  if (!index.regions.colours.every((entry) => HEX.test(entry.colour))) invalid();
  const keys = new Set(index.regions.colours.map((entry) => entry.key));
  for (const label of index.regions.labels) {
    const frame = index.sections[label.section - 1];
    if (!frame || !keys.has(label.region) || !(label.x >= 1 && label.x <= frame.width && label.y >= 1 && label.y <= frame.height)) invalid();
  }
  for (const gene of index.genes) {
    if (!/^[A-Z0-9]+$/.test(gene.symbol)) invalid();
    checkSet(gene.symbol, gene.images, sections);
  }
  return index;
}

/** The section index, or null when this build ships none. */
export async function loadSectionIndex(): Promise<VisiumSectionIndex | null> {
  try {
    return validateSectionIndex(await sourceJson<VisiumSectionIndex>('visium', `${ROOT}/index.json`));
  } catch {
    return null;
  }
}

/** One image's URL, tied to the app release like the rest of the atlas. */
export function sectionImageUrl(image: VisiumSectionImage): string {
  if (!FILE.test(image.file)) invalid();
  return `${ROOT}/${image.file}?v=${encodeURIComponent(__APP_VERSION__)}`;
}

/** Light text on a dark region colour, dark text on a light one. */
export function labelInk(colour: string): 'light' | 'dark' {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(colour.slice(at, at + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45 ? 'light' : 'dark';
}
