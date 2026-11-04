import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

/**
 * GNU tar (Git Bash, MSYS) reads `C:\...` as a remote `host:path`, so archive
 * and list paths are passed relative to the invocation's working directory.
 */
function tarPath(cwd: string, file: string): string {
  const rel = relative(resolve(cwd), file);
  if (isAbsolute(rel)) return file; // different drive: no relative form exists
  const posix = rel.split(sep).join('/');
  return posix.startsWith('../') ? posix : `./${posix}`;
}

/** One working directory per tar invocation also works with Windows bsdtar. */
export async function createPublicationArchive(
  output: string, name: string, base: string, files: string[],
  metadata?: { directory: string; files: string[] },
): Promise<void> {
  const safe = (file: string) => file && !/[\r\n\0\\]/.test(file) && !file.startsWith('-')
    && !isAbsolute(file) && !/^[A-Za-z]:/.test(file) && !file.split('/').includes('..');
  assert(/^[a-z][a-z-]*$/.test(name), 'Unsafe archive name');
  assert(files.length > 0 && files.every(safe) && (!metadata || metadata.files.every(safe)), 'Unsafe archive path');
  const directory = resolve(output);
  const list = join(directory, `${name}.files.txt`);
  const target = join(directory, `${name}.tar.gz`);
  assert(!existsSync(target), `Refusing to overwrite archive ${target}`);
  writeFileSync(list, `${files.join('\n')}\n`);
  if (!metadata) {
    execFileSync('tar', ['-czf', tarPath(base, target), '-T', tarPath(base, list)], { cwd: base, windowsHide: true, stdio: 'inherit' });
    return;
  }
  // Windows bsdtar 3.8.8 mishandles a later -C combined with -T, producing
  // corrupted directory names. Avoid positional directory switches entirely.
  // Append before gzip because tar cannot append to a compressed archive.
  const uncompressed = join(directory, `${name}.tar`);
  assert(!existsSync(uncompressed), `Refusing to overwrite archive ${uncompressed}`);
  execFileSync('tar', ['-cf', tarPath(base, uncompressed), '-T', tarPath(base, list)], { cwd: base, windowsHide: true, stdio: 'inherit' });
  execFileSync('tar', ['-rf', tarPath(metadata.directory, uncompressed), '--', ...metadata.files], {
    cwd: metadata.directory, windowsHide: true, stdio: 'inherit',
  });
  await pipeline(createReadStream(uncompressed), createGzip(), createWriteStream(target, { flags: 'wx' }));
  unlinkSync(uncompressed);
}
