// Minimal POSIX ustar writer and reader for the data-release archives.
//
// Written here rather than shelling out to `tar` so an archive packs and
// unpacks identically on Windows and in CI, and so a release is deterministic:
// entries are sorted, and every header carries mode 0644, uid/gid 0 and mtime 0.
// Only regular files are written or read; paths are repository-relative and
// may not be absolute or contain `..`.

const BLOCK = 512;

function field(header: Buffer, offset: number, length: number, value: string): void {
  header.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8');
}
const octal = (value: number, length: number) => value.toString(8).padStart(length - 1, '0') + '\0';

// A path that fits ustar's name/prefix split, or null when it needs a PAX header.
function splitPath(path: string): [prefix: string, name: string] | null {
  if (Buffer.byteLength(path) <= 100) return ['', path];
  for (let cut = path.indexOf('/'); cut > 0; cut = path.indexOf('/', cut + 1)) {
    const prefix = path.slice(0, cut), name = path.slice(cut + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return [prefix, name];
  }
  return null;
}

function header(name: string, prefix: string, size: number, type: string): Buffer {
  const block = Buffer.alloc(BLOCK);
  field(block, 0, 100, name);
  field(block, 100, 8, '0000644\0');
  field(block, 108, 8, '0000000\0');
  field(block, 116, 8, '0000000\0');
  field(block, 124, 12, octal(size, 12));
  field(block, 136, 12, octal(0, 12));
  block.fill(' ', 148, 156);
  block[156] = type.charCodeAt(0);
  field(block, 257, 6, 'ustar\0');
  field(block, 263, 2, '00');
  field(block, 345, 155, prefix);
  let sum = 0;
  for (const byte of block) sum += byte;
  field(block, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return block;
}
const padding = (size: number) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

/** A PAX `path=` record; its leading length counts itself. */
function paxRecord(path: string): Buffer {
  const body = ` path=${path}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (String(length).length + Buffer.byteLength(body) !== length) length = String(length).length + Buffer.byteLength(body);
  return Buffer.from(`${length}${body}`, 'utf8');
}

export function assertSafePath(path: string): void {
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..') || path.includes('\\')) {
    throw new Error(`unsafe archive path: ${path}`);
  }
}

/** One archive entry: a 512-byte header, the bytes, and padding to the next block. */
export function tarEntry(path: string, bytes: Buffer): Buffer[] {
  assertSafePath(path);
  const split = splitPath(path);
  const file = (prefix: string, name: string) => [header(name, prefix, bytes.length, '0'), bytes, padding(bytes.length)];
  if (split) return file(...split);
  // Too long for ustar: a PAX extended header carries the full path, and the
  // ustar header holds a truncated name that PAX-aware readers ignore.
  const record = paxRecord(path);
  const short = path.slice(-100).replace(/^[^/]*\//, '');
  return [header('PaxHeader', '', record.length, 'x'), record, padding(record.length), ...file('', short)];
}

/** The two zero blocks that end an archive. */
export const tarEnd = () => Buffer.alloc(BLOCK * 2);

/** Regular-file entries of an uncompressed ustar archive. */
export function* readTar(archive: Buffer): Generator<{ path: string; bytes: Buffer }> {
  const text = (start: number, length: number) => {
    const raw = archive.subarray(start, start + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end < 0 ? length : end).toString('utf8');
  };
  let paxPath: string | null = null;
  for (let offset = 0; offset + BLOCK <= archive.length;) {
    if (archive.subarray(offset, offset + BLOCK).every((byte) => byte === 0)) return;
    const name = text(offset, 100);
    const prefix = text(offset + 345, 155);
    const size = parseInt(text(offset + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(archive[offset + 156] || 48);
    const start = offset + BLOCK;
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
    if (type === 'x') {
      paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(archive.subarray(start, start + size).toString('utf8'))?.[1] ?? null;
      continue;
    }
    if (type !== '0') { paxPath = null; continue; }
    const path = paxPath ?? (prefix ? `${prefix}/${name}` : name);
    paxPath = null;
    assertSafePath(path);
    yield { path, bytes: archive.subarray(start, start + size) };
  }
}
