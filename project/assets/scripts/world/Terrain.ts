/**
 * Terrain generation — fully procedural, deterministic per seed.
 * The battlefield is 64x64 tiles, point-symmetric so both sides are fair.
 *
 * Heights follow the reference model: a tile has an integer level, and the
 * renderer lifts its four corners independently.  Because neighbouring tiles
 * share corners, a 1-level step turns into a smooth ramp for free — that is the
 * job `rampType` does in the retail engine (ObjectPosition.ts + rampHeights.ts).
 */
import { MAP_TILES, makeRng, TILE, HALF } from '../core/Core';
import { type MapData, type MapOverlay, LAND, decodeMap } from './MapData';

export enum TileKind {
    Sand = 0,
    Dune = 1,
    Rock = 2,
    Crystal = 3,
    /** graded road: faster than sand, the retail `Road` land type */
    Road = 4,
    /** impassable water — reserved for bridges/ships later */
    Water = 5,
}

/** a tile's step cost for connectivity, mirroring |Δz| <= 1 in the reference */
export const MAX_STEP_LEVEL = 1;

export interface CrystalNode {
    id: number;
    tx: number;
    ty: number;
    amount: number;
    max: number;
    x: number;
    y: number;
    /** visual seed for the crystal cluster */
    seed: number;
}

export class TerrainMap {
    size = MAP_TILES;
    kind = new Uint8Array(MAP_TILES * MAP_TILES);
    /** static blocking (rocks) */
    solid = new Uint8Array(MAP_TILES * MAP_TILES);
    /** integer height level per tile (0 = ground, 1 = dune, 2 = rock) */
    level = new Uint8Array(MAP_TILES * MAP_TILES);
    /** vertex height field in levels, (N+1)^2 — shared corners make ramps */
    vh = new Float32Array((MAP_TILES + 1) * (MAP_TILES + 1));
    maxLevel = 1;
    /** fine height-ish noise for tinting the ground */
    tint = new Float32Array(MAP_TILES * MAP_TILES);
    /**
     * Visual tile id per cell (see MapData). Gameplay never reads it: it exists
     * so an authored map can say "this cell is tileset tile 37". Until a real
     * PNG/TMP tileset is plugged in, the renderer uses it as a small palette
     * variation so a painted map still reads as varied ground.
     */
    tile = new Uint16Array(MAP_TILES * MAP_TILES);
    /** true when the level array came from a map file instead of the generator */
    authored = false;
    /** props placed by an authored map (rocks, bushes, crates) */
    overlays: MapOverlay[] = [];
    /** movement multiplier per tile (sand 1.0, dune slower, crystal slowest) */
    speed = new Float32Array(MAP_TILES * MAP_TILES);
    nodes: CrystalNode[] = [];

    idx(tx: number, ty: number) {
        return ty * this.size + tx;
    }

    inside(tx: number, ty: number) {
        return tx >= 0 && ty >= 0 && tx < this.size && ty < this.size;
    }

    isSolid(tx: number, ty: number) {
        if (!this.inside(tx, ty)) return true;
        return this.solid[this.idx(tx, ty)] === 1;
    }

    /* ---------------------------------------------------------------- */
    /* HEIGHT                                                            */
    /* ---------------------------------------------------------------- */

    levelAt(tx: number, ty: number) {
        if (!this.inside(tx, ty)) return 0;
        return this.level[this.idx(tx, ty)];
    }

    /** corner height in levels, clamped to the field */
    vhAt(vx: number, vy: number) {
        const s = this.size + 1;
        const x = vx < 0 ? 0 : vx > this.size ? this.size : vx;
        const y = vy < 0 ? 0 : vy > this.size ? this.size : vy;
        return this.vh[y * s + x];
    }

    /**
     * Bilinear terrain height (in levels) at a world position.
     * This is what lifts units, projectiles, decals and shadows onto the ground.
     */
    heightAt(wx: number, wy: number) {
        const n = this.size;
        const gx = wx / TILE + n / 2;
        const gy = wy / TILE + n / 2;
        const tx = Math.floor(gx), ty = Math.floor(gy);
        if (tx < 0 || ty < 0 || tx >= n || ty >= n) return 0;
        const fx = gx - tx, fy = gy - ty;
        const h00 = this.vhAt(tx, ty), h10 = this.vhAt(tx + 1, ty);
        const h01 = this.vhAt(tx, ty + 1), h11 = this.vhAt(tx + 1, ty + 1);
        return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
    }

