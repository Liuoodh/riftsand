/**
 * Same ring geometry as `RadialTileFinder`, walked from the **back** edge.
 *
 * Reference: redalert2/src/game/map/tileFinder/RadialBackFirstTileFinder.ts
 * (75 lines).
 *
 * A free unit emerging from a destroyed structure should appear *behind* it
 * (away from the camera), not in front. That is the only difference: the ring
 * is identical, the starting corner is the min-x/min-y one and the walk runs
 * left column upward, then the top edge, then the right column, then the
 * bottom edge.
 */
import type { Tile } from '../TileCollection';
import type { MapBounds } from '../MapBounds';

interface TileCollection {
    getByMapCoords(x: number, y: number): Tile | undefined;
}

interface Foundation {
    width: number;
    height: number;
}

export class RadialBackFirstTileFinder<T extends Tile = Tile> {
    private tiles: TileCollection;
    private mapBounds: MapBounds;
    private startTile: T;
    private foundation: Foundation;
    private maxDistance: number;
    private predicate: (tile: T) => boolean;
    private checkBounds: boolean;
    private distance: number;
    private generator: Generator<T | undefined>;

    constructor(
        tiles: TileCollection,
        mapBounds: MapBounds,
        startTile: T,
        foundation: Foundation,
        distance: number,
        maxDistance: number,
        predicate: (tile: T) => boolean,
        checkBounds: boolean = true,
    ) {
        this.tiles = tiles;
        this.mapBounds = mapBounds;
        this.startTile = startTile;
        this.foundation = foundation;
        this.maxDistance = maxDistance;
        this.predicate = predicate;
        this.checkBounds = checkBounds;
        this.distance = distance;
        this.generator = this.generate();
    }

    getNextTile(): T | undefined {
        return this.generator.next().value;
    }

    private *generate(): Generator<T | undefined> {
        const getTile = (x: number, y: number): T | undefined => {
            const tile = this.tiles.getByMapCoords(x, y) as T | undefined;
            if (tile && (!this.checkBounds || this.mapBounds.isWithinBounds(tile)) && this.predicate(tile)) {
                return tile as T;
            }
            return undefined;
        };

        do {
            const left = this.startTile.rx - this.distance;
            const top = this.startTile.ry - this.distance;
            const right = this.startTile.rx + this.foundation.width - 1 + this.distance;
            const bottom = this.startTile.ry + this.foundation.height - 1 + this.distance;

            if (this.distance > 0) {
                for (let y = top + 1; y < bottom; y++) {
                    const tile = getTile(left, y);
                    if (tile) yield tile;
                }
                for (let x = left; x < right; x++) {
                    const tile = getTile(x, top);
                    if (tile) yield tile;
                }
                for (let y = bottom - 1; y >= top; y--) {
                    const tile = getTile(right, y);
                    if (tile) yield tile;
                }
                for (let x = right; x >= left; x--) {
                    const tile = getTile(x, bottom);
                    if (tile) yield tile;
                }
            } else if (this.predicate(this.startTile)) {
                yield this.startTile;
            }
        } while (++this.distance <= this.maxDistance);
    }
}
