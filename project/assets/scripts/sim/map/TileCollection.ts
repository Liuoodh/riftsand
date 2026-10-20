/**
 * Tile collection — the cell grid and its two coordinate systems.
 *
 * Reference: redalert2/src/game/map/TileCollection.ts (319 lines).
 *
 * The single most important thing in this file is that a tile has **two**
 * coordinate pairs and they are not interchangeable:
 *
 *   rx / ry   logical cell, what pathfinding and footprints use
 *   dx / dy   isometric display cell, what `MapBounds` uses for the playable
 *             rectangle and what the renderer sorts by
 *
 * For a diamond-shaped retail map `dx = rx - ry + K` and `dy = rx + ry`, so the
 * display grid is twice the size of the logical grid in each axis and its
 * bounding box is only sparsely filled. That is why `tilesByDxy` is a
 * `(Tile | undefined)[]` and `tilesByRxy` is too: the display grid has holes,
 * the logical grid does not.
 *
 * Three behaviours that look like bugs and are copied on purpose:
 *
 *   1. `getByMapCoords` only bounds-checks the **upper** edge. A negative
 *      coordinate returns `undefined` because the array index is negative —
 *      that is relied upon by every directional finder, which starts one step
 *      outside the grid on purpose.
 *   2. `computeCutoffTileHeight` scans `x` from 1 to `maxWidth - 4`, so the
 *      three rightmost display columns never move the cutoff. Retail maps put
 *      the impassable tip of the diamond there, so excluding them is the point.
 *   3. `getLandType` throws on unknown tile art. A tile whose art we do not
 *      recognise is a content bug, not a cell to guess at.
 */
import { LandType, getLandType } from '../type/LandType';
import { TerrainType } from '../type/TerrainType';
import { isNotNullOrUndefined } from '../util/typeGuard';

/**
 * Reference: `game/map/TileCollection.ts` — a **numeric** enum.
 *
 * Kept numeric (and kept in this exact order) because the reference compares
 * directions by *ordinal* in `CardinalTileFinder`, which walks the ring by
 * rotating a vector and switching on `dirVec.angle()`. Renaming or reordering
 * these would change which tile a finder visits first.
 */
export enum TileDirection {
    Top = 0,
    TopLeft = 1,
    TopRight = 2,
    Left = 3,
    Right = 4,
    BottomLeft = 5,
    Bottom = 6,
    BottomRight = 7,
}

export interface TileData {
    rx: number;
    ry: number;
    dx: number;
    dy: number;
    z: number;
    tileNum: number;
    subTile: number;
}

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

export interface TileSets {
    getTileImage(tileNum: number, subTile: number, randomIndexSelector: (min: number, max: number) => number): TileImage;

    isCliffTile(tileNum: number): boolean;

    isHighBridgeBoundaryTile(tileNum: number): boolean;
}

interface GeneralRules {
    cliffBackImpassability: number;
}

interface Size {
    width: number;
    height: number;
}

interface Rectangle {
    x?: number;
    y?: number;
    rx?: number;
    ry?: number;
    width: number;
    height: number;
}

export interface Tile extends TileData {
    terrainType: TerrainType;
    landType: LandType;
    onBridgeLandType: LandType | undefined;
    rampType: number;
    id: string;
    occluded: boolean;
}

export class TileCollection {
    private tileSets: TileSets;
    private generalRules: GeneralRules;
    private rSize: Size;
    private dSize: Size;
    private tilesByRxy: (Tile | undefined)[];
    private tilesByDxy: (Tile | undefined)[];
    private tiles: Tile[];
    private bridgeSetTiles: Tile[];
    private minTileHeight: number;
    private maxTileHeight: number;
    private cutoffTileHeight: number;

