/** Minimal ZIP writer (STORE method, no compression).
 *
 *  Juno's Export used to write a JSON manifest to /outputs/exports and return
 *  its path, which is not a download. Packaging audio needs a zip, and audio is
 *  already compressed (mp3) or large (wav) — deflate buys almost nothing on the
 *  former and would pull in a dependency for the latter. So this writes stored
 *  entries directly: ~120 lines, no new packages, and every unzip tool reads it.
 *
 *  Uses ZIP64-free 32-bit fields, which is fine below 4 GB; `addFile` refuses
 *  anything larger rather than silently emitting a corrupt archive.
 */
import fs from "fs";
import { Writable } from "stream";

const MAX_ENTRY_BYTES = 0xffffffff;

/* CRC-32 (IEEE 802.3), table built once. */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer, seed = 0): number {
  let c = ~seed;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** DOS date/time, as ZIP stores it. */
function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

interface Entry {
  nameBuf: Buffer;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

export class ZipWriter {
  private entries: Entry[] = [];
  private offset = 0;

  constructor(private out: Writable) {}

  private write(buf: Buffer): Promise<void> {
    this.offset += buf.length;
    return new Promise((resolve, reject) => {
      this.out.write(buf, (err) => (err ? reject(err) : resolve()));
    });
  }

  /** Add one file from an in-memory buffer. */
  async addBuffer(name: string, data: Buffer, mtime = new Date()): Promise<void> {
    if (data.length > MAX_ENTRY_BYTES) throw new Error(`"${name}" is too large for a 32-bit zip entry`);
    const nameBuf = Buffer.from(name, "utf8");
    const { time, date } = dosTime(mtime);
    const crc = crc32(data);
    const offset = this.offset;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 filename
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    await this.write(local);
    await this.write(nameBuf);
    await this.write(data);
    this.entries.push({ nameBuf, crc, size: data.length, offset, time, date });
  }

  /** Add one file from disk. Read whole — Juno's library files are songs, not
   *  multi-gigabyte masters, and streaming would need a two-pass CRC. */
  async addFile(name: string, filePath: string): Promise<void> {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_ENTRY_BYTES) throw new Error(`"${name}" is too large for a 32-bit zip entry`);
    await this.addBuffer(name, fs.readFileSync(filePath), stat.mtime);
  }

  /** Write the central directory and end-of-archive record. */
  async finish(): Promise<void> {
    const dirStart = this.offset;
    for (const e of this.entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); // central directory header signature
      h.writeUInt16LE(20, 4); // version made by
      h.writeUInt16LE(20, 6); // version needed
      h.writeUInt16LE(0x0800, 8); // flags: UTF-8
      h.writeUInt16LE(0, 10); // method: stored
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.size, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.nameBuf.length, 28);
      h.writeUInt16LE(0, 30); // extra
      h.writeUInt16LE(0, 32); // comment
      h.writeUInt16LE(0, 34); // disk number
      h.writeUInt16LE(0, 36); // internal attrs
      h.writeUInt32LE(0, 38); // external attrs
      h.writeUInt32LE(e.offset, 42);
      await this.write(h);
      await this.write(e.nameBuf);
    }
    const dirSize = this.offset - dirStart;

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
    end.writeUInt16LE(0, 4); // disk number
    end.writeUInt16LE(0, 6); // disk with central directory
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(dirSize, 12);
    end.writeUInt32LE(dirStart, 16);
    end.writeUInt16LE(0, 20); // comment length
    await this.write(end);
  }
}

/** Make a filename safe for a zip entry and for every host filesystem. */
export function safeEntryName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[/\\]/g, "-")
    .replace(/[\x00-\x1f<>:"|?*]/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}
