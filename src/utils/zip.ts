// A minimal ZIP writer for downloads that bundle many files (one chart per
// file). Entries are STORED, not deflated: the payloads are PNGs, which are
// already deflate-compressed, and SVG charts of a few kilobytes, so
// compressing again would cost time for almost no size. Writing the format
// directly keeps a dependency (and its third-party notice) out of the bundle
// for the ~80 lines the store-only subset needs.
//
// Format: PKWARE APPNOTE 6.3.x. One local file header + data per entry, then
// the central directory and its end record. Names are UTF-8 (general-purpose
// flag bit 11), so a gene or population with a non-ASCII label survives.
// No ZIP64: the caller's archives are far below 4 GB and 65,535 entries, and
// building one that large is refused rather than written corrupt.

export interface ZipEntry {
  /** Path inside the archive, `/`-separated (e.g. `POMC/e9_bar_chart.png`). */
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), as ZIP stores it. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time fields, local time, 2-second resolution. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const LIMIT_32 = 0xffffffff;
const VERSION = 20; // 2.0: the minimum for stored entries with folder paths
const UTF8_FLAG = 0x0800;

/** Build a store-only ZIP archive of the given entries. */
export function zipStore(entries: readonly ZipEntry[], modified: Date = new Date()): Uint8Array<ArrayBuffer> {
  if (entries.length > 0xffff) throw new Error('Too many files for one ZIP archive.');
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(modified);

  const records = entries.map((entry) => ({
    name: encoder.encode(entry.name.replace(/\\/g, '/').replace(/^\/+/, '')),
    data: entry.data,
    crc: crc32(entry.data),
  }));
  const localSize = records.reduce((sum, r) => sum + 30 + r.name.length + r.data.length, 0);
  const centralSize = records.reduce((sum, r) => sum + 46 + r.name.length, 0);
  if (localSize + centralSize + 22 > LIMIT_32) throw new Error('The files are too large for one ZIP archive.');

  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let pos = 0;
  const u16 = (v: number) => { view.setUint16(pos, v, true); pos += 2; };
  const u32 = (v: number) => { view.setUint32(pos, v >>> 0, true); pos += 4; };
  const bytes = (b: Uint8Array) => { out.set(b, pos); pos += b.length; };

  const offsets: number[] = [];
  for (const r of records) {
    offsets.push(pos);
    u32(0x04034b50); u16(VERSION); u16(UTF8_FLAG); u16(0); // signature, version, flags, method: stored
    u16(time); u16(date); u32(r.crc); u32(r.data.length); u32(r.data.length);
    u16(r.name.length); u16(0); // name length, extra length
    bytes(r.name); bytes(r.data);
  }

  const centralStart = pos;
  records.forEach((r, i) => {
    u32(0x02014b50); u16(VERSION); u16(VERSION); u16(UTF8_FLAG); u16(0);
    u16(time); u16(date); u32(r.crc); u32(r.data.length); u32(r.data.length);
    u16(r.name.length); u16(0); u16(0); // name, extra, comment lengths
    u16(0); u16(0); u32(0); // disk start, internal attributes, external attributes
    u32(offsets[i]);
    bytes(r.name);
  });

  const centralLength = pos - centralStart;
  u32(0x06054b50); u16(0); u16(0); // end record, this disk, central directory disk
  u16(records.length); u16(records.length);
  u32(centralLength); u32(centralStart);
  u16(0); // comment length
  return out;
}
