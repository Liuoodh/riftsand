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

/** how many screen px one terrain level lifts a tile */
export const ISO_DEPTH_PER_LEVEL = ISO_HH * 0.3333;

/**
 * Depth key along the camera axis: larger = closer to the viewer = drawn later.
 *
 * The reference is a real 3D scene with an orthographic camera at
 * ISO_CAMERA_ALPHA (30°) / ISO_CAMERA_BETA (45°), so occlusion is decided by the
 * z-buffer. Painter's order has to use the same quantity the z-buffer would:
 *
 *   depth = cos(a)sin(b)*x + sin(a)*y_up + cos(a)cos(b)*z
 *
 * With that camera one (rx+ry) step contributes ISO_HH screen units (14 here),
 * and one terrain level contributes sin(a)/cos(a)*... = 1/3 of a step, i.e.
 * ISO_HH/3. Sorting by screen y instead (the old key) moved a tank on a dune
 * 16px the wrong way and let the hull in front cover it.
 */
export function depthOf(wx: number, wy: number, z = 0) {
    return ((wx + wy) / TILE) * ISO_HH + z * ISO_DEPTH_PER_LEVEL;
}
