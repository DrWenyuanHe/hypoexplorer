import { reviewedTrackLabel } from './reviewedTrackLabels';

// Keep this shared build/browser helper independent of the browser loaders.
interface CatalogContentSource {
  tracks: Array<{ ds: string; trackId: string; label: string }>;
  datasets?: Array<{ ds: string; defaultTrack: string; trackLabel: string }>;
}

function plainJson(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value === null) throw new Error('Catalog contains a non-JSON value');
  if ('toJSON' in value) throw new Error('Catalog contains a custom JSON serializer');
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) {
      throw new Error('Catalog contains a non-JSON array');
    }
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor || !('value' in descriptor)) throw new Error('Catalog contains a sparse array or accessor');
      result.push(plainJson(descriptor.value));
    }
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length) {
    throw new Error('Catalog contains a non-JSON object');
  }
  return Object.fromEntries(Object.keys(value).sort().map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) throw new Error('Catalog contains an accessor');
    return [key, plainJson(descriptor.value)];
  }));
}

/** Validate a JSONP result before any display overlay can read its fields. */
export function assertPlainCatalogValue(value: unknown): void {
  plainJson(value);
}

/** Bind every observed catalog field, including metadata absent from buildId.
 * The sole reviewed label overlay is identical at build time and in the browser.
 * Sorted object keys avoid treating JSON property order as a data difference;
 * array order and every sample identifier, count and other value remain exact.
 */
export function queryCatalogContent(manifest: CatalogContentSource): string {
  // JSONP may contain custom serializers or accessors. Validate before reading
  // fields or using JSON.stringify, so claimed values cannot replace real ones.
  const source = plainJson(manifest) as CatalogContentSource;
  const displayed = {
    ...source,
    tracks: source.tracks.map((track) => ({
      ...track, label: reviewedTrackLabel(track.ds, track.trackId, track.label),
    })),
    datasets: source.datasets?.map((summary) => ({
      ...summary, trackLabel: reviewedTrackLabel(summary.ds, summary.defaultTrack, summary.trackLabel),
    })),
  };
  return JSON.stringify(plainJson(displayed));
}
