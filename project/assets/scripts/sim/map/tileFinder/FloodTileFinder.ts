/**
 * Depth-first flood over connected cells, in **pop order**.
 *
 * Reference: redalert2/src/game/map/tileFinder/FloodTileFinder.ts (45 lines).
 *
 * `queue.pop()` — not `shift()`. That makes it a DFS, and the visit order is
 * therefore not the order of increasing distance. Nothing in the game depends
 * on it being breadth-first, but `Bridges.findHighBridgeBoundary` sorts the
 * result afterwards precisely because the raw order is arbitrary.
 */
import type { Tile } from '../TileCollection';
import type { MapBounds } from '../MapBounds';

interface TileCollection {
    getAllNeighbourTiles(tile: Tile): Tile[];
}

export class FloodTileFinder<T extends Tile = Tile> {
    private tiles: TileCollection;
    private mapBounds: MapBounds;
    private startTile: T;
    private areConnected: (tile1: T, tile2: T) => boolean;
    private predicate: (tile: T) => boolean;
    private checkBounds: boolean;
    private generator: Generator<T | undefined>;

    constructor(
        tiles: TileCollection,
        mapBounds: MapBounds,
        startTile: T,
        areConnected: (tile1: T, tile2: T) => boolean,
        predicate: (tile: T) => boolean,
        checkBounds: boolean = true,
    ) {
        this.tiles = tiles;
        this.mapBounds = mapBounds;
        this.startTile = startTile;
        this.areConnected = areConnected;
        this.predicate = predicate;
        this.checkBounds = checkBounds;
        this.generator = this.generate();
    }

    getNextTile(): T | undefined {
        return this.generator.next().value;
    }

    private *generate(): Generator<T | undefined> {
        const queue = [this.startTile];
        const visited = new Set<T>();
        while (queue.length) {
            const current = queue.pop()!;
            if (!visited.has(current)) {
                visited.add(current);
                if (!(this.checkBounds && !this.mapBounds.isWithinBounds(current)) && this.predicate(current)) {
                    yield current;
                }
                for (const neighbor of this.tiles.getAllNeighbourTiles(current) as T[]) {
                    if (this.areConnected(neighbor, current)) {
                        queue.push(neighbor);
                    }
                }
            }
        }
    }
}
