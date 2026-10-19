/**
 * `[TerrainTypes]` section — the map props that sit *on* a cell (trees, rocks).
 *
 * Reference: redalert2/src/game/rules/TerrainRules.ts
 *
 * `occupationBits` decides which of the cell's five sub-cells a prop blocks. The
 * five sub-cells are laid out as: 0 = the cell itself, 1 = shared by all, 2 = right,
 * 3 = left, 4 = bottom — which is why `testOccupationBit` returns `true` for 0 and 1
 * regardless of the mask.
 *
 * `normalizeOccupationBits` folds an out-of-range mask back into `[0, 8)`. Retail
 * ships `OccupationBits=-1` on some trees, and a raw `-1` would make every bit test
 * pass by accident.
 */
import { ObjectRules, ObjectRulesData } from './ObjectRules';
import { TheaterType } from '../type/TheaterType';
import type { ObjectType } from '../type/ObjectType';

export enum OccupationBits {
    All = 7,
    Right = 1,
    Left = 2,
    Bottom = 4
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

export interface TerrainRulesData extends ObjectRulesData {
    animationRate?: number;
    animationProbability?: number;
    gate?: boolean;
    immune?: boolean;
    isAnimated?: boolean;
    snowOccupationBits?: number;
    spawnsTiberium?: boolean;
    strength?: number;
    radarInvisible?: boolean;
    temperateOccupationBits?: number;
}

export class TerrainRules extends ObjectRules {
    animationRate = 0;
    animationProbability = 0;
    gate = false;
    immune = false;
    isAnimated = false;
    snowOccupationBits = OccupationBits.All;
    spawnsTiberium = false;
    strength = 0;
    radarInvisible = false;
    temperateOccupationBits = OccupationBits.All;

    constructor(type: ObjectType, data: TerrainRulesData, generalRules: unknown = {}, index = -1) {
        super(data, type, index);
        this.parse(data);
    }

    protected parse(data: TerrainRulesData): void {
        super.parse(data);
        this.animationRate = data.animationRate ?? 0;
        this.animationProbability = data.animationProbability ?? 0;
        this.gate = !!data.gate;
        this.immune = !!data.immune;
        this.isAnimated = !!data.isAnimated;
        this.snowOccupationBits = this.normalizeOccupationBits(data.snowOccupationBits ?? OccupationBits.All);
        this.spawnsTiberium = !!data.spawnsTiberium;
        this.strength = data.strength ?? 0;
        this.radarInvisible = !!data.radarInvisible;
        this.temperateOccupationBits = this.normalizeOccupationBits(data.temperateOccupationBits ?? OccupationBits.All);
    }

    private normalizeOccupationBits(bits: number): number {
        return (bits + 8 * Math.abs(Math.floor(bits / 8))) % 8;
    }

    getOccupationBits(theaterType: TheaterType): number {
        return theaterType !== TheaterType.Snow
            ? this.temperateOccupationBits
            : this.snowOccupationBits;
    }

    getOccupiedSubCells(theaterType: TheaterType): number[] {
        const bits = this.getOccupationBits(theaterType);
        const allSubCells = [0, 1, 2, 3, 4];
        if (bits === OccupationBits.All) {
            return allSubCells;
        }
        const occupiedSubCells: number[] = [];
        for (const subCell of allSubCells) {
            if (testOccupationBit(subCell, bits)) {
                occupiedSubCells.push(subCell);
            }
        }
        return occupiedSubCells;
    }
}
