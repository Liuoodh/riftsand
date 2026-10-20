/**
 * Tile-set abstraction — the seam between the engine's map code and whatever
 * produces tile art.
 *
 * Reference: redalert2/src/game/theater/TileSets.ts (271 lines).
 *
 * The reference class parses `theater.ini`, enumerates `TileSetNNNN` sections
 * and loads `.tmp` files through the VFS. All of that is *content* — it belongs
 * to the original game's asset pipeline, which we are not copying (our tiles are
 * PNG frames chosen by a procedural generator).
 *
 * What the engine actually needs from it is nine questions, listed below. They
 * are kept with the reference's exact names and semantics so `Bridges` and
 * `TileCollection` read like the original:
 *
 *   getTileImage / isCliffTile / isHighBridgeBoundaryTile   → TileCollection
 *   getTile / getSetNum / getGeneralValue                   → Bridges
 *   getHighBridgeHeadType / getOppositeHighBridgeHeadType   → Bridges
 *   isHighBridgeMiddleTile                                  → Bridges
 *
 * `HighBridgeHeadType` is copied verbatim: it is a vocabulary, not a loader,
 * and `Bridges` compares against its members by name.
 */
import { TerrainType } from '../type/TerrainType';

/**
 * Reference: `game/theater/TileSets.ts`.
 *
 * The ids are meaningless on their own — `Bridges` only uses them to decide
 * which direction a bridge head faces and to pick the opposite head. The
 * distinction between `Middle*` and the four corners is load-bearing: a middle
 * tile has no opposite, and calling `getOppositeHighBridgeHeadType` on one
 * throws.
 */
export enum HighBridgeHeadType {
    TopLeft = 0,
    BottomRight = 1,
    TopRight = 2,
    BottomLeft = 3,
    MiddleTlBr = 4,
    MiddleTrBl = 5,
}

/**
 * One tile image. `TileCollection` reads exactly four fields off it:
 * `terrainType` (→ LandType), `rampType` (slope art), `height` (4 marks a
 * cliff piece) and `radarLeft` (the minimap colour).
 */
export interface TileImage {
    terrainType: TerrainType;
    rampType: number;
    height: number;
    radarLeft: {
        clone(): {
            multiplyScalar(factor: number): unknown;
        };
    };
}

/** Reference: `game/theater/TileSetEntry.ts`, reduced to what the map code reads. */
export interface TileSetEntry {
    /** position inside the owning tile set — `Bridges` uses it for head lookup */
    index: number;
}

export interface TileSets {
    getTile(tileNum: number): TileSetEntry | undefined;

    getTileImage(tileNum: number, subTile: number, randomIndexSelector: (min: number, max: number) => number): TileImage;

    /** index of the tile set that owns `tileNum` */
    getSetNum(tileNum: number): number;

    /** a named number from the theater's `[General]` section */
    getGeneralValue(key: string): number;

    getHighBridgeHeadType(tileIndex: number): HighBridgeHeadType | undefined;

    getOppositeHighBridgeHeadType(headType: HighBridgeHeadType): HighBridgeHeadType;

    isCliffTile(tileNum: number): boolean;

    isHighBridgeBoundaryTile(tileNum: number): boolean;

    isHighBridgeMiddleTile(tileNum: number): boolean;
}

/**
 * A map with no bridges and no cliffs.
 *
 * This is not a stub to be replaced later — it is the correct answer for a
 * theater that has neither. `TileCollection` calls three of these per tile, so
 * they are deliberately allocation-free and total (no throws).
 */
export class FlatTileSets implements TileSets {
    constructor(
        private image: (tileNum: number, subTile: number) => TileImage,
        private setNum: (tileNum: number) => number = () => 0,
    ) {}

    getTile(tileNum: number): TileSetEntry | undefined {
        return { index: tileNum };
    }

    getTileImage(tileNum: number, subTile: number): TileImage {
        return this.image(tileNum, subTile);
    }

    getSetNum(tileNum: number): number {
        return this.setNum(tileNum);
    }

    getGeneralValue(): number {
        return -1;
    }

    getHighBridgeHeadType(): undefined {
        return undefined;
    }

    getOppositeHighBridgeHeadType(headType: HighBridgeHeadType): HighBridgeHeadType {
        return TileSets_oppositeHeadType(headType);
    }

    isCliffTile(): boolean {
        return false;
    }

    isHighBridgeBoundaryTile(): boolean {
        return false;
    }

    isHighBridgeMiddleTile(): boolean {
        return false;
    }
}

/**
 * Reference: `TileSets.getOppositeHighBridgeHeadType`.
 *
 * Extracted as a free function so a theater with no bridges can still answer
 * it — `Bridges.findClosestBridgeSpec` calls it on the *found* head type,
 * which only happens when a bridge actually exists.
 */
export function TileSets_oppositeHeadType(headType: HighBridgeHeadType): HighBridgeHeadType {
    switch (headType) {
        case HighBridgeHeadType.TopLeft:
            return HighBridgeHeadType.BottomRight;
        case HighBridgeHeadType.TopRight:
            return HighBridgeHeadType.BottomLeft;
        case HighBridgeHeadType.BottomLeft:
            return HighBridgeHeadType.TopRight;
        case HighBridgeHeadType.BottomRight:
            return HighBridgeHeadType.TopLeft;
        case HighBridgeHeadType.MiddleTlBr:
        case HighBridgeHeadType.MiddleTrBl:
            throw new Error("Middle bridge heads can't have opposites");
        default:
            throw new Error(`Unhandled headType ${headType}`);
    }
}
