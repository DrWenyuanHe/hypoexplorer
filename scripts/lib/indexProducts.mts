import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Keep identical bytes untouched and never overwrite an immutable generation. */
export async function writeIndexProduct(file: string, content: string, options: { immutable: boolean; check?: boolean }): Promise<void> {
  let previous: string | null = null;
  try { previous = await readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (previous === content) return;
  if (options.check) throw new Error(`Index product is missing or stale: ${file}`);
  if (options.immutable && previous !== null) throw new Error(`Refusing to alter an immutable index object: ${file}`);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${randomUUID()}`;
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  let failure: unknown;
  try {
    if (options.immutable) {
      // Creating the final link is atomic and refuses an existing path, including
      // one another builder created after the read above. The temporary lives on
      // the same filesystem. Readers can only observe the complete file.
      try { await link(temporary, file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (await readFile(file, 'utf8') !== content) throw new Error(`Conflicting concurrent immutable index object: ${file}`);
      }
    } else {
      await rename(temporary, file);
    }
  } catch (error) {
    failure = error;
  }
  try { await unlink(temporary); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failure ??= error; }
  if (failure) throw failure;
}
