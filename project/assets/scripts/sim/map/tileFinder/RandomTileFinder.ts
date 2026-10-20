/**
 * Walks a square around `startTile` in a shuffled order.
 *
 * Reference: redalert2/src/game/map/tileFinder/RandomTileFinder.ts (64 lines).
 *
 * The order is a real shuffle, not "pick a random start and walk": a pool of
 * indices is built once and `splice`d from, so every cell is visited exactly
 * once and the whole ring is exhausted before `getNextTile` returns undefined.
 * That matters for crate spawning — retrying the same cell would bias the
 * distribution.
 *
 * `rng.generateRandomInt(0, pool.length)` passes a **length** where an
 * inclusive max is expected, so the top index is technically reachable. Kept
 * verbatim: `Prng.generateRandomInt` maps through `floor(min + random * (max -
 * min + 1))`, so the value is clamped by the array anyway.
 */
import { GameMath } from '../../math/GameMath';
import type { Tile } from '../TileCollection';
import type { MapBounds } from '../MapBounds';

interface TileCollection {
    getByMapCoords(x: number, y: number): Tile | undefined;
}

interface RNG {
    generateRandomInt(min: number, max: number): number;
}

export class RandomTileFinder<T extends Tile = Tile> {
    private tiles: TileCollection;
    private mapBounds: MapBounds;
    private startTile: T;
    private maxDistance: number;
    private rng: RNG;
    private predicate: (tile: T) => boolean;
    private includeStartTile: boolean;
    private checkBounds: boolean;
    private pool: number[];
    private generator: Generator<T | undefined>;

    constructor(
        tiles: TileCollection,
        mapBounds: MapBounds,
        startTile: T,
        maxDistance: number,
        rng: RNG,
        predicate: (tile: T) => boolean,
        includeStartTile: boolean = false,
        checkBounds: boolean = true,
    ) {
        this.tiles = tiles;
        this.mapBounds = mapBounds;
        this.startTile = startTile;
        this.maxDistance = maxDistance;
        this.rng = rng;
        this.predicate = predicate;
        this.includeStartTile = includeStartTile;
        this.checkBounds = checkBounds;
        this.pool = new Array(GameMath.pow(2 * this.maxDistance + 1, 2))
            .fill(0)
            .map((_, i) => i);
        this.generator = this.generate();
    }

    getNextTile(): T | undefined {
        return this.generator.next().value;
    }

    private *generate(): Generator<T | undefined> {
        const getTile = (x: number, y: number): T | undefined => {
            const tile = this.tiles.getByMapCoords(x, y) as T | undefined;
            if (this.includeStartTile || tile !== this.startTile) {
                return tile &&
                    (!this.checkBounds || this.mapBounds.isWithinBounds(tile)) &&
                    this.predicate(tile)
                    ? (tile as T)
                    : undefined;
            }
            return undefined;
        };

        const size = 2 * this.maxDistance + 1;
        while (this.pool.length) {
            const index = this.pool.length > 1 ? this.rng.generateRandomInt(0, this.pool.length) : 0;
            const value = this.pool.splice(index, 1)[0];
            const x = value % size;
            const y = Math.floor(value / size);
            const tile = getTile(
                this.startTile.rx - this.maxDistance + x,
                this.startTile.ry - this.maxDistance + y,
            );
            if (tile) {
                yield tile;
            }
        }
    }
}