    /** can a ground unit step between two tiles? (reference: |Δz| <= 1) */
    canStep(ax: number, ay: number, bx: number, by: number) {
        return Math.abs(this.levelAt(ax, ay) - this.levelAt(bx, by)) <= MAX_STEP_LEVEL;
    }

    private claimLevel(tx: number, ty: number, r: number, lv: number) {
        for (let y = ty - r; y <= ty + r; y++) {
            for (let x = tx - r; x <= tx + r; x++) {
                if (this.inside(x, y)) this.level[this.idx(x, y)] = lv;
            }
        }
    }

    /**
     * Rebuilds integer levels + the shared-corner height field.
     *
     * Two sources of truth:
     *   - procedural maps derive the level from the land kind (rock = 2, dune = 1)
     *     and then flatten the base bowls;
     *   - an authored map carries its own per-cell height, and that height is
     *     authoritative — flattening a drawn plateau because a base happened to
     *     be nearby is exactly the kind of "the editor lied" surprise to avoid.
     */
    rebuildHeight() {
        const n = this.size;
        if (!this.authored) {
            for (let i = 0; i < this.kind.length; i++) {
                const k = this.kind[i];
                this.level[i] = k === TileKind.Rock ? 2 : k === TileKind.Dune ? 1 : 0;
            }
            // starting bowls and the mid lane are levelled so bases sit flat
            const bases = [{ tx: 7, ty: 32 }, { tx: n - 8, ty: n - 33 }];
            for (const b of bases) this.claimLevel(b.tx, b.ty, 9, 0);
            for (let x = 0; x < n; x++) {
                const y = Math.round(n / 2 + Math.sin(x * 0.22) * 4);
                for (let d = -2; d <= 2; d++) if (this.inside(x, y + d)) this.level[this.idx(x, y + d)] = 0;
            }
            for (const node of this.nodes) this.claimLevel(node.tx, node.ty, 2, 0);
        }

        // every vertex takes the mean of the (up to) four tiles touching it, so
        // a 1-level cliff becomes a one-tile ramp instead of a wall
        let mx = 0;
        for (let vy = 0; vy <= n; vy++) {
            for (let vx = 0; vx <= n; vx++) {
                let sum = 0, cnt = 0;
                for (let dy = -1; dy <= 0; dy++) {
                    for (let dx = -1; dx <= 0; dx++) {
                        const tx = vx + dx, ty = vy + dy;
                        if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
                        sum += this.level[ty * n + tx];
                        cnt++;
                    }
                }
                this.vh[vy * (n + 1) + vx] = cnt ? sum / cnt : 0;
            }
        }
        for (let i = 0; i < this.level.length; i++) if (this.level[i] > mx) mx = this.level[i];
        this.maxLevel = Math.max(1, mx);
    }

    isCrystal(tx: number, ty: number) {
        if (!this.inside(tx, ty)) return false;
        return this.kind[this.idx(tx, ty)] === TileKind.Crystal;
    }

    /** Marks a rectangle of crystal tiles around a node so it blocks movement. */
    claimCrystal(tx: number, ty: number, r: number) {
        for (let y = ty - r; y <= ty + r; y++) {
            for (let x = tx - r; x <= tx + r; x++) {
                if (!this.inside(x, y)) continue;
                const d = Math.abs(x - tx) + Math.abs(y - ty);
                if (d > r) continue;
                const i = this.idx(x, y);
                this.kind[i] = TileKind.Crystal;
                // ore is driveable in the classics: slow, but not a wall
                this.solid[i] = 0;
            }
        }
    }

