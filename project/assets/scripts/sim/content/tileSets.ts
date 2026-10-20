/**
 * Our theater: six procedurally generated land kinds, expressed in the
 * engine's vocabulary.
 *
 * This is the content half of the map layer. The engine (`TileCollection`,
 * `Terrain`, `Bridges`) asks nine questions through `TileSets`; this file
 * answers them for a map that was generated, not loaded from a `.map` file and
 * a `.tmp` tile set.
 *
 * The mapping is the interesting part, because our `TileKind` is *not* the same
 * kind of thing as `TerrainType`:
 *
 *   - `Crystal` is **not** a terrain type. Ore in the reference engine is an
 *     *overlay* that occupies a cell, and the cell's land class becomes
 *     `Tiberium` only while the overlay is there. So a crystal cell reports
 *     `TerrainType.Clear` here, and the ore overlay registered separately is
 *     what makes the ground slow. Mapping it straight to a terrain type would
 *     hard-code a speed penalty into the art and leave harvested-out cells
 *     permanently slow.
 *   - `Dune` maps to `Rough`, which is the retail land class with the 0.84-ish
 *     tracked penalty — not to a sand-specific class, because there is none.
 *   - `Road` maps to `Pavement` (→ `LandType.Road`) rather than keeping its own
 *     identity, so the road speed bonus comes from the same `[Road]` table the
 *     reference uses.
 *
 * `z` is our integer level, which the height field already smooths into ramps
 * between neighbours; `rampType` therefore stays 0 everywhere. The reference
 * needs `rampType` because its art is a pre-rendered tile with a fixed slope;
 * ours is generated from a corner height field, so the slope is implicit.
 */
import { MAP_TILES } from '../../core/Core';
import { TileKind } from '../../world/Terrain';
import { TerrainType } from '../type/TerrainType';
import { TileData } from '../map/TileCollection';
import { TileImage, TileSets, TileSetEntry, HighBridgeHeadType, TileSets_oppositeHeadType } from '../theater/TileSets';

/**
 * Tile kind → terrain type.
 *
 * Exported because `Game` needs the same table when it decides whether a cell
 * needs an ore overlay.
 *
 * The last entry is not a `TileKind` — it is the virtual tile number 6, used for
 * **solid** rock. That split matters: `[Rock]` in the land rules is passable but
 * slow (Track=0.7) while `Cliff` is impassable, so mapping a ridge to
 * `TerrainType.Rock1` would quietly turn every rock barrier into a slow road.
 * A generator that marks a cell `solid` means "cannot be entered", and `Cliff`
 * is the only land class that says exactly that.
 */
export const TERRAIN_TYPE_OF_KIND: readonly TerrainType[] = [
    /* Sand    */ TerrainType.Clear,
    /* Dune    */ TerrainType.Rough,
    /* Rock    */ TerrainType.Rock1,
    /* Crystal */ TerrainType.Clear,
    /* Road    */ TerrainType.Pavement,
    /* Water   */ TerrainType.Water,
    /* SolidRock (virtual) */ TerrainType.Cliff,
];

/** The virtual tile number that means "impassable rock". */
export const TILE_NUM_SOLID_ROCK = 6;

/** Minimap colour per kind, as a three-byte triple scaled at read time. */
const RADAR_RGB_OF_KIND: readonly [number, number, number][] = [
    /* Sand    */ [198, 176, 122],
    /* Dune    */ [176, 152, 100],
    /* Rock    */ [104, 96, 88],
    /* Crystal */ [206, 178, 64],
    /* Road    */ [150, 142, 132],
    /* Water   */ [56, 92, 138],
    /* SolidRock */ [88, 82, 76],
];

/**
 * The minimap colour object `TileCollection.getTileRadarColor` clones and
 * halves. Deliberately a tiny class rather than a `Color` instance: the engine
 * only ever calls `clone().multiplyScalar(0.5)`, and matching that exact shape
 * keeps the call site identical.
 */
class RadarColor {
    constructor(private rgb: [number, number, number]) {}

    clone(): RadarColor {
        return new RadarColor([this.rgb[0], this.rgb[1], this.rgb[2]]);
    }

    multiplyScalar(factor: number): RadarColor {
        this.rgb = [this.rgb[0] * factor, this.rgb[1] * factor, this.rgb[2] * factor];
        return this;
    }

    toRgb(): [number, number, number] {
        return this.rgb;
    }
}

/**
 * `TileSets` for a generated theater: no cliffs, no bridges, no animations.
 *
 * All three "is this special art" questions answer false. That is not a stub —
 * it is the truth for a map built from six flat land kinds. `getGeneralValue`
 * returns -1 for every key, which makes `Bridges` classify every bridge as
 * `Concrete` when bridges eventually exist; that value is a real default and
 * not an error marker.
 */
export class ProceduralTileSets implements TileSets {
    getTile(tileNum: number): TileSetEntry | undefined {
        return tileNum >= 0 && tileNum < TERRAIN_TYPE_OF_KIND.length ? { index: tileNum } : undefined;
    }

    getTileImage(tileNum: number): TileImage {
        const kind = tileNum < TERRAIN_TYPE_OF_KIND.length ? tileNum : TileKind.Sand;
        const rgb = RADAR_RGB_OF_KIND[kind];
        return {
            terrainType: TERRAIN_TYPE_OF_KIND[kind],
            rampType: 0,
            height: 0,
            radarLeft: new RadarColor([rgb[0], rgb[1], rgb[2]]),
        };
    }

    getSetNum(tileNum: number): number {
        return tileNum;
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

/** What `buildTileData` needs from the generator. */
export interface TerrainSource {
    kind: Uint8Array;
    level: Uint8Array;
    /** 1 = impassable ridge; promoted to `Cliff` so the land class is honest */
    solid: Uint8Array;
}

/**
 * Turn the generated grid into the `TileData[]` the engine expects.
 *
 * The two coordinate systems are derived here, once:
 *
 *   rx / ry  the cell itself
 *   dx / dy  isometric display coordinates, `dx = rx - ry + (N-1)`, `dy = rx + ry`
 *
 * With that offset both display axes span `[0, 2(N-1)]`, which is exactly the
 * `2 * mapSize` range `MapBounds.fromMapFile` expects. Shifting by `N-1`
 * instead of `0` is what keeps `dx` non-negative; a negative `dx` would index
 * outside the display array and silently drop the tile.
 */
export function buildTileData(terrain: TerrainSource, size: number = MAP_TILES): TileData[] {
    const offset = size - 1;
    const tileData: TileData[] = new Array(size * size);
    let index = 0;
    for (let ry = 0; ry < size; ry++) {
        for (let rx = 0; rx < size; rx++) {
            const i = ry * size + rx;
            const kind = terrain.kind[i];
            tileData[index++] = {
                rx,
                ry,
                dx: rx - ry + offset,
                dy: rx + ry,
                z: terrain.level[i],
                tileNum:
                    kind === TileKind.Rock && terrain.solid[i] === 1 ? TILE_NUM_SOLID_ROCK : kind,
                subTile: 0,
            };
        }
    }
    return tileData;
}