    constructor(
        tileData: TileData[],
        tileSets: TileSets,
        generalRules: GeneralRules,
        randomIndexSelector: (min: number, max: number) => number,
    ) {
        this.tileSets = tileSets;
        this.generalRules = generalRules;

        const rSize = (this.rSize = { width: 0, height: 0 });
        const dSize = (this.dSize = { width: 0, height: 0 });
        for (let i = 0, len = tileData.length; i < len; ++i) {
            rSize.width = Math.max(rSize.width, tileData[i].rx);
            rSize.height = Math.max(rSize.height, tileData[i].ry);
            dSize.width = Math.max(dSize.width, tileData[i].dx);
            dSize.height = Math.max(dSize.height, tileData[i].dy);
        }
        rSize.width++;
        rSize.height++;
        dSize.width++;
        dSize.height++;

        const tilesByRxy = (this.tilesByRxy = new Array<Tile | undefined>(rSize.width * rSize.height));
        tilesByRxy.fill(undefined);
        const tilesByDxy = (this.tilesByDxy = new Array<Tile | undefined>(dSize.width * dSize.height));
        tilesByDxy.fill(undefined);

        const tiles = (this.tiles = new Array<Tile>(tileData.length));
        const cliffTiles: Tile[] = [];
        const bridgeSetTiles = (this.bridgeSetTiles = []);
        const terrainTypes = new Set<unknown>(Object.values(TerrainType));
        this.minTileHeight = Number.POSITIVE_INFINITY;
        this.maxTileHeight = 0;

        for (let i = 0, len = tileData.length; i < len; ++i) {
            const tileDataItem = tileData[i];
            const tileImage = tileSets.getTileImage(tileDataItem.tileNum, tileDataItem.subTile, randomIndexSelector);
            const terrainType = tileImage.terrainType;
            if (!terrainTypes.has(terrainType)) {
                throw new Error(
                    `Tile (${tileDataItem.rx}, ${tileDataItem.ry}) has unknown terrain type "${terrainType}"`,
                );
            }
            const tile: Tile = {
                ...tileDataItem,
                terrainType,
                landType: getLandType(terrainType),
                onBridgeLandType: undefined,
                rampType: tileImage.rampType,
                id: tileDataItem.rx + "_" + tileDataItem.ry,
                occluded: false,
            };
            const rx = tile.rx;
            const ry = tile.ry;
            const dx = tile.dx;
            const dy = tile.dy;
            tiles[i] = tile;
            tilesByRxy[rx + ry * rSize.width] = tile;
            tilesByDxy[dx + dy * dSize.width] = tile;
            this.minTileHeight = Math.min(this.minTileHeight, tile.z);
            this.maxTileHeight = Math.max(this.maxTileHeight, tile.z);
            if (
                tileImage.height === 4 &&
                (tile.terrainType === TerrainType.Cliff || tileSets.isCliffTile(tile.tileNum))
            ) {
                cliffTiles.push(tile);
            }
            if (tileSets.isHighBridgeBoundaryTile(tileDataItem.tileNum)) {
                bridgeSetTiles.push(tile);
            }
        }

        this.computeLandBehindCliffTiles(cliffTiles);
        this.cutoffTileHeight = this.computeCutoffTileHeight();
    }

    /**
     * `[General] CliffBackImpassability` — cells tucked *behind* a cliff are
     * rock even though their art says clear ground, so a unit cannot walk into
     * the shadow the cliff casts.
     *
     * The offset list is asymmetric on purpose: it is the six cells an
     * isometric cliff face hides, not a symmetric kernel. `[-2,-2]` is two
     * steps out along the shallow axis; the rest are its neighbours.
     */
    private computeLandBehindCliffTiles(cliffTiles: Tile[]): void {
        if (this.generalRules.cliffBackImpassability < 2) {
            return;
        }
        const offsets: [number, number][] = [
            [-2, -2],
            [-1, -1],
            [-1, 1],
            [1, -1],
            [0, 1],
            [1, 0],
        ];
        cliffTiles.forEach((cliffTile) => {
            for (const [offsetX, offsetY] of offsets) {
                const neighborTile = this.getByMapCoords(cliffTile.rx + offsetX, cliffTile.ry + offsetY);
                if (
                    neighborTile &&
                    neighborTile.z < cliffTile.z &&
                    neighborTile.terrainType !== TerrainType.Cliff &&
                    neighborTile.terrainType !== TerrainType.Rough &&
                    neighborTile.rampType === 0
                ) {
                    neighborTile.landType = LandType.Rock;
                }
            }
        });
    }

