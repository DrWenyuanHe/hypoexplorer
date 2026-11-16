import { describe, it, expect } from 'vitest';
import { crc32, zipStore } from '../utils/zip';

// A deliberately independent reader: walks the END record → central directory
// → each local header, the way an unzip tool does, so an offset or length the
// writer gets wrong cannot be hidden by reading the bytes back the same way.
function readZip(bytes: Uint8Array): Array<{ name: string; data: Uint8Array; crc: number; flags: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  expect(centralStart + centralSize).toBe(end);

  const out = [];
  let p = centralStart;
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const flags = view.getUint16(p + 8, true);
    expect(view.getUint16(p + 10, true)).toBe(0); // stored
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    expect(view.getUint32(p + 24, true)).toBe(size);
    const nameLength = view.getUint16(p + 28, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    expect(view.getUint32(localOffset + 14, true)).toBe(crc);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const dataStart = localOffset + 30 + localNameLength + view.getUint16(localOffset + 28, true);
    out.push({ name, data: bytes.slice(dataStart, dataStart + size), crc, flags });
    p += 46 + nameLength;
  }
  return out;
}

describe('zip', () => {
  it('computes the standard CRC-32 check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('round-trips stored entries, folders and UTF-8 names', () => {
    const enc = new TextEncoder();
    const png = Uint8Array.from({ length: 5000 }, (_, i) => (i * 37) & 255);
    const entries = [
      { name: 'POMC/macaque_snrna_e9_POMC_bar_chart.png', data: png },
      { name: 'Ñpy/β-cell_µ.svg', data: enc.encode('<svg/>') },
      { name: 'empty.txt', data: new Uint8Array(0) },
    ];
    const read = readZip(zipStore(entries, new Date(2026, 10, 16, 12, 30, 10)));
    expect(read.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    read.forEach((e, i) => {
      expect(Array.from(e.data)).toEqual(Array.from(entries[i].data));
      expect(e.crc).toBe(crc32(entries[i].data));
      expect(e.flags & 0x0800).toBe(0x0800);
    });
  });

  it('writes an empty archive as a bare end record', () => {
    const bytes = zipStore([]);
    expect(bytes.length).toBe(22);
    expect(readZip(bytes)).toEqual([]);
  });

  it('normalises backslashes and leading slashes in entry names', () => {
    const read = readZip(zipStore([{ name: '\\POMC\\a.png', data: new Uint8Array([1]) }]));
    expect(read[0].name).toBe('POMC/a.png');
  });
});
