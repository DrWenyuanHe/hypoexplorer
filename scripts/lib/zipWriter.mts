// Minimal deterministic ZIP writer for the agent export.
//
// Every entry is deflated (or stored when deflate does not help) with a fixed
// DOS timestamp, no extra fields and UTF-8 names, so the archive bytes depend
// only on the entry names, their order, their contents and the zlib build. The
// export's manifest records SHA-256 of the uncompressed bytes, which is the
// reproducibility contract that survives a different zlib.
//
// ZIP64 is deliberately not implemented: the writer refuses an archive that
// would need it rather than writing one some unzip tools misread.

import { closeSync, constants, copyFileSync, existsSync, linkSync, openSync, rmSync, writeSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';

const LIMIT_32 = 0xffffffff;
const LIMIT_16 = 0xffff;
// 1980-01-01 00:00:00, the DOS epoch.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const FLAG_UTF8 = 1 << 11;

interface CentralRecord {
  name: Buffer;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

export class ZipWriter {
  private readonly fd: number;
  private readonly partial: string;
  private offset = 0;
  private readonly entries: CentralRecord[] = [];
  private readonly names = new Set<string>();

  // Bytes go to a per-process `<file>.<pid>.partial` and are published under
  // the real name only by close(), so a run that throws never leaves a
  // truncated archive there (which would also block the next run). The link
  // is exclusive: of two concurrent exports to one name, the second fails.
  constructor(private readonly file: string) {
    if (existsSync(file)) throw new Error(`Refusing to overwrite ${file}`);
    this.partial = `${file}.${process.pid}.partial`;
    this.fd = openSync(this.partial, 'wx');
  }

  private write(buf: Buffer): void {
    let written = 0;
    while (written < buf.length) written += writeSync(this.fd, buf, written, buf.length - written);
    this.offset += buf.length;
    if (this.offset > LIMIT_32) throw new Error('ZIP archive exceeds 4 GiB; ZIP64 is not supported');
  }

  add(name: string, data: Buffer): void {
    if (this.names.has(name)) throw new Error(`Duplicate ZIP entry ${name}`);
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
      throw new Error(`Unsafe ZIP entry name ${name}`);
    }
    if (data.length > LIMIT_32) throw new Error(`ZIP entry ${name} exceeds 4 GiB`);
    if (this.entries.length >= LIMIT_16) throw new Error('ZIP archive exceeds 65535 entries');
    this.names.add(name);
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const record: CentralRecord = {
      name: Buffer.from(name, 'utf8'),
      method: stored ? 0 : 8,
      crc: crc32(data),
      compressed: body.length,
      size: data.length,
      offset: this.offset,
    };
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(FLAG_UTF8, 6);
    header.writeUInt16LE(record.method, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(record.crc, 14);
    header.writeUInt32LE(record.compressed, 18);
    header.writeUInt32LE(record.size, 22);
    header.writeUInt16LE(record.name.length, 26);
    header.writeUInt16LE(0, 28);
    this.write(header);
    this.write(record.name);
    this.write(body);
    this.entries.push(record);
  }

  close(): void {
    const start = this.offset;
    for (const e of this.entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4); // made by: MS-DOS / FAT, spec 2.0
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(FLAG_UTF8, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(DOS_TIME, 12);
      h.writeUInt16LE(DOS_DATE, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.compressed, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      // extra, comment, disk start, internal attrs = 0
      h.writeUInt32LE(0, 38); // external attrs
      h.writeUInt32LE(e.offset, 42);
      this.write(h);
      this.write(e.name);
    }
    const size = this.offset - start;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    this.write(end);
    closeSync(this.fd);
    try {
      try {
        linkSync(this.partial, this.file);
      } catch (err) {
        // A volume without hard links (exFAT, some shares) gets an exclusive
        // copy instead: slower, but it still never replaces an existing file.
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw err;
        copyFileSync(this.partial, this.file, constants.COPYFILE_EXCL);
      }
    } finally {
      rmSync(this.partial, { force: true });
    }
  }
}
