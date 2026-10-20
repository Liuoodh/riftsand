/**
 * Concentric square rings, one ring per distance, yielding accepted tiles.
 *
 * Reference: redalert2/src/game/map/tileFinder/RadialTileFinder.ts (75 lines).
 *
 * The ring order inside a single distance is bottom row → right column → top
 * row → left column, going right-to-left and bottom-to-top. That order is *not*
 * arbitrary: `Warhead.detonate` iterates all tiles within `cellSpread` and the
 * per-tile processing order decides which object is recorded as the direct hit
 * when two overlap, so the walk has to stay bit-identical to retail.
 *
 * Distance 0 yields only the start tile, and only if the predicate accepts it.
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

export class RadialTileFinder<T extends Tile = Tile> {
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
        checkBounds = true,
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
                for (let x = right; x >= left; x--) {
                    const tile = getTile(x, bottom);
                    if (tile) yield tile;
                }
                for (let y = bottom - 1; y >= top; y--) {
                    const tile = getTile(right, y);
                    if (tile) yield tile;
                }
                for (let x = left; x < right; x++) {
                    const tile = getTile(x, top);
                    if (tile) yield tile;
                }
                for (let y = top + 1; y < bottom; y++) {
                    const tile = getTile(left, y);
                    if (tile) yield tile;
                }
            } else if (this.predicate(this.startTile)) {
                yield this.startTile;
            }
        } while (++this.distance <= this.maxDistance);
    }
}
