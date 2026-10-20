/**
 * Wall autotiling — which of the 16 neighbour combinations a wall segment has.
 *
 * Reference: redalert2/src/game/map/wallTypes.ts (verbatim).
 *
 * Index `i` is a 4-bit mask of `[top, right, bottom, left]` neighbours; the
 * array maps it to the four art frame indices in the order the theater uses.
 * The order is bit-reversed relative to the mask, which is why row 1 is
 * `[1,0,0,0]` and not `[0,0,0,1]` — copy, do not recompute.
 */
export const wallTypes = [
    [0, 0, 0, 0],
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [1, 1, 0, 0],
    [0, 0, 1, 0],
    [1, 0, 1, 0],
    [0, 1, 1, 0],
    [1, 1, 1, 0],
    [0, 0, 0, 1],
    [1, 0, 0, 1],
    [0, 1, 0, 1],
    [1, 1, 0, 1],
    [0, 0, 1, 1],
    [1, 0, 1, 1],
    [0, 1, 1, 1],
    [1, 1, 1, 1],
];
