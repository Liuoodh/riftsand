/**
 * `[OverlayTypes]` section — trees, walls, ore, crates, rocks.
 *
 * Reference: redalert2/src/game/rules/OverlayRules.ts
 *
 * `radarInvisible` has a *derived* default: a wall or a rock stays off the radar
 * unless the rules say otherwise, while everything else shows up. That single
 * expression replaces what looks like a per-overlay flag.
 *
 * `noUseTileLandType` is a truthiness read (`!!string`), not a boolean parse: the
 * ini writes `NoUseTileLandType=1`, and any non-empty string counts.
 */
import { ObjectRules, ObjectRulesData } from './ObjectRules';
import { ArmorType } from '../type/ArmorType';
import { LandType } from '../type/LandType';
import type { ObjectType } from '../type/ObjectType';

export interface OverlayRulesData extends ObjectRulesData {
    armor?: ArmorType;
    crate?: boolean;
    isARock?: boolean;
    isRubble?: boolean;
    isVeinholeMonster?: boolean;
    isVeins?: boolean;
    land?: LandType;
    noUseTileLandType?: string | number | boolean;
    strength?: number;
    tiberium?: boolean;
    wall?: boolean;
    radarInvisible?: boolean;
}

export class OverlayRules extends ObjectRules {
    armor = ArmorType.None;
    crate = false;
    isARock = false;
    isRubble = false;
    isVeinholeMonster = false;
    isVeins = false;
    land = LandType.Clear;
    noUseTileLandType = false;
    strength = 0;
    tiberium = false;
    wall = false;
    radarInvisible = false;

    constructor(type: ObjectType, data: OverlayRulesData, generalRules: unknown = {}, index = -1) {
        super(data, type, index);
        this.parse(data);
    }

    protected parse(data: OverlayRulesData): void {
        super.parse(data);
        this.armor = data.armor ?? ArmorType.None;
        this.crate = !!data.crate;
        const isARock = !!data.isARock;
        this.isARock = isARock;
        this.isRubble = !!data.isRubble;
        this.isVeinholeMonster = !!data.isVeinholeMonster;
        this.isVeins = !!data.isVeins;
        this.land = data.land ?? LandType.Clear;
        this.noUseTileLandType = !!data.noUseTileLandType;
        this.strength = data.strength ?? 0;
        this.tiberium = !!data.tiberium;
        const isWall = !!data.wall;
        this.wall = isWall;
        this.radarInvisible = data.radarInvisible ?? (!isWall && !isARock);
    }
}
