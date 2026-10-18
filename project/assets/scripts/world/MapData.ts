/**
 * Authored-map format.
 *
 * Retail Red Alert 2 ships hand-built .map files: an 80x80 (or larger) grid of
 * TMP tiles, each with a tile index, a sub-tile, a height level and a land
 * type, plus separate overlay/structure/unit/waypoint lists. Our engine needs
 * the same information in a form a human can author and a diff can review, so a
 * map is a JSON document with RLE-packed per-cell arrays:
 *
 *   land    one entry per cell   — what the ground *is* (drives speed, blocking)
 *   height  one entry per cell   — 0..3, the level the tile sits at
 *   tiles   one entry per cell   — visual tile id (art, no gameplay effect)
 *   blocked one entry per cell   — 1 = wall even though the land is walkable
 *   ore     explicit ore fields  — replaces the procedural scatter
 *   spawns  start tiles          — replaces the hard-coded base positions
 *
 * Everything the *procedural* maps do (noise ridges, mirrored bowls, a shaped
 * mid lane) is expressible as these arrays, which is the point: a hand-drawn
 * map and a generated map go through exactly one loader.
 *
 * `tools/mapatest.mjs`-style validation lives in `validateMap` so a broken map
 * fails loudly at boot instead of producing a match nobody can win.
 */
import { MAP_TILES } from '../core/Core';

/** Mechanical land types, mirroring the reference `LandType` subset we use. */
export const LAND = {
    Clear: 0,
    Rough: 1,
    Road: 2,
    Ore: 3,
    Water: 4,
    Rock: 5,
} as const;
export type LandId = (typeof LAND)[keyof typeof LAND];

/** Land type names, for the editor's palette and for error messages. */
export const LAND_NAMES: Record<number, string> = {
    0: 'clear', 1: 'rough', 2: 'road', 3: 'ore', 4: 'water', 5: 'rock',
};

export interface Packed {
    /** only one encoding for now; kept explicit so it can grow */
    enc: 'rle';
    /** number of cells = size * size */
    n: number;
    /** [value, runLength, value, runLength, ...] */
    data: number[];
}

export interface MapOre {
    tx: number;
    ty: number;
    /** total credits in the field */
    amount: number;
}

export interface MapSpawn {
    tx: number;
    ty: number;
    /** 0 = human side, 1 = AI side */
    player: number;
}

export interface MapData {
    format: 1;
    id: string;
    name: string;
    en?: string;
    /** which theatre's tileset this map expects (art lookup only) */
    theater: 'desert' | 'snow' | 'urban' | 'temperate';
    /** must equal MAP_TILES */
    size: number;
    land: Packed;
    height?: Packed;
    tiles?: Packed;
    blocked?: Packed;
    ore?: MapOre[];
    spawns?: MapSpawn[];
    /** short design note shown in the map picker */
    note?: string;
}

/** Run-length encode a per-cell array. */
export function pack(values: ArrayLike<number>): Packed {
    const data: number[] = [];
    let run = 0;
    let cur = values[0] ?? 0;
    for (let i = 0; i < values.length; i++) {
        if (values[i] === cur) { run++; continue; }
        data.push(cur, run);
        cur = values[i];
        run = 1;
    }
    data.push(cur, run);
    return { enc: 'rle', n: values.length, data };
}

/** Decode into `out`; throws when the run lengths do not add up. */
export function unpack(p: Packed, out: Uint8Array | Uint16Array): void {
    let at = 0;
    for (let i = 0; i < p.data.length; i += 2) {
        const v = p.data[i];
        const n = p.data[i + 1];
        for (let k = 0; k < n; k++) {
            if (at >= out.length) return;
            out[at++] = v;
        }
    }
    if (at !== out.length) {
        throw new Error(`map pack: expected ${out.length} cells, decoded ${at}`);
    }
}

export interface DecodedMap {
    size: number;
    land: Uint8Array;
    height: Uint8Array;
    tiles: Uint16Array;
    blocked: Uint8Array;
}

export function decodeMap(d: MapData): DecodedMap {
    const n = d.size * d.size;
    const land = new Uint8Array(n);
    const height = new Uint8Array(n);
    const tiles = new Uint16Array(n);
    const blocked = new Uint8Array(n);
    unpack(d.land, land);
    if (d.height) unpack(d.height, height);
    if (d.tiles) unpack(d.tiles, tiles as unknown as Uint8Array);
    if (d.blocked) unpack(d.blocked, blocked);
    return { size: d.size, land, height, tiles, blocked };
}

/** Cell index helper shared by the loader and the tools. */
export const cellIndex = (tx: number, ty: number, size = MAP_TILES) => ty * size + tx;

/**
 * Structural validation. Returns human-readable problems; an empty array means
 * the map is loadable. Deliberately strict: a map that silently loses its ore
 * or its spawn is worse than one that refuses to boot.
 */
export function validateMap(d: MapData): string[] {
    const errs: string[] = [];
    if (d.format !== 1) errs.push(`format ${d.format} != 1`);
    if (!d.id) errs.push('missing id');
    if (!d.name) errs.push('missing name');
    if (d.size !== MAP_TILES) errs.push(`size ${d.size} != ${MAP_TILES}`);
    if (!d.land || d.land.enc !== 'rle') errs.push('missing land');
    else if (d.land.n !== d.size * d.size) errs.push(`land has ${d.land.n} cells, expected ${d.size * d.size}`);

    let decoded: DecodedMap | null = null;
    try {
        decoded = decodeMap(d);
    } catch (e) {
        errs.push(String(e));
    }
    if (!decoded) return errs;

    const { land, height, size } = decoded;
    let playable = 0;
    for (let i = 0; i < land.length; i++) {
        if (land[i] > LAND.Rock) errs.push(`land[${i}] = ${land[i]} is not a land type`);
        if (height[i] > 3) errs.push(`height[${i}] = ${height[i]} out of range`);
        if (land[i] !== LAND.Rock && land[i] !== LAND.Water) playable++;
    }
    if (playable < size * size * 0.25) errs.push('less than 25% of the map is driveable');

    const spawns = d.spawns ?? [];
    if (spawns.length < 2) {
        errs.push('need two spawns');
    } else {
        for (const s of spawns) {
            if (s.tx < 2 || s.ty < 2 || s.tx >= size - 2 || s.ty >= size - 2) {
                errs.push(`spawn ${s.player} at ${s.tx},${s.ty} is too close to the rim`);
            }
            const l = land[cellIndex(s.tx, s.ty, size)];
            if (l === LAND.Rock || l === LAND.Water) {
                errs.push(`spawn ${s.player} sits on ${LAND_NAMES[l]}`);
            }
        }
    }

    if (!d.ore || d.ore.length === 0) errs.push('map has no ore');
    else {
        for (const o of d.ore) {
            if (o.tx < 0 || o.ty < 0 || o.tx >= size || o.ty >= size) errs.push(`ore at ${o.tx},${o.ty} off-map`);
            if (o.amount <= 0) errs.push(`ore at ${o.tx},${o.ty} has no amount`);
        }
    }
    return errs;
}
