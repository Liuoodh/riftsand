/**
 * Westwood TMP isometric tile reader.
 *
 * Layout, verified against redalert2/src/data/TmpFile.ts:15-38 and
 * redalert2/src/data/TmpImage.ts:33-66:
 *
 *   header  i32 width | i32 height | i32 blockW | i32 blockH
 *           i32[width*height] block offsets (absolute)
 *   block   52-byte header:
 *           i32 x, y, unused, unused, dataSize, extraX, extraY, extraW, extraH
 *           u32 flags (1 = has extra, 2 = has z-data, 4 = damaged)
 *           u8 zHeight | u8 terrainType | u8 rampType
 *           i8[3] radarLeft rgb | i8[3] radarRight rgb | u8[3] pad
 *   data    (blockW*blockH)/2 index bytes
 *           [+ same-size z buffer if flag 2]
 *           [+ extraW*extraH bytes if flag 1]
 *
 * The important part for us is the metadata: `terrainType` and `rampType` are
 * exactly what drives LandType lookup and the slope of a cell in the retail
 * engine, so reading them lets real tile sets drive our own Terrain.heightAt.
 * Pixel unpacking (the diamond scanline walk) is left to the renderer.
 */

import { Reader } from './Reader';

export const TMP_HAS_EXTRA = 1;
export const TMP_HAS_Z = 2;
export const TMP_DAMAGED = 4;

export interface TmpTile {
    x: number;
    y: number;
    extraX: number;
    extraY: number;
    extraW: number;
    extraH: number;
    flags: number;
    zHeight: number;
    /** retail TerrainType enum value, see engine/type/TerrainType.ts */
    terrainType: number;
    /** 0 = flat, 1..20 = which corner blend this cell uses */
    rampType: number;
    /** (blockW*blockH)/2 palette indices, diamond scan order */
    px: Uint8Array;
    /** z buffer, same size as px, present when flags & TMP_HAS_Z */
    z?: Uint8Array;
    /** extra overlapping art, present when flags & TMP_HAS_EXTRA */
    extra?: Uint8Array;
}

export class TmpFile {
    width = 0;
    height = 0;
    blockW = 0;
    blockH = 0;
    tiles: TmpTile[] = [];

    get count() {
        return this.tiles.length;
    }

    static parse(buf: ArrayBuffer): TmpFile {
        const tmp = new TmpFile();
        const r = new Reader(buf);
        tmp.width = r.i32();
        tmp.height = r.i32();
        tmp.blockW = r.i32();
        tmp.blockH = r.i32();

        const n = tmp.width * tmp.height;
        if (!(n > 0 && n <= 65536)) return tmp;

        const offsets: number[] = [];
        for (let i = 0; i < n; i++) offsets.push(r.u32());

        const dataLen = Math.max(1, (tmp.blockW * tmp.blockH) >> 1);

        for (let i = 0; i < n; i++) {
            const off = offsets[i];
            if (off <= 0 || off >= buf.byteLength) continue;
            r.seek(off);
            const x = r.i32();
            const y = r.i32();
            r.skip(8);
            const dataSize = r.i32();
            const extraX = r.i32();
            const extraY = r.i32();
            const extraW = r.i32();
            const extraH = r.i32();
            const flags = r.u32();
            const zHeight = r.u8();
            const terrainType = r.u8();
            const rampType = r.u8();
            r.skip(9);

            const px = new Uint8Array(dataLen);
            const avail = Math.min(dataLen, Math.max(0, r.remaining));
            for (let k = 0; k < avail; k++) px[k] = r.u8();

            let z: Uint8Array | undefined;
            if (flags & TMP_HAS_Z) {
                z = new Uint8Array(dataLen);
                const zn = Math.min(dataLen, Math.max(0, r.remaining));
                for (let k = 0; k < zn; k++) z[k] = r.u8();
            }

            let extra: Uint8Array | undefined;
            if (flags & TMP_HAS_EXTRA) {
                const en = Math.abs(extraW * extraH);
                extra = new Uint8Array(en);
                const an = Math.min(en, Math.max(0, r.remaining));
                for (let k = 0; k < an; k++) extra[k] = r.u8();
            }

            tmp.tiles.push({
                x, y, extraX, extraY, extraW, extraH, flags,
                zHeight, terrainType, rampType, px, z, extra,
            });
            void dataSize;
        }
        return tmp;
    }
}

/**
 * Retail TerrainType -> our tile kind. Values from
 * engine/type/TerrainType.ts:1-14 mapped through game/type/LandType.ts:15-34.
 * Kept here so a real tile set can populate Terrain.level / .kind directly.
 */
