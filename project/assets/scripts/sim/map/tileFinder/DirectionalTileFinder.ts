/**
 * Walks a single direction, yielding the first accepted tile at each distance.
 *
 * Reference: redalert2/src/game/map/tileFinder/DirectionalTileFinder.ts (49 lines).
 *
 * `maxDistance` is absolute, not a count of steps: the finder starts at
 * `distance` and stops when it reaches `maxDistance`. `checkBounds: false` is
 * used when scanning a structure's own placement where out-of-bounds cells are
 * meaningful (a bridge head may legitimately sit on the map edge).
 */
import type { Tile } from '../TileCollection';
import type { MapBounds } from '../MapBounds';

interface TileCollection {
    getByMapCoords(x: number, y: number): Tile | undefined;
}

export class DirectionalTileFinder<T extends Tile = Tile> {
    private tiles: TileCollection;
    private mapBounds: MapBounds;
    private startTile: T;
    private maxDistance: number;
    private dirX: number;
    private dirY: number;
    private predicate: (tile: T) => boolean;
    private checkBounds: boolean;
    private finished: boolean;
    private distance: number;

    constructor(
        tiles: TileCollection,
        mapBounds: MapBounds,
        startTile: T,
        distance: number,
        maxDistance: number,
        dirX: number,
        dirY: number,
        predicate: (tile: T) => boolean = () => true,
        checkBounds: boolean = true,
    ) {
        this.tiles = tiles;
        this.mapBounds = mapBounds;
        this.startTile = startTile;
        this.maxDistance = maxDistance;
        this.dirX = dirX;
        this.dirY = dirY;
        this.predicate = predicate;
        this.checkBounds = checkBounds;
        this.finished = false;
        this.distance = distance;
    }

    getNextTile(): T | undefined {
        if (!this.finished) {
            let result: T | undefined;
            do {
                const coords = { x: this.startTile.rx, y: this.startTile.ry };
                coords.x += this.distance * Math.sign(this.dirX);
                coords.y += this.distance * Math.sign(this.dirY);
                const tile = this.tiles.getByMapCoords(coords.x, coords.y) as T | undefined;
                if (
                    (tile &&
                        (!this.checkBounds || this.mapBounds.isWithinBounds(tile)) &&
                        this.predicate(tile) &&
                        (result = tile as T),
                    this.maxDistance && this.distance >= this.maxDistance)
                ) {
                    this.finished = true;
                    return result;
                }
            } while (this.distance++, !result);
            return result;
        }
        return undefined;
    }
}
