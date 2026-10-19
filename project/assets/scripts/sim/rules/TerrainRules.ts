/**
 * Land / speed / occupation rules.
 *
 * Port of:
 *   redalert2/src/game/type/LandType.ts
 *   redalert2/src/game/type/SpeedType.ts
 *   redalert2/src/game/rules/TerrainRules.ts
 *   redalert2/src/game/rules/LandRules.ts
 *
 * The reference keeps one LandRules object per `[Clear]`, `[Road]`, ... section
 * of rules.ini. Each section lists a speed *percentage* per SpeedType, and
 * `getSpeedModifier` collapses it to the handful of values the movement code
 * actually consumes:
 *
 *   - Foot uses the Foot column, with one special case: if Track is 0 the tile
 *     is impassable on foot too (a wall is a wall).
 *   - Track and Wheel use their own columns.
 *   - For every other speed type the *magnitude* is irrelevant; the tile is
 *     either passable (1) or not (0). Hover does not get a 0.9 multiplier in
 *     retail, it gets the same speed as tracked movement.
 *
 * Retail rules.ini stores 100/80/70; our world works in multipliers, so the
 * table below is the same data divided by 100. Nothing else changes.
 */
import { TileKind } from '../../world/Terrain';

export enum LandType {
    Clear = 0,
    Road = 1,
    Rock = 2,
    Beach = 3,
    Rough = 4,
    Railroad = 5,
    Weeds = 6,
    Water = 7,
    Wall = 8,
    Tiberium = 9,
    Cliff = 10,
}

export enum SpeedType {
    Foot = 0,
    Track = 1,
    Wheel = 2,
    Hover = 3,
    Float = 4,
    FloatBeach = 5,
    Amphibious = 6,
    Winged = 7,
}

/** OccupationBits — which sub-cells of a cell a terrain object blocks. */
export enum OccupationBits {
    All = 7,
    Right = 1,
    Left = 2,
    Bottom = 4,
}

export function testOccupationBit(subCell: number, bits: number): boolean {
    switch (subCell) {
        case 0:
        case 1:
            return true;
        case 2:
            return (bits & OccupationBits.Right) !== 0;
        case 3:
            return (bits & OccupationBits.Left) !== 0;
        case 4:
            return (bits & OccupationBits.Bottom) !== 0;
        default:
            throw new Error(`Invalid subCell "${subCell}"`);
    }
}

export function getOccupiedSubCells(bits: number): number[] {
    const all = [0, 1, 2, 3, 4];
    if (bits === OccupationBits.All) return all;
    return all.filter((subCell) => testOccupationBit(subCell, bits));
}

/** `[LandType]` section: one speed column per SpeedType. */
export interface LandRule {
    buildable: boolean;
    /** keyed by SpeedType; missing = 0 */
    speed: Partial<Record<SpeedType, number>>;
    /** retail flag: a wall can be crushed by tracked units? (unused here) */
    wall?: boolean;
}

/**
 * Verbatim from rules.ini's `[Clear] [Road] [Rough] [Rock] [Tiberium] [Water]
 * [Wall] [Cliff]` sections, scaled to multipliers.
 *
 * Beach / Railroad / Weeds are not produced by our generator but are listed so
 * a future tileset can use them without touching the movement code.
 */
export const LAND_RULES: Record<LandType, LandRule> = {
    [LandType.Clear]: { buildable: true, speed: { [SpeedType.Foot]: 1, [SpeedType.Track]: 1, [SpeedType.Wheel]: 1 } },
    [LandType.Road]: { buildable: true, speed: { [SpeedType.Foot]: 1, [SpeedType.Track]: 1, [SpeedType.Wheel]: 1 } },
    [LandType.Rock]: { buildable: false, speed: { [SpeedType.Foot]: 0.8, [SpeedType.Track]: 0.7, [SpeedType.Wheel]: 0.6 } },
    [LandType.Beach]: { buildable: true, speed: { [SpeedType.Foot]: 0.8, [SpeedType.Track]: 0.7, [SpeedType.Wheel]: 0.6 } },
    [LandType.Rough]: { buildable: true, speed: { [SpeedType.Foot]: 0.8, [SpeedType.Track]: 0.7, [SpeedType.Wheel]: 0.5 } },
    [LandType.Railroad]: { buildable: false, speed: { [SpeedType.Foot]: 1, [SpeedType.Track]: 1, [SpeedType.Wheel]: 1 } },
    [LandType.Weeds]: { buildable: true, speed: { [SpeedType.Foot]: 1, [SpeedType.Track]: 1, [SpeedType.Wheel]: 1 } },
    [LandType.Water]: { buildable: false, speed: {} },
    [LandType.Wall]: { buildable: false, speed: {}, wall: true },
    [LandType.Tiberium]: { buildable: false, speed: { [SpeedType.Foot]: 0.9, [SpeedType.Track]: 0.8, [SpeedType.Wheel]: 0.7 } },
    [LandType.Cliff]: { buildable: false, speed: {} },
};

export function getLandRules(landType: LandType): LandRule {
    return LAND_RULES[landType] ?? LAND_RULES[LandType.Clear];
}

/**
 * Port of LandRules.getSpeedModifier.
 *
 * The three early-outs look redundant but each one changes behaviour:
 *   - a Track=0 tile is also impassable on foot;
 *   - an unknown column means "1" (passable at normal speed), not 0;
 *   - a non Track/Wheel type with a positive modifier is clamped to exactly 1,
 *     which is why hover skirts never get the tiberium slowdown.
 */
export function getSpeedModifier(landType: LandType, speedType: SpeedType): number {
    const rule = getLandRules(landType);
    if (speedType === SpeedType.Foot && rule.speed[SpeedType.Track] === 0) return 0;
    let modifier = rule.speed[speedType];
    if (modifier === undefined) modifier = 1;
    if (speedType !== SpeedType.Track && speedType !== SpeedType.Wheel && modifier > 0) modifier = 1;
    return modifier;
}

/**
 * TileKind (our generator) -> LandType (the reference vocabulary).
 *
 * `solid` is the map's own wall flag (rock ridges, water, blocking props), so a
 * solid rock cell becomes Cliff — that is the reference's "you cannot drive up
 * this" land type — while a decorative rock plateau stays Rock.
 */
export function getLandType(kind: TileKind, solid: boolean): LandType {
    switch (kind) {
        case TileKind.Dune:
            return LandType.Rough;
        case TileKind.Rock:
            return solid ? LandType.Cliff : LandType.Rock;
        case TileKind.Crystal:
            return LandType.Tiberium;
        case TileKind.Road:
            return LandType.Road;
        case TileKind.Water:
            return LandType.Water;
        default:
            return solid ? LandType.Cliff : LandType.Clear;
    }
}

/** inverse, used by rules that ask "what terrain is under this wall?" */
export function landTypeToTileKind(landType: LandType): TileKind {
    switch (landType) {
        case LandType.Rough:
            return TileKind.Dune;
        case LandType.Rock:
        case LandType.Cliff:
            return TileKind.Rock;
        case LandType.Tiberium:
            return TileKind.Crystal;
        case LandType.Road:
            return TileKind.Road;
        case LandType.Water:
            return TileKind.Water;
        default:
            return TileKind.Sand;
    }
}
