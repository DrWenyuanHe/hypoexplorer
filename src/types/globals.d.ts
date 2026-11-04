// Ambient declarations for the app's untyped runtime boundaries:
//   - the Vite `define` build-time constant (__APP_VERSION__),
//   - the bootstrap callback (window.__showApp),
//   - the dataset/track/QC data globals injected by <script> tags,
//   - the tracker catalog global.
//
// Dataset/track globals are injected under dataset-namespaced keys computed at
// runtime (e.g. HX_MACAQUE_SNRNA_E9). The loaders read them via a dynamic
// `window[key]` (cast at the call site); the named members below cover the
// statically-referenced eager globals and the test fixtures.

import type { DatasetMeta, QcGlobal, RawTrack, TrackerCatalog } from './index';

declare global {
  /** Injected by Vite `define` in vite.config (the app version string). */
  const __APP_VERSION__: string;

  /** Query corpus accompanying this app build; stale remote browse counts are unavailable. */
  const __QUERY_CATALOG_BUILD_ID__: string;
  /** Complete canonical catalog expected by this app, including sample metadata. */
  const __QUERY_CATALOG_CONTENT__: string;

  /** Immutable lossless expression corpus paired with this app build. */
  const __EXPRESSION_INDEX_BUILD_ID__: string;

  /**
   * Injected by Vite `define`: UNCOMPRESSED byte size of every data bundle,
   * keyed by request path ('/datasets/<id>/<file>'). Measured from public/ at
   * build time because the wire cannot answer it — bundles are served
   * compressed, so Content-Length counts different bytes than a streaming
   * reader yields. A missing key means "size unknown", never "zero bytes".
   */
  const __BUNDLE_SIZES__: Record<string, number>;

  interface Window {
    /** Set by the inline bootstrap script in index.html; called from main.tsx. */
    __showApp?: () => void;

    /** Eager macaque globals (index.html <script> tags) + test fixtures. */
    HX_MACAQUE_SNRNA_META?: DatasetMeta;
    HX_MACAQUE_SNRNA_E9?: RawTrack;
    HX_MACAQUE_SNRNA_QC?: QcGlobal;

    /** Tracker catalog (public/tracker/catalog.js). */
    HX_TRACKER_CATALOG?: TrackerCatalog;
  }
}