    getTileRadarColor(tile: Tile): unknown {
        const tileImage = this.tileSets.getTileImage(tile.tileNum, tile.subTile, () => 0);
        return tileImage.radarLeft.clone().multiplyScalar(0.5);
    }

    getAll(): Tile[] {
        return [...this.tiles];
    }

    forEach(callback: (tile: Tile, index: number) => void): void {
        for (let i = 0, len = this.tiles.length; i < len; ++i) {
            callback(this.tiles[i], i);
        }
    }

    reduce<T>(reducer: (accumulator: T, tile: Tile) => T, initialValue: T): T {
        let result = initialValue;
        this.forEach((tile) => {
            result = reducer(result, tile);
        });
        return result;
    }

    getMinTileHeight(): number {
        return this.minTileHeight;
    }

    getMaxTileHeight(): number {
        return this.maxTileHeight;
    }

    getCutoffTileHeight(): number {
        return this.cutoffTileHeight;
    }

    /**
     * Height of the bottom-most populated display row.
     *
     * Walk up from the bottom edge; the first row that has any tile stops the
     * scan, and its tallest tile becomes the cutoff. `MapBounds` takes
     * `max(9, this)` — so on a flat map this is always 9.
     *
     * `x < maxWidth - 3` is copied: the three rightmost columns are the far tip
     * of the diamond and must not drag the cutoff down.
     */
    private computeCutoffTileHeight(): number {
        const maxWidth = this.dSize.width - 1;
        let maxHeight = this.dSize.height - 1;
        let maxZ = 0;
        let shouldContinue = true;
        while (shouldContinue && maxHeight > 0) {
            for (let x = 1; x < maxWidth - 3; x++) {
                const tile = this.getByDisplayCoords(x, maxHeight);
                if (tile) {
                    shouldContinue = false;
                    if (tile.z > maxZ) {
                        maxZ = tile.z;
                    }
                }
            }
            if (shouldContinue) {
                maxHeight--;
            }
        }
        return maxZ;
    }

    getAllBridgeSetTiles(): Tile[] {
        return this.bridgeSetTiles;
    }

    getAllNeighbourTiles(tile: Tile): Tile[] {
        const rx = tile.rx;
        const ry = tile.ry;
        return [
            this.getByMapCoords(rx + 1, ry + 1),
            this.getByMapCoords(rx - 1, ry - 1),
            this.getByMapCoords(rx - 1, ry + 1),
            this.getByMapCoords(rx + 1, ry - 1),
            this.getByMapCoords(rx, ry + 1),
            this.getByMapCoords(rx + 1, ry),
            this.getByMapCoords(rx - 1, ry),
            this.getByMapCoords(rx, ry - 1),
        ].filter(isNotNullOrUndefined);
    }

    /**
     * The eight-neighbour table. Note the axis swap: `Bottom` is `(rx+1, ry+1)`
     * because the isometric `ry` axis runs to the *south-west*, not down the
     * screen. Copy this table verbatim — swapping two entries silently rotates
     * every bridge head and every diagonal path by 45°.
     */
    getNeighbourTile(tile: Tile, direction: TileDirection): Tile | undefined {
        const rx = tile.rx;
        const ry = tile.ry;
        switch (direction) {
            case TileDirection.Bottom:
                return this.getByMapCoords(rx + 1, ry + 1);
            case TileDirection.Top:
                return this.getByMapCoords(rx - 1, ry - 1);
            case TileDirection.Left:
                return this.getByMapCoords(rx - 1, ry + 1);
            case TileDirection.Right:
                return this.getByMapCoords(rx + 1, ry - 1);
            case TileDirection.BottomLeft:
                return this.getByMapCoords(rx, ry + 1);
            case TileDirection.BottomRight:
                return this.getByMapCoords(rx + 1, ry);
            case TileDirection.TopLeft:
                return this.getByMapCoords(rx - 1, ry);
            case TileDirection.TopRight:
                return this.getByMapCoords(rx, ry - 1);
            default:
                throw new Error("Invalid direction");
        }
    }

