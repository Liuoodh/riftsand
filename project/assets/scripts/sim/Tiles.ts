/**
 * Tile collection + tile finders.
 *
 * Reference:
 *   redalert2/src/game/map/TileCollection.ts
 *   redalert2/src/game/map/MapBounds.ts
 *   redalert2/src/game/map/tileFinder/RadialTileFinder.ts
 *   redalert2/src/game/map/tileFinder/RandomTileFinder.ts
 *
 * A tile is a *cell*, not a sprite: `rx`/`ry` are cell coordinates, `z` is the
 * integer height level (the reference's cliff/ramp level), `landType` decides
 * the speed modifier. Bridges do not exist in this game yet, so `onBridge` is
 * always undefined — every function that took a bridge still takes the
 * parameter so the call sites stay identical to the reference.
 */

/**
 * All eight neighbours, matching redalert2/src/game/map/TileCollection.ts.
 *
 * The reference uses a numeric enum (Top=0 .. BottomRight=7); ours is a string
 * enum so that a stray direction shows up in a log as `bottomLeft` instead of
 * `5`. The *ability* is identical — every member has an entry in `DIR_VECTORS`
 * and `getNeighbourTile` supports all eight.
 *
 * Only the four northern directions were needed by pathing, but the damage path
 * needs the southern three: `AnimTerrainEffect.spawnSmudges` requires all of
 * Bottom / BottomLeft / BottomRight to exist before it will place a 2x2 crater.
 */
export enum TileDirection {
    Left = 'left',
    TopLeft = 'topLeft',
    Top = 'top',
    TopRight = 'topRight',
    Right = 'right',
    BottomLeft = 'bottomLeft',
    Bottom = 'bottom',
    BottomRight = 'bottomRight',
}

export const DIR_VECTORS: Record<string, [number, number]> = {
    [TileDirection.Left]: [-1, 0],
    [TileDirection.TopLeft]: [-1, -1],
    [TileDirection.Top]: [0, -1],
    [TileDirection.TopRight]: [1, -1],
    [TileDirection.Right]: [1, 0],
    [TileDirection.BottomLeft]: [-1, 1],
    [TileDirection.Bottom]: [0, 1],
    [TileDirection.BottomRight]: [1, 1],
};

export class Tile {
    rx: number;
    ry: number;
    /** integer height level (reference: tile.z) */
    z: number;
    /** land class (reference: tile.landType) — decides the speed modifier */
    landType: number;
    /** raw terrain kind, used when a wall must be re-read as its ground */
    terrainType: number;
    /** stable id used as the graph node key */
    id: string;
    onBridgeLandType?: number;

    constructor(rx: number, ry: number, z: number, landType: number) {
        this.rx = rx;
        this.ry = ry;
        this.z = z;
        this.landType = landType;
        this.terrainType = landType;
        this.id = `${rx}_${ry}`;
    }
}

export class TileCollection {
    readonly size: number;
    readonly tiles: Tile[] = [];

    constructor(size: number) {
        this.size = size;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) this.tiles.push(new Tile(x, y, 0, 0));
        }
    }

    idx(rx: number, ry: number) {
        return ry * this.size + rx;
    }

    getByMapCoords(rx: number, ry: number): Tile | undefined {
        if (rx < 0 || ry < 0 || rx >= this.size || ry >= this.size) return undefined;
        return this.tiles[ry * this.size + rx];
    }

    getNeighbourTile(tile: Tile, direction: TileDirection): Tile | undefined {
        const v = DIR_VECTORS[direction];
        return this.getByMapCoords(tile.rx + v[0], tile.ry + v[1]);
    }

    forEach(cb: (tile: Tile) => void): void {
        for (const tile of this.tiles) cb(tile);
    }

    /** re-read heights / land kinds after the terrain was (re)generated */
    syncFrom(
        z: (rx: number, ry: number) => number,
        landType: (rx: number, ry: number) => number,
        terrainType?: (rx: number, ry: number) => number,
    ) {
        for (const tile of this.tiles) {
            tile.z = z(tile.rx, tile.ry);
            tile.landType = landType(tile.rx, tile.ry);
            tile.terrainType = terrainType ? terrainType(tile.rx, tile.ry) : tile.landType;
        }
    }

    /** reference `tiles.getMapSize()` — `{ width, height }` in cells */
    getMapSize(): { width: number; height: number } {
        return { width: this.size, height: this.size };
    }

    /**
     * reference `tiles.getInRectangle(tile, foundation)`.
     *
     * Every cell the footprint covers, row-major from the top-left corner, with
     * out-of-bounds cells dropped — exactly what `CrewedTrait` iterates to find
     * a place for a survivor to stand.
     */
    getInRectangle(tile: { rx: number; ry: number }, foundation: { width: number; height: number }): Tile[] {
        const out: Tile[] = [];
        for (let y = tile.ry; y < tile.ry + foundation.height; y++) {
            for (let x = tile.rx; x < tile.rx + foundation.width; x++) {
                const t = this.getByMapCoords(x, y);
                if (t) out.push(t);
            }
        }
        return out;
    }

    /**
     * reference `tiles.getAllNeighbourTiles(tile)` — the eight cells around a
     * tile, skipping the ones off the map.
     */
    getAllNeighbourTiles(tile: Tile): Tile[] {
        const out: Tile[] = [];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const t = this.getByMapCoords(tile.rx + dx, tile.ry + dy);
                if (t) out.push(t);
            }
        }
        return out;
    }
}

