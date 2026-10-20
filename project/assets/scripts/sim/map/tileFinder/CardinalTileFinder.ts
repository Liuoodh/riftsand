/**
 * Walks outward in the four cardinal directions, rotating 45° (or 90°) each
 * step, yielding the first tile per distance that passes the predicate.
 *
 * Reference: redalert2/src/game/map/tileFinder/CardinalTileFinder.ts (54 lines).
 *
 * The rotation trick is the point: instead of four explicit loops, a direction
 * vector is rotated and rounded, and `dirVec.angle()` returning 0 marks "we are
 * back to the start direction, so this distance ring is finished". `diagonal`
 * chooses 45° (eight directions) or 90° (four).
 */
import { Vector2 } from '../../math/Vector2';
import type { Tile } from '../TileCollection';
import type { MapBounds } from '../MapBounds';

interface TileCollection {
    getByMapCoords(x: number, y: number): Tile | undefined;
}

export class CardinalTileFinder<T extends Tile = Tile> {
    private tiles: TileCollection;
    private mapBounds: MapBounds;
    private startTile: T;
    private maxDistance: number;
    private predicate: (tile: T) => boolean;
    private dirVec: Vector2;
    private finished: boolean;
    public diagonal: boolean;
    private distance: number;

    constructor(
        tiles: TileCollection,
        mapBounds: MapBounds,
        startTile: T,
        distance: number,
        maxDistance: number,
        predicate: (tile: T) => boolean = () => true,
    ) {
        this.tiles = tiles;
        this.mapBounds = mapBounds;
        this.startTile = startTile;
        this.maxDistance = maxDistance;
        this.predicate = predicate;
        this.dirVec = new Vector2(10, 0);
        this.finished = false;
        this.diagonal = true;
        this.distance = distance;
    }

    getNextTile(): T | undefined {
        if (!this.finished) {
            let result: T | undefined;
            do {
                const coords = { x: this.startTile.rx, y: this.startTile.ry };
                coords.x += this.distance * Math.sign(this.dirVec.x);
                coords.y += this.distance * Math.sign(this.dirVec.y);
                this.dirVec.rotateAround(new Vector2(), (Math.PI / 4) * (this.diagonal ? 1 : 2)).round();
                const tile = this.tiles.getByMapCoords(coords.x, coords.y) as T | undefined;
                if (
                    (tile && this.mapBounds.isWithinBounds(tile) && this.predicate(tile) && (result = tile as T),
                    !this.dirVec.angle())
                ) {
                    if (this.maxDistance && this.distance >= this.maxDistance) {
                        this.finished = true;
                        return result;
                    }
                    this.distance++;
                }
            } while (!result);
            return result;
        }
        return undefined;
    }
}
