/**
 * Westwood SHP sprite sheet reader.
 *
 * Layout (all little-endian), verified against
 * redalert2/src/data/ShpFile.ts:32-176:
 *
 *   header      i16 reserved(0) | i16 width | i16 height | i16 numImages
 *   descriptors numImages x 24 bytes, starting at offset 8
 *               i16 x | i16 y | i16 w | i16 h | u8 comp | u8[3] pad
 *               i32 0 | i32 0 | i32 dataOffset      <- absolute file offset
 *   frame       at dataOffset: i16 x,y,w,h | u8 comp | ... | i32 dataOffset
 *
 * Compression:
 *   0 / 1  raw index bytes
 *   2      per-row: u16 lineLen (incl. itself) then lineLen-2 literal bytes
 *   3      LCW / "Format3" scanline runs
 *
 * Pixels are 8-bit palette indices, row-major, stride = width, no padding,
 * index 0 = transparent.
 */

import { Reader } from './Reader';

export interface ShpFrame {
    /** draw offset relative to the sprite anchor */
    x: number;
    y: number;
    w: number;
    h: number;
    /** w*h palette indices; 0 = transparent */
    px: Uint8Array;
    compression: number;
}

/** LCW / Format3 decoder, ported from redalert2/src/data/encoding/Format3.ts:2-40 */
export function lcwDecode(r: Reader, width: number, height: number): Uint8Array {
    const out = new Uint8Array(width * height);
    let dest = 0;
    for (let y = 0; y < height; y++) {
        let lineLen = r.u16() - 2;
        let x = 0;
        while (lineLen > 0) {
            const value = r.u8();
            lineLen--;
            if (value !== 0) {
                if (dest < out.length && x < width) out[dest++] = value;
                x++;
            } else {
                let run = r.u8();
                lineLen--;
                // a run may not cross the right edge of the scanline
                if (x + run > width) run = (width - x) & 0xff;
                for (let k = 0; k < run; k++) {
                    if (dest < out.length && x < width) out[dest++] = 0;
                    x++;
                }
            }
        }
        while (x < width && dest < (y + 1) * width) {
            out[dest++] = 0;
            x++;
        }
        dest = (y + 1) * width;
    }
    return out;
}

export class ShpFile {
    width = 0;
    height = 0;
    numImages = 0;
    frames: ShpFrame[] = [];

    get count() {
        return this.frames.length;
    }

    /**
     * Retail packs a sprite's shadow into the second half of the same file,
     * so half the images are the actual artwork.
     * Reference: ShadowRenderable.ts:71-73
     */
    get bodyCount() {
        return this.count % 2 === 0 ? this.count / 2 : this.count;
    }

    hasShadow() {
        return this.count % 2 === 0;
    }

    static parse(buf: ArrayBuffer): ShpFile {
        const shp = new ShpFile();
        const r = new Reader(buf);

        const reserved = r.i16();
        if (reserved !== 0) {
            // a few fan-made files put the image count in the first word
            r.seek(0);
            shp.numImages = r.u16();
            shp.width = r.i16();
            shp.height = r.i16();
        } else {
            shp.width = r.i16();
            shp.height = r.i16();
            shp.numImages = r.i16();
        }

        const total = shp.numImages;
        if (!(total > 0 && total <= 4096)) return shp;

        const offsets: number[] = [];
        for (let i = 0; i < total; i++) {
            r.seek(8 + 24 * i + 20);
            offsets.push(r.u32());
        }

        for (let i = 0; i < total; i++) {
            const off = offsets[i];
            if (off <= 0 || off >= buf.byteLength) {
                shp.frames.push({ x: 0, y: 0, w: 0, h: 0, px: new Uint8Array(0), compression: 0 });
                continue;
            }
            r.seek(off);
            const x = r.i16();
            const y = r.i16();
            const w = Math.max(0, r.i16());
            const h = Math.max(0, r.i16());
            const compression = r.u8();
            r.skip(3 + 8);
            const dataOff = r.i32();

            let px: Uint8Array;
            if (w === 0 || h === 0 || dataOff <= 0 || dataOff >= buf.byteLength) {
                px = new Uint8Array(0);
            } else {
                r.seek(dataOff);
                px = decodePixels(r, compression, w, h);
            }
            shp.frames.push({ x, y, w, h, px, compression });
        }
        return shp;
    }
}

function decodePixels(r: Reader, compression: number, w: number, h: number): Uint8Array {
    const out = new Uint8Array(w * h);
    if (compression === 0 || compression === 1) {
        const n = Math.min(w * h, Math.max(0, r.remaining));
        for (let i = 0; i < n; i++) out[i] = r.u8();
        return out;
    }
    if (compression === 2) {
        // run-length per scanline, but the retail format only ever uses the
        // literal path — copy lineLen-2 bytes and move on
        let y = 0;
        while (y < h && !r.eof) {
            const lineLen = r.u16();
            if (lineLen <= 2) {
                y++;
                continue;
            }
            const n = lineLen - 2;
            const row = y * w;
            for (let i = 0; i < n && i < w; i++) out[row + i] = r.u8();
            // still advance the cursor past any bytes we did not store
            if (n > w) r.skip(n - w);
            y++;
        }
        return out;
    }
    if (compression === 3) return lcwDecode(r, w, h);
    return out;
}
