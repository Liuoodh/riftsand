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