    generate(seed: number, preset?: { rocks?: number; dunes?: number; lane?: number; ore?: number }) {
        const rockT = preset?.rocks ?? 0.715;
        const duneT = preset?.dunes ?? 0.575;
        const laneW = preset?.lane ?? 1;
        const oreMul = preset?.ore ?? 1;
        const rng = makeRng(seed);
        const N = this.size;
        this.kind.fill(TileKind.Sand);
        this.solid.fill(0);

        // coarse noise grid -> smooth terrain variation
        const G = 17;
        const grid = new Float32Array(G * G);
        for (let i = 0; i < grid.length; i++) grid[i] = rng();
        // tileable sampling: octaves are fed coordinates above 1, so wrap them
        // instead of reading past the noise grid (which silently produced NaN
        // and turned the whole map into flat sand)
        const noise = (u: number, v: number) => {
            const uu = u - Math.floor(u);
            const vv = v - Math.floor(v);
            const fx = uu * (G - 1), fy = vv * (G - 1);
            const x0 = Math.floor(fx), y0 = Math.floor(fy);
            const x1 = Math.min(G - 1, x0 + 1), y1 = Math.min(G - 1, y0 + 1);
            const tx = fx - x0, ty = fy - y0;
            const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
            const a = grid[y0 * G + x0], b = grid[y0 * G + x1];
            const c = grid[y1 * G + x0], d = grid[y1 * G + x1];
            return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
        };

        // rock ridges: only in the left half, mirrored afterwards
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                const u = x / N, v = y / N;
                const n = noise(u, v) * 0.65 + noise(u * 2.7 + 3.1, v * 2.7 + 1.7) * 0.35;
                const i = this.idx(x, y);
                this.tint[i] = n;
                if (n > rockT) {
                    this.kind[i] = TileKind.Rock;
                    this.solid[i] = 1;
                } else if (n > duneT) {
                    this.kind[i] = TileKind.Dune;
                }
            }
        }

        // carve clear bowls around both starting bases
        const bases = [{ tx: 7, ty: 32 }, { tx: N - 8, ty: N - 33 }];
        for (const b of bases) {
            for (let y = b.ty - 7; y <= b.ty + 7; y++) {
                for (let x = b.tx - 7; x <= b.tx + 7; x++) {
                    if (!this.inside(x, y)) continue;
                    const i = this.idx(x, y);
                    this.kind[i] = TileKind.Sand;
                    this.solid[i] = 0;
                }
            }
        }

        // a passable mid lane so early scouting is possible
        for (let x = 8; x < N - 8; x++) {
            const y = Math.round(N / 2 + Math.sin(x * 0.22) * 4);
            for (let d = -laneW; d <= laneW; d++) {
                const yy = y + d;
                if (!this.inside(x, yy)) continue;
                const i = this.idx(x, yy);
                if (this.kind[i] === TileKind.Rock) {
                    this.kind[i] = TileKind.Dune;
                    this.solid[i] = 0;
                }
            }
        }

        // movement cost per tile, filled after the symmetry pass below
        this.rebuildSpeed();

        // Point symmetry so neither side gets an advantage.
        for (let y = 0; y < N / 2; y++) {
            for (let x = 0; x < N; x++) {
                const i = this.idx(x, y);
                const j = this.idx(N - 1 - x, N - 1 - y);
                if (j === i) continue;
                this.kind[j] = this.kind[i];
                this.solid[j] = this.solid[i];
                this.tint[j] = this.tint[i];
            }
        }

        // crystal fields (money) — mirrored layout, near + far
        // NOTE: the first spot used to be [12,32]; its point-mirror (51,31)
        // landed inside the eastern command core, so that side's harvester
        // could never reach its nearest ore field.
        // positions follow the bases (which sit at x=18 / N-19), so the two
        // sides stay point-symmetric and neither near field is walled in
        const spots: Array<[number, number, number]> = [
            [21, 34, 5600],
            [24, 24, 4200],
            [24, 40, 4200],
            [31, 32, 3800],
            [27, 47, 3200],
            [27, 17, 3200],
            [38, 24, 3400],
            [38, 40, 3400],
        ];
        this.nodes = [];
        let nid = 1;
        for (const [tx, ty, amount] of spots) {
            const rich = Math.round(amount * oreMul);
            this.addNode(tx, ty, rich, nid++, rng);
            this.addNode(N - 1 - tx, N - 1 - ty, rich, nid++, rng);
        }
        this.rebuildSpeed();
        this.rebuildHeight();
    }

    rebuildSpeed() {
        for (let i = 0; i < this.kind.length; i++) {
            const k = this.kind[i];
            this.speed[i] = k === TileKind.Rock ? 0
                : k === TileKind.Water ? 0
                    : k === TileKind.Dune ? 0.84
                        : k === TileKind.Crystal ? 0.66
                            : k === TileKind.Road ? 1.18
                                : 1;
        }
    }

    /**
     * Movement multiplier for a unit class. Infantry picks its way through dunes
     * better than wheels; hover skirt over both.
     */
    speedAt(tx: number, ty: number, isInfantry: boolean, hover: boolean) {
        if (!this.inside(tx, ty)) return 0;
        const i = this.idx(tx, ty);
        const k = this.kind[i];
        if (k === TileKind.Rock || k === TileKind.Water) return 0;
        if (k === TileKind.Road) return hover ? 1.3 : 1.18;
        if (k === TileKind.Dune) return hover ? 1 : isInfantry ? 0.95 : 0.84;
        if (k === TileKind.Crystal) return hover ? 0.85 : isInfantry ? 0.8 : 0.66;
        return 1;
    }

    /** A* cost multiplier: slow ground is expensive */
    costAt(tx: number, ty: number) {
        if (!this.inside(tx, ty)) return 2;
        const k = this.kind[this.idx(tx, ty)];
        if (k === TileKind.Dune) return 1.25;
        if (k === TileKind.Crystal) return 1.4;
        if (k === TileKind.Road) return 0.85;
        return 1;
    }

    private addNode(tx: number, ty: number, amount: number, id: number, rng: () => number, r = 1) {
        this.claimCrystal(tx, ty, r);
        this.nodes.push({
            id, tx, ty, amount, max: amount,
            x: tx * TILE + TILE / 2 - HALF,
            y: ty * TILE + TILE / 2 - HALF,
            seed: Math.floor(rng() * 100000),
        });
    }

    nodeAt(tx: number, ty: number): CrystalNode | null {
        for (const n of this.nodes) {
            if (Math.abs(n.tx - tx) <= 1 && Math.abs(n.ty - ty) <= 1) return n;
        }
        return null;
    }

    /**
     * Load an authored map (see MapData.ts).
     *
     * One loader for both worlds: generating and authoring produce the same six
     * arrays, so nothing downstream (pathing, fog, renderer, AI) knows or cares
     * where a map came from.
     */
    loadMap(d: MapData) {
        const n = this.size;
        const dec = decodeMap(d);
        this.kind.fill(TileKind.Sand);
        this.solid.fill(0);
        this.tile.fill(0);
        this.nodes = [];

        for (let i = 0; i < n * n; i++) {
            const l = dec.land[i];
            let k: TileKind = TileKind.Sand;
            if (l === LAND.Rough) k = TileKind.Dune;
            else if (l === LAND.Road) k = TileKind.Road;
            else if (l === LAND.Water) { k = TileKind.Water; this.solid[i] = 1; }
            else if (l === LAND.Rock) { k = TileKind.Rock; this.solid[i] = 1; }
            this.kind[i] = k;
            this.level[i] = dec.height[i];
            this.tile[i] = dec.tiles[i];
            if (dec.blocked[i]) this.solid[i] = 1;
            // tint drives the ground shading variation; derive it from the height
            // and the tile id so an authored map is not a flat sheet of one colour
            this.tint[i] = 0.35 + ((dec.tiles[i] % 7) / 7) * 0.5;
        }

        this.authored = true;
        this.overlays = (d.overlay ?? []).slice();
        const rng = makeRng(d.id.length * 7919 + 13);
        let nid = 1;
        for (const o of d.ore ?? []) {
            const r = o.amount >= 4200 ? 2 : 1;
            this.addNode(o.tx, o.ty, o.amount, nid++, rng, r);
        }
        // blocking props are walls: one boulder can close a two-tile gap, so this
        // has to be applied before the connectivity-sensitive paths are rebuilt
        for (const ov of this.overlays) {
            if (ov.block && this.inside(ov.tx, ov.ty)) this.solid[this.idx(ov.tx, ov.ty)] = 1;
        }
        this.rebuildSpeed();
        this.rebuildHeight();
    }
}