export const TERRAIN_TYPE_LAND: Record<number, 'clear' | 'road' | 'rock' | 'rough' | 'water' | 'cliff' | 'wall'> = {
    0: 'clear',
    5: 'cliff',   // Tunnel
    6: 'road',    // Railroad
    7: 'rock',    // Rock1
    8: 'rock',    // Rock2
    9: 'water',   // Water
    10: 'clear',  // Shore
    11: 'road',   // Pavement
    12: 'road',   // Dirt
    13: 'clear',  // Clear
    14: 'rough',  // Rough
    15: 'cliff',  // Cliff
};


/* ------------------------------------------------------------------ */
/* pixel unpacking                                                     */
/* ------------------------------------------------------------------ */

/**
 * Width of one scanline of the 2:1 diamond.
 *
 * The retail blitter (engine/gfx/drawable/TmpDrawable.ts:14-45) walks the tile
 * row by row: the run grows by 4 pixels per row for the top half, then shrinks by
 * 4. That is a 60x30 diamond with a 2:1 slope, stored WITHOUT the transparent
 * corners — 900 indices for a 60x30 cell, not 1800.
 */
export function tmpRowWidth(row: number, width: number, height: number) {
    const half = height >> 1;
    // rows 0..14 grow 4..60, rows 15..28 shrink 56..4, the last row holds nothing.
    // That asymmetry is in the retail blitter (it pre-increments before the first
    // half and pre-decrements before the second), and the byte count only adds up
    // if it is reproduced exactly: 480 + 420 = 900 indices.
    const r = row < half ? row + 1 : height - 1 - row;
    return Math.max(0, Math.min(width, r * 4));
}

/**
 * Expand one TMP tile to RGBA using a palette.
 * Index 0 stays transparent, exactly like the retail blitter's `pixel !== 0`.
 */
export function tmpTileToRgba(
    tile: TmpTile,
    pal: Uint8Array,
    width = 60,
    height = 30,
): Uint8Array {
    const out = new Uint8Array(width * height * 4);
    let src = 0;
    for (let y = 0; y < height; y++) {
        const rw = tmpRowWidth(y, width, height);
        const x0 = (width - rw) >> 1;
        for (let i = 0; i < rw; i++) {
            const idx = tile.px[src++];
            if (!idx) continue;
            const o = (y * width + x0 + i) * 4;
            const pi = idx * 3;
            out[o] = pal[pi];
            out[o + 1] = pal[pi + 1];
            out[o + 2] = pal[pi + 2];
            out[o + 3] = 255;
        }
    }
    return out;
}

/**
 * Minimal TMP writer, used by the asset test to prove the reader is correct.
 *
 * We cannot ship retail tiles, so the test builds a file with this, parses it
 * back and compares pixels byte for byte — the same trick used for SHP.
 */
export function encodeTmp(
    tiles: Array<{ zHeight?: number; terrainType?: number; rampType?: number; px: Uint8Array }>,
    blockW = 60,
    blockH = 30,
): ArrayBuffer {
    const n = tiles.length;
    const headerLen = 16 + n * 4;
    const blockLen = 52 + (blockW * blockH) / 2;
    const buf = new ArrayBuffer(headerLen + n * blockLen);
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);

    view.setInt32(0, n, true);
    view.setInt32(4, 1, true);
    view.setInt32(8, blockW, true);
    view.setInt32(12, blockH, true);

    let off = headerLen;
    for (let i = 0; i < n; i++) {
        const t = tiles[i];
        view.setInt32(16 + i * 4, off, true);
        let p = off;
        view.setInt32(p, 0, true); p += 4;                  // x
        view.setInt32(p, 0, true); p += 4;                  // y
        view.setInt32(p, 0, true); p += 4;                  // unused
        view.setInt32(p, 0, true); p += 4;                  // unused
        view.setInt32(p, (blockW * blockH) / 2, true); p += 4;
        view.setInt32(p, 0, true); p += 4;                  // extraX
        view.setInt32(p, 0, true); p += 4;                  // extraY
        view.setInt32(p, 0, true); p += 4;                  // extraW
        view.setInt32(p, 0, true); p += 4;                  // extraH
        view.setUint32(p, 0, true); p += 4;                 // flags
        bytes[p++] = t.zHeight ?? 0;
        bytes[p++] = t.terrainType ?? 0;
        bytes[p++] = t.rampType ?? 0;
        p += 9;                                             // radar colours + pad
        bytes.set(t.px.subarray(0, (blockW * blockH) >> 1), p);
        off += blockLen;
    }
    return buf;
}
