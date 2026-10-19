/**
 * Port of redalert2/src/game/map/wallTypes.ts.
 *
 * The 16 wall connection states, indexed by a 4-bit mask:
 *   bit 0 = a wall to the north, bit 1 = east, bit 2 = south, bit 3 = west.
 *
 * Index 0 (isolated pillar) through 15 (four-way). The array order is the
 * overlay frame order, so `findWallType()` returning the index is also the art
 * frame — that is why the table is spelled out instead of computed.
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
