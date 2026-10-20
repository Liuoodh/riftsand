/**
 * Verbatim from redalert2/src/game/theater/rampHeights.ts.
 *
 * One row per `rampType`, four heights in the order
 * `[ (0,0), (1,0), (0,1), (1,1) ]` — i.e. the corners of the cell in
 * *normalised tile* space. `ObjectPosition.interpolateRampHeight` bilinearly
 * blends them, which is the whole reason a tank driving up a slope has a
 * smooth world Y instead of four discrete steps.
 *
 * Rows 19 and 20 are duplicates of 17 and 18 in retail; that is not a typo
 * here, the theater INI really does define 21 ramps and reuses two shapes.
 */
export const rampHeights: readonly (readonly number[])[] = [
    [0, 0, 0, 0],
    [0, 0, 1, 1],
    [1, 0, 0, 1],
    [1, 1, 0, 0],
    [0, 1, 1, 0],
    [0, 0, 0, 1],
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [1, 0, 1, 1],
    [1, 1, 0, 1],
    [1, 1, 1, 0],
    [0, 1, 1, 1],
    [1, 0, 1, 2],
    [2, 1, 0, 1],
    [1, 2, 1, 0],
    [0, 1, 2, 1],
    [1, 0, 1, 0],
    [0, 1, 0, 1],
    [1, 0, 1, 0],
    [0, 1, 0, 1],
];
