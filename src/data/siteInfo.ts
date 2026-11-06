/** Public identity shared by the application and its crawlable study pages. */
export const SITE_URL = 'https://hypoexplorer.com';
export const SITE_NAME = 'HypoExplorer';
export const AUTHOR_NAME = 'Wenyuan He';
export const AUTHOR_EMAIL = 'wenyuan.he@mail.utoronto.ca';
/** @public Used by the crawlable-page builders in scripts/lib/seo*.mts. */
export const AUTHOR_BIO = 'Wenyuan He created HypoExplorer and holds a PhD from the University of Toronto.';
/**
 * People credited alongside the author, on the About page and in CITATION.cff.
 *
 * @public Used by scripts/lib/seoPages.mts and seoGuides.mts.
 */
export const CONTRIBUTOR_NAMES: readonly string[] = ['Helene Li'];
export const BETA_NOTICE = 'HypoExplorer is in beta testing.';
/**
 * Zenodo DOI of the full-dataset agent export (`pnpm run build:agent-export`),
 * e.g. '10.5281/zenodo.1234567'. Null until the archive is deposited; the
 * methods page then says the download is not yet published. See
 * docs/AGENT_EXPORT.md.
 *
 * @public Used by scripts/lib/seoGuides.mts.
 */
export const DATA_EXPORT_DOI: string | null = null;

export function studyPageHref(datasetId: string): string {
  return `/studies/${encodeURIComponent(datasetId)}/`;
}
