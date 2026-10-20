/**
 * Which cells are hidden by tall structures.
 *
 * Reference: redalert2/src/game/map/TileOcclusion.ts (55 lines — shipped
 * minified, so this is the same logic written out with names).
 *
 * A structure taller than two cells also hides the cells *behind* it: the
 * renderer draws those cells' contents dimmed, and the player cannot click
 * what they cannot see. The occluded set is per-tile and ref-counted — a cell
 * stays occluded while any occluder covers it, which is what `Set` gives us.
 *
 * `calculateTilesForGameObject` builds the occluder footprint in two strokes:
 *
 *   - a triangle up-left of the structure (`(e-u, -u)` for the full width),
 *     which is the shadow cast along the isometric screen axis;
 *   - a triangle left-and-down (`(-d, e-d)` for rows below the first).
 *
 * Then `art.addOccupy` adds extra offsets and `art.removeOccupy` punches holes
 * — the two are the per-building art overrides, and removal wins regardless of
 * order of declaration.
 */
import { Vector2 } from '../math/Vector2';

interface Tile {
    rx: number;
    ry: number;
    occluded: boolean;
}

interface OccludableObject {
    tile: Tile;
    art: {
        occupyHeight: number;
        addOccupy: Vector2[];
        removeOccupy: Vector2[];
    };
    getFoundation(): { width: number; height: number };
}

interface TileMap {
    getAll(): Tile[];
    getByMapCoords(rx: number, ry: number): Tile | undefined;
}

export class TileOcclusion {
    tiles: TileMap;
    tileOcclusion: Set<OccludableObject>[][];

    constructor(tiles: TileMap) {
        this.tiles = tiles;
        this.tileOcclusion = [];
        const occlusion = this.tileOcclusion;
        for (const tile of tiles.getAll()) {
            occlusion[tile.rx] = occlusion[tile.rx] || [];
            occlusion[tile.rx][tile.ry] = new Set();
        }
    }

    addOccluder(obj: OccludableObject): void {
        const tiles = this.calculateTilesForGameObject(obj);
        tiles.forEach((tile) => this.occludeTile(tile, obj));
    }

    removeOccluder(obj: OccludableObject): void {
        const tiles = this.calculateTilesForGameObject(obj);
        tiles.forEach((tile) => this.unoccludeTile(tile, obj));
    }

    calculateTilesForGameObject(obj: OccludableObject): Tile[] {
        const occupyHeight = obj.art.occupyHeight;
        const depth = Math.max(0, occupyHeight - 2);
        const offsets: Vector2[] = [];
        const foundation = obj.getFoundation();

        for (let level = 1; level <= depth; level++) {
            for (let x = 0; x < foundation.width; x++) {
                offsets.push(new Vector2(x - level, -level));
            }
        }
        for (let level = 1; level <= depth; level++) {
            for (let y = 1; y < foundation.height; y++) {
                offsets.push(new Vector2(-level, y - level));
            }
        }

        offsets.push(...obj.art.addOccupy);
        for (const { x, y } of obj.art.removeOccupy) {
            const index = offsets.findIndex((offset) => offset.x === x && offset.y === y);
            if (index !== -1) {
                offsets.splice(index, 1);
            }
        }

        const origin = obj.tile;
        const tiles: Tile[] = [];
        for (const { x, y } of offsets) {
            const tile = this.tiles.getByMapCoords(origin.rx + x, origin.ry + y);
            if (tile) {
                tiles.push(tile);
            }
        }
        return tiles;
    }

    occludeTile(tile: Tile, obj: OccludableObject): void {
        this.tileOcclusion[tile.rx][tile.ry].add(obj);
        tile.occluded = true;
    }

    unoccludeTile(tile: Tile, obj: OccludableObject): void {
        const set = this.tileOcclusion[tile.rx][tile.ry];
        set.delete(obj);
        tile.occluded = 0 < set.size;
    }

    isTileOccluded(tile: Tile): boolean {
        return 0 < this.tileOcclusion[tile.rx][tile.ry].size;
    }
}
