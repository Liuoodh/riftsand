/**
 * SHP writer.
 *
 * Two reasons this exists rather than being test-only:
 *  1. it makes the reader verifiable without shipping retail assets (encode ->
 *     decode -> compare), which is the only honest way to prove the format
 *     handling is right;
 *  2. if we ever pre-bake procedural art into a real sprite sheet, this is the
 *     path — the rest of the engine then cannot tell the difference between our
 *     generated sheet and a retail one.
 *
 * Only the uncompressed path (compression 0) is written: it is what the retail
 * game itself uses for most building imagery, and compressing is pointless for
 * data we generate on the fly.
 */

export interface RawFrame {
    x: number;
    y: number;
    w: number;
    h: number;
    /** w*h palette indices, 0 = transparent */
    px: Uint8Array;
}

const HEADER = 8;
const DESC = 24;

export function encodeShp(width: number, height: number, frames: RawFrame[]): ArrayBuffer {
    const count = frames.length;
    const frameHeaders = HEADER + DESC * count;
    // each frame: 24-byte header + raw pixels
    let total = frameHeaders;
    for (const f of frames) total += 24 + f.w * f.h;

    const buf = new ArrayBuffer(total);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);

    dv.setInt16(0, 0, true);        // reserved
    dv.setInt16(2, width, true);
    dv.setInt16(4, height, true);
    dv.setInt16(6, count, true);

    let cursor = frameHeaders;
    for (let i = 0; i < count; i++) {
        const f = frames[i];
        const d = HEADER + i * DESC;
        dv.setInt16(d, f.x, true);
        dv.setInt16(d + 2, f.y, true);
        dv.setInt16(d + 4, f.w, true);
        dv.setInt16(d + 6, f.h, true);
        dv.setUint8(d + 8, 0);
        // d+9..19 padding stays zero
        dv.setInt32(d + 20, cursor, true);

        dv.setInt16(cursor, f.x, true);
        dv.setInt16(cursor + 2, f.y, true);
        dv.setInt16(cursor + 4, f.w, true);
        dv.setInt16(cursor + 6, f.h, true);
        dv.setUint8(cursor + 8, 0);   // compression 0
        dv.setInt32(cursor + 20, cursor + 24, true);

        u8.set(f.px.subarray(0, f.w * f.h), cursor + 24);
        cursor += 24 + f.w * f.h;
    }
    return buf;
}