export class MapBounds {
    width: number;
    height: number;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    isWithinBounds(tile: Tile | { rx: number; ry: number }): boolean {
        return tile.rx >= 0 && tile.ry >= 0 && tile.rx < this.width && tile.ry < this.height;
    }
}

/**
 * RadialTileFinder — port of the reference ring scan.
 *
 * The exact visit order matters: `findRelocationTile` and `MoveAsideTask` take
 * the *first* tile that satisfies the predicate, so a different order parks
 * units on a different side of the target.
 */
export class RadialTileFinder {
    private start: Tile;
    private foundation: { width: number; height: number };
    private maxDistance: number;
    private predicate: (tile: Tile) => boolean;
    private checkBounds: boolean;
    private distance: number;
    private ring: Array<[number, number]> = [];
    private ringCursor = 0;
    private ringLoaded = false;
    private done = false;

    constructor(
        private tiles: TileCollection,
        private mapBounds: MapBounds,
        startTile: Tile,
        foundation: { width: number; height: number },
        distance: number,
        maxDistance: number,
        predicate: (tile: Tile) => boolean,
        checkBounds = true,
    ) {
        this.start = startTile;
        this.foundation = foundation;
        this.maxDistance = maxDistance;
        this.predicate = predicate;
        this.checkBounds = checkBounds;
        this.distance = distance;
    }

    private loadRing() {
        this.ring.length = 0;
        this.ringCursor = 0;
        this.ringLoaded = true;
        const d = this.distance;
        const left = this.start.rx - d;
        const top = this.start.ry - d;
        const right = this.start.rx + this.foundation.width - 1 + d;
        const bottom = this.start.ry + this.foundation.height - 1 + d;
        if (d === 0) {
            this.ring.push([this.start.rx, this.start.ry]);
            return;
        }
        for (let x = right; x >= left; x--) this.ring.push([x, bottom]);
        for (let y = bottom - 1; y >= top; y--) this.ring.push([right, y]);
        for (let x = left; x < right; x++) this.ring.push([x, top]);
        for (let y = top + 1; y < bottom; y++) this.ring.push([left, y]);
    }

    getNextTile(): Tile | undefined {
        while (!this.done) {
            if (!this.ringLoaded) {
                if (this.distance > this.maxDistance) {
                    this.done = true;
                    return undefined;
                }
                this.loadRing();
            }
            while (this.ringCursor < this.ring.length) {
                const [x, y] = this.ring[this.ringCursor++];
                const tile = this.tiles.getByMapCoords(x, y);
                if (!tile) continue;
                if (this.checkBounds && !this.mapBounds.isWithinBounds(tile)) continue;
                if (!this.predicate(tile)) continue;
                return tile;
            }
            this.ringLoaded = false;
            this.distance++;
        }
        return undefined;
    }
}

/**
 * RadialBackFirstTileFinder — port of the reference ring scan that starts at the
 * *back* (min-x / min-y) edge of the ring instead of the front.
 *
 * Same ring geometry as `RadialTileFinder`, different walk order: left column
 * upward-outward, then the top edge, then the right column, then the bottom
 * edge. `FreeUnitTrait` uses it so a free unit emerges behind the structure
 * (away from the camera) rather than in front of it.
 */
export class RadialBackFirstTileFinder {
    private generator: Generator<Tile | undefined>;

    constructor(
        private tiles: TileCollection,
        private mapBounds: MapBounds,
        private startTile: Tile,
        private foundation: { width: number; height: number },
        private distance: number,
        private maxDistance: number,
        private predicate: (tile: Tile) => boolean,
        private checkBounds = true,
    ) {
        this.generator = this.generate();
    }

    getNextTile(): Tile | undefined {
        return this.generator.next().value;
    }

    private *generate(): Generator<Tile | undefined> {
        const getTile = (x: number, y: number): Tile | undefined => {
            const tile = this.tiles.getByMapCoords(x, y);
            if (tile && (!this.checkBounds || this.mapBounds.isWithinBounds(tile)) && this.predicate(tile)) {
                return tile;
            }
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

export class RandomTileFinder {
    constructor(
        private tiles: TileCollection,
        private mapBounds: MapBounds,
        private start: Tile,
        private radius: number,
        private rng: () => number,
        private predicate: (tile: Tile) => boolean,
    ) {}

    getNextTile(): Tile | undefined {
        const count = (this.radius * 2 + 1) ** 2;
        const offset = Math.floor(this.rng() * count);
        for (let i = 0; i < count; i++) {
            const k = (offset + i) % count;
            const dx = (k % (this.radius * 2 + 1)) - this.radius;
            const dy = Math.floor(k / (this.radius * 2 + 1)) - this.radius;
            const tile = this.tiles.getByMapCoords(this.start.rx + dx, this.start.ry + dy);
            if (!tile || !this.mapBounds.isWithinBounds(tile)) continue;
            if (this.predicate(tile)) return tile;
        }
        return undefined;
    }
}
