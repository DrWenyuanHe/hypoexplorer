// Export approved artwork at delivery sizes; retained masters remain untouched.
import sharp from 'sharp';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'brand/source');
const exportsDir = resolve(root, 'brand/exports');
const delivery = resolve(root, 'public/brand/v1');
await mkdir(exportsDir, { recursive: true });
await mkdir(delivery, { recursive: true });
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

for (const [input, output] of [['concept-a', 'hypoexplorer-logo'], ['wordmark', 'hypoexplorer-wordmark'], ['brain', 'hypoexplorer-brain']]) {
  await sharp(resolve(source, `${input}.png`)).trim({ threshold: 12 })
    .png().toFile(resolve(exportsDir, `${output}.png`));
}
await sharp(resolve(exportsDir, 'hypoexplorer-logo.png'))
  .resize(780, 164, { fit: 'contain', background: transparent })
  .extend({ top: 8, bottom: 8, left: 10, right: 10, background: transparent })
  .png().toFile(resolve(delivery, 'hypoexplorer-logo.png'));

const brain = await sharp(resolve(exportsDir, 'hypoexplorer-brain.png'))
  .resize(440, 440, { fit: 'inside' }).png().toBuffer();
const icon = await sharp({ create: { width: 512, height: 512, channels: 4, background: transparent } })
  .composite([{ input: brain, gravity: 'centre' }]).png().toBuffer();
for (const size of [16, 32, 48, 192, 512]) {
  const name = size < 100 ? `favicon-${size}.png` : `app-icon-${size}.png`;
  await sharp(icon).resize(size, size).png().toFile(resolve(delivery, name));
}
await sharp(icon).flatten({ background: '#FFFFFF' }).resize(180, 180)
  .png().toFile(resolve(delivery, 'apple-touch-icon.png'));

// ICO directory containing lossless PNG images at native browser-tab sizes.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(size => sharp(icon).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((bytes, i) => {
  const entry = 6 + i * 16;
  header[entry] = sizes[i];
  header[entry + 1] = sizes[i];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(bytes.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += bytes.length;
});
await writeFile(resolve(root, 'public/favicon.ico'), Buffer.concat([header, ...images]));
await copyFile(resolve(root, 'public/favicon.ico'), resolve(exportsDir, 'favicon.ico'));
console.log('Brand exports and website icons generated from retained concept A artwork.');
