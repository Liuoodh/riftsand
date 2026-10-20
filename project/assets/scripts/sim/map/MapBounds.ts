/**
 * Map boundaries — the playable rectangle, in isometric display coordinates.
 *
 * Reference: redalert2/src/game/map/MapBounds.ts (141 lines).
 *
 * Four rectangles, all in `dx`/`dy` space, all meaning something different:
 *
 *   fullSize         the whole map, 2× the logical size (iso doubles each axis)
 *   clampedFullSize  the whole map minus a one-cell margin, used for hard
 *                    bounds on world *pixels* (`isWithinHardBounds`)
 *   rawLocalSize     what the map file says is the player's scrollable window
 *   localSize        `rawLocalSize` after clamping to the map and to the
 *                    height cutoff — this is what the camera uses
 *   mapBuildableSize `localSize` inset by 2 horizontally / 4+4 vertically —
 *                    this is what **passability** uses
 *
 * The inset is the point. A retail map's diamond leaves the bounding-box
 * corners empty, so the buildable rectangle is deliberately smaller than the
 * map: a unit can never be ordered into the corner that has no tiles. On our
 * square map this trims a few cells off each diagonal edge, which is correct —
 * those cells are the ones the isometric corner would have covered.
 *
 * `isWithinBounds` tests `dy - z`, not `dy`: a cell on a plateau occupies the
 * display rows *above* its base row, so subtracting the height is what keeps
 * the top of a cliff inside the buildable box.
 */
import { Coords } from '../Coords';
import { EventDispatcher } from '../util/event';
import { rectClampPoint, rectContainsPoint, rectContainsRect, rectEquals } from '../util/geometry';

interface Size {
    width: number;
    height: number;
}

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface Point {
    x: number;
    y: number;
    z?: number;
}

interface Tile {
    dx: number;
    dy: number;
    z: number;
}

export interface MapFile {
    fullSize: Size;
    localSize: Rect;
}

interface MapRules {
    getCutoffTileHeight(): number;
}

export class MapBounds {
    private mapCutoffHeight: number;
    private mapBuildableSize: Rect;
    private localSize: Rect;
    private fullSize: Size;
    private clampedFullSize: Rect;
    private rawLocalSize: Rect;
    private _onLocalResize: EventDispatcher<MapBounds>;

    constructor() {
        this.mapCutoffHeight = 0;
        this.mapBuildableSize = { x: 0, y: 0, width: 0, height: 0 };
        this.localSize = { x: 0, y: 0, width: 0, height: 0 };
        this.fullSize = { width: 0, height: 0 };
        this.clampedFullSize = { x: 0, y: 0, width: 0, height: 0 };
        this.rawLocalSize = { x: 0, y: 0, width: 0, height: 0 };
        this._onLocalResize = new EventDispatcher<MapBounds>();
    }

    get onLocalResize() {
        return this._onLocalResize.asEvent();
    }

    /**
     * `[Map]` section of a retail `.map` file, in **logical** cells.
     *
     * `localSize.x` is floored at 2 and its width capped at
     * `fullSize.width - 2 - x`: the player's window may not touch the left or
     * right map edge, because that is where the diamond's empty corners are.
     */
    fromMapFile(mapFile: MapFile, rules: MapRules): MapBounds {
        this.fullSize = {
            width: 2 * mapFile.fullSize.width,
            height: 2 * mapFile.fullSize.height,
        };
        this.clampedFullSize = {
            x: 1,
            y: 2,
            width: 2 * (mapFile.fullSize.width - 1) - 1 / Coords.ISO_TILE_SIZE,
            height: 2 * (mapFile.fullSize.height - 1) + 1 - 1 / Coords.ISO_TILE_SIZE,
        };
        this.mapCutoffHeight = Math.max(9, rules.getCutoffTileHeight());

        const x = Math.max(2, mapFile.localSize.x);
        const localSize: Rect = {
            x,
            y: mapFile.localSize.y,
            width: Math.min(mapFile.fullSize.width - 2 - x, mapFile.localSize.width),
            height: mapFile.localSize.height,
        };
        this.updateRawLocalSize(localSize);
        return this;
    }

    /**
     * Move the camera window (a player-view resize trigger, or a scripted
     * `ResizePlayerView` action).
     *
     * Growing is allowed freely; shrinking is rejected with a warning rather
     * than throwing, because the trigger runs inside the game loop and a throw
     * would stop the tick.
     */
    updateRawLocalSize(size: Rect): void {
        if (this.rawLocalSize.width && this.rawLocalSize.height && !rectContainsRect(size, this.rawLocalSize)) {
            console.warn("New map limits must be outside old limits. Skipping.");
        } else if (!rectEquals(size, this.rawLocalSize)) {
            this.localSize = this.computeLocalSize(size, this.fullSize.height / 2, this.mapCutoffHeight);
            this.rawLocalSize = { ...size };
            this.mapBuildableSize = {
                x: this.localSize.x,
                y: this.localSize.y + 4,
                width: this.localSize.width - 2,
                height: this.localSize.height - 8,
            };
            this._onLocalResize.dispatch(this);
        }
    }

    /**
     * The `min(...)` on height is what makes the bottom of the map follow the
     * terrain: `2*height - 2*(size.y-3) - cutoffHeight` shrinks the window as
     * the camera moves south, so a tall cliff near the bottom edge cannot be
     * scrolled past.
     */
    private computeLocalSize(size: Rect, height: number, cutoffHeight: number): Rect {
        return {
            x: 2 * size.x,
            y: 2 * size.y - 4,
            height: Math.min(2 * (size.height + 5) - 1, 2 * height - 2 * (size.y - 3) - cutoffHeight),
            width: 2 * size.width,
        };
    }

    getLocalSize(): Rect {
        return this.localSize;
    }

    getRawLocalSize(): Rect {
        return this.rawLocalSize;
    }

    getFullSize(): Size {
        return this.fullSize;
    }

    getClampedFullSize(): Rect {
        return this.clampedFullSize;
    }

    isWithinBounds(tile: Tile): boolean {
        return rectContainsPoint(this.mapBuildableSize, {
            x: tile.dx,
            y: tile.dy - tile.z,
        });
    }

    /**
     * Nearest in-bounds cell, with its `dy` parity fixed.
     *
     * The `y += (x % 2) - (y % 2)` line is not cosmetic: on the isometric grid
     * only cells where `dx` and `dy` have the same parity exist, so clamping to
     * a rectangle can land on a hole. Then the `y -= 2` after overshooting the
     * bottom edge does the same correction on the other end.
     */
    clampWithinBounds(tile: Tile): { dx: number; dy: number } {
        let { x, y } = rectClampPoint(this.mapBuildableSize, {
            x: tile.dx,
            y: tile.dy - tile.z,
        });
        y += (x % 2) - (y % 2);
        if (y > this.mapBuildableSize.y + this.mapBuildableSize.height) {
            y -= 2;
        }
        return { dx: x, dy: y };
    }

    /**
     * Hard bounds on world **leptons**, not cells — used to reject a unit whose
     * locomotor overshoots the map, where no cell exists to test against.
     */
    isWithinHardBounds(point: Point): boolean {
        const x = point.x / Coords.LEPTONS_PER_TILE;
        const y = (point.z ?? point.y) / Coords.LEPTONS_PER_TILE;
        const r = x - y + this.fullSize.width / 2 - 1;
        const i = x + y - this.fullSize.width / 2 - 1;
        return rectContainsPoint(this.clampedFullSize, {
            x: r + 1,
            y: i + 1,
        });
    }
}