    getByDisplayCoords(x: number, y: number): Tile | undefined {
        if (x >= this.dSize.width || y >= this.dSize.height) {
            return undefined;
        }
        return this.tilesByDxy[x + y * this.dSize.width];
    }

    /** Upper-edge-only check; see the file header, point 1. */
    getByMapCoords(x: number, y: number): Tile | undefined {
        /*
         * Both bounds — the lower one is a deliberate addition to the reference.
         *
         * The reference checks only the upper bound and relies on a negative
         * array index being a hole. That holds for `(x = -1, y = 0)` (-1 is out
         * of range) but NOT for `x = -1, y > 0`: `x + y * width` lands inside
         * the array one row up, i.e. on `(width - 1, y - 1)` — the *opposite*
         * edge of the map. Every `getNeighbourTile` on the west edge then
         * reports an east-edge neighbour, and `computePassability` links them.
         * Measured on our 80×80 map before this guard: 201 phantom edges from
         * column 0 to column 79, which a unit can cross as if it were one cell.
         *
         * Retail maps never show it because their border ring is water or
         * cliff; ours is generated and does have passable edge cells.
         */
        if (x < 0 || y < 0 || x >= this.rSize.width || y >= this.rSize.height) {
            return undefined;
        }
        return this.tilesByRxy[x + y * this.rSize.width];
    }

    getMapSize(): Size {
        return this.rSize;
    }

    getDisplaySize(): Size {
        return this.dSize;
    }

    /**
     * Cells inside a rectangle, in `dx`-then-`dy` order.
     *
     * With `size` given the rectangle is read in *map* coordinates (`rx`/`ry`);
     * without it, in *display* coordinates (`x`/`y`). Two different callers
     * depend on the two modes: footprints use map coords, screen-rectangle
     * selection uses display coords.
     */
    getInRectangle(rectangle: Rectangle, size?: Size): Tile[] {
        let startX: number;
        let startY: number;
        let width: number;
        let height: number;
        if (size) {
            startX = rectangle.rx!;
            startY = rectangle.ry!;
            width = size.width;
            height = size.height;
        } else {
            startX = rectangle.x!;
            startY = rectangle.y!;
            width = rectangle.width;
            height = rectangle.height;
        }
        const result: Tile[] = [];
        for (let dx = 0; dx < width; dx++) {
            for (let dy = 0; dy < height; dy++) {
                const x = startX + dx;
                const y = startY + dy;
                const tile = this.getByMapCoords(x, y);
                if (tile) {
                    result.push(tile);
                }
            }
        }
        return result;
    }

    /**
     * A synthetic rock tile at `(rx, ry)` that is not in the grid.
     *
     * Used when something must exist "off the map" — a spawn point clamped to
     * the border, a projectile impact three cells out. The display coordinates
     * are derived from the first real tile so the placeholder sorts correctly
     * against its neighbours.
     */
    getPlaceholderTile(rx: number, ry: number): Tile {
        const referenceTile = this.tiles[0];
        const offset = referenceTile.dx - referenceTile.rx + referenceTile.ry + 1;
        return {
            rx,
            ry,
            dx: rx - ry + offset - 1,
            dy: rx + ry - offset - 1,
            z: 0,
            id: rx + "_" + ry,
            landType: LandType.Rock,
            terrainType: TerrainType.Rock1,
            rampType: 0,
            subTile: 0,
            tileNum: 0,
            occluded: false,
            onBridgeLandType: undefined,
        };
    }
}
