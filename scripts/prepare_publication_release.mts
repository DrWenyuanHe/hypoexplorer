import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readReleaseBuild, releaseSourceFiles } from './lib/releaseBuild.mjs';
import { createPublicationArchive } from './lib/publicationArchive.mjs';

// Packages only an already verified build. No network writes or DOI assignment.
const root = process.cwd();
const dist = resolve(root, process.argv[2] ?? 'dist');
execFileSync(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'),
  resolve(root, 'scripts/verify_release.mts'), dist], { cwd: root, windowsHide: true, stdio: 'inherit' });
const release = readReleaseBuild(root);
const built = JSON.parse(readFileSync(join(dist, 'release.json'), 'utf8'));
assert.equal(built.releaseId, release.releaseId, 'Build is stale: rebuild and verify before packaging');
const output = resolve(root, '.tmp/publication-release', release.releaseId);
assert(!existsSync(output), `Refusing to overwrite release archive ${output}`);
mkdirSync(output, { recursive: true });

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    // Never follow symlinks into credentials, raw downloads or other checkouts.
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
  });
}
async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const dataRoots = [
  'public/datasets', 'public/nomenclature',
  `public/query/${release.dataBuildId}`, `public/query/expression/${release.expressionBuildId}`,
];
const dataFiles = [
  ...dataRoots.flatMap((path) => filesUnder(resolve(root, path))),
  resolve(root, 'public/query/tracks.js'), resolve(root, 'public/query/expression-manifest.js'),
].sort();
const dataInventory = [];
for (const file of dataFiles) dataInventory.push({
  path: relative(root, file).replace(/\\/g, '/'), bytes: statSync(file).size, sha256: await digest(file),
});
writeFileSync(join(output, 'data-files.json'), `${JSON.stringify(dataInventory, null, 2)}\n`);
writeFileSync(join(output, 'release.json'), `${JSON.stringify(built, null, 2)}\n`);
const sourceFiles = releaseSourceFiles(root);
writeFileSync(join(output, 'release-source.json'), `${JSON.stringify({ release, sourceFiles }, null, 2)}\n`);
for (const file of ['CITATION.cff', 'LICENSE', 'REUSE.md']) {
  writeFileSync(join(output, file), readFileSync(resolve(root, file)));
}

await createPublicationArchive(output, 'source', root, sourceFiles, { directory: output, files: ['release-source.json'] });
await createPublicationArchive(output, 'browser-data', root, dataInventory.map((file) => file.path));
await createPublicationArchive(output, 'app', dist, filesUnder(dist).map((file) => relative(dist, file).replace(/\\/g, '/')));
writeFileSync(join(output, 'README.md'), `# HypoExplorer publication snapshot\n\n` +
  `Version: ${release.appVersion}\nRelease: ${release.releaseId}\nSource commit: ${release.codeCommit}\n` +
  `Uncommitted source changes included: ${release.sourceDirty}\n\n` +
  `source.tar.gz contains the allow-listed application/analysis source snapshot.\n` +
  `browser-data.tar.gz retains the exact browsable results and current immutable indexes.\n` +
  `app.tar.gz contains the verified built site; its data origin is recorded in release.json.\n` +
  `data-files.json pins every bundled data file. SHA256SUMS pins this package.\n\n` +
  `To rebuild the app, extract source.tar.gz and browser-data.tar.gz into one folder,\n` +
  `run npm ci --include=dev --ignore-scripts, then npx vite build. The source manifest\n` +
  `is verified without Git. Full scientific prebuild needs the historical repository.\n\n` +
  `This is a local deposit candidate, not a DOI registration. Source raw reads, original\n` +
  `downloaded articles and the full historical scientific evidence corpus are not included.\n` +
  `Use the repository and study-accession records for those inputs and retained methods.\n` +
  `Review REUSE.md before depositing: third-party rights are not relicensed.\n`);
const sums = [];
for (const file of filesUnder(output).sort()) sums.push(`${await digest(file)}  ${relative(output, file).replace(/\\/g, '/')}`);
writeFileSync(join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(`Prepared local publication snapshot: ${output}`);
