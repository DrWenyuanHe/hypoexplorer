/** The source snapshot and immutable data indexes compiled into this app. */
export interface ReleaseIdentity {
  schemaVersion: 1;
  releaseId: string;
  appVersion: string;
  codeCommit: string | null;
  sourceSha256: string;
  sourceDirty: boolean;
  dataBuildId: string | null;
  dataBuildSha256: string | null;
  expressionBuildId: string | null;
  analysisVersions: string;
  geneSetVersions: string;
}

declare const __RELEASE_IDENTITY__: ReleaseIdentity;

/** The first 128 release bits (32 hex characters) form the `?v=` bundle cache key. */
export function releaseBundleVersion(releaseId: string | null | undefined, appVersion: string): string {
  return typeof releaseId === 'string' && /^[a-f0-9]{64}$/.test(releaseId)
    ? releaseId.slice(0, 32) : appVersion;
}

/** Tests and consumers outside Vite must not imply a verified production build. */
export const RELEASE_IDENTITY: Readonly<ReleaseIdentity> = typeof __RELEASE_IDENTITY__ !== 'undefined'
  ? Object.freeze(__RELEASE_IDENTITY__)
  : Object.freeze({
    schemaVersion: 1, releaseId: 'unverified', appVersion: 'dev', codeCommit: null,
    sourceSha256: 'unverified', sourceDirty: true, dataBuildId: null,
    dataBuildSha256: null, expressionBuildId: null,
    analysisVersions: 'Not recorded in this build', geneSetVersions: 'Not recorded in this build',
  });
