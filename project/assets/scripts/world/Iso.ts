/**
 * Isometric projection — the single place that knows about the 2:1 diamond.
 *
 * Like the reference engine, the simulation stays in plain Cartesian world
 * units (TILE px per cell, origin at map centre); projection only happens at
 * render / pick time. Keeping it that way means pathing, ranges, collision and
 * AI never have to care that the screen is skewed.
 *
 * Reference: redalert2/src/game/Coords.ts + engine/IsoCoords.ts
 *   ISO_TILE_SIZE = 30, LEPTONS_PER_TILE = 256
 *   screen = (xs - ys, (xs + ys) / 2)
 *   tileHeightToScreen(h) = h * 15
 */
import { TILE, MAP_TILES } from '../core/Core';

/** diamond width in px (2:1 ratio, matches the classic iso tile) */
export const ISO_W = 56;
/** diamond height in px */
export const ISO_H = 28;
export const ISO_HW = ISO_W / 2;
export const ISO_HH = ISO_H / 2;
/** how many screen px one terrain level lifts a tile */
export const HEIGHT_PX = 16;

// projected half extents of the playfield (rx-ry spans -MAP_TILES..MAP_TILES)
export const PROJ_HALF_X = (MAP_TILES / 2) * ISO_HW * 2;
export const PROJ_HALF_Y = (MAP_TILES / 2) * ISO_HH * 2;

export interface Proj {
    x: number;
    y: number;
}

/**
 * world (cartesian, origin at map centre) -> projected screen space.
 * `z` is a terrain level (1 level = HEIGHT_PX px of lift).
 */
export function worldToProj(wx: number, wy: number, z = 0): Proj {
    const rx = wx / TILE;
    const ry = wy / TILE;
    return {
        x: (rx - ry) * ISO_HW,
        y: (rx + ry) * ISO_HH - z * HEIGHT_PX,
    };
}

/** inverse of worldToProj at a given lift level */
export function projToWorld(px: number, py: number, z = 0): Proj {
    const a = px / ISO_HW;                      // rx - ry
    const b = (py + z * HEIGHT_PX) / ISO_HH;    // rx + ry
    return {
        x: ((a + b) / 2) * TILE,
        y: ((b - a) / 2) * TILE,
    };
}

/** depth key: larger = closer to the viewer, drawn later */
export function depthOf(wx: number, wy: number) {
    return wx + wy;
}
