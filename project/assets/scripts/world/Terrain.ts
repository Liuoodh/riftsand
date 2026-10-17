/**
 * Terrain generation — fully procedural, deterministic per seed.
 * The battlefield is 64x64 tiles, point-symmetric so both sides are fair.
 */
import { MAP_TILES, makeRng, TILE, HALF } from '../core/Core';

export enum TileKind {
    Sand = 0,
    Dune = 1,
    Rock = 2,
    Crystal = 3,
}

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
    /** fine height-ish noise for tinting the ground */
    tint = new Float32Array(MAP_TILES * MAP_TILES);
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

    generate(seed: number) {
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
                if (n > 0.715) {
                    this.kind[i] = TileKind.Rock;
                    this.solid[i] = 1;
                } else if (n > 0.575) {
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
            for (let d = -1; d <= 1; d++) {
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
        const spots: Array<[number, number, number]> = [
            [14, 34, 5600],
            [17, 24, 4200],
            [17, 40, 4200],
            [24, 32, 3800],
            [20, 47, 3200],
            [20, 17, 3200],
            [31, 24, 3400],
            [31, 40, 3400],
        ];
        this.nodes = [];
        let nid = 1;
        for (const [tx, ty, amount] of spots) {
            this.addNode(tx, ty, amount, nid++, rng);
            this.addNode(N - 1 - tx, N - 1 - ty, amount, nid++, rng);
        }
        this.rebuildSpeed();
    }

    /** (re)computes per-tile movement multipliers from the tile kind */
    rebuildSpeed() {
        for (let i = 0; i < this.kind.length; i++) {
            const k = this.kind[i];
            this.speed[i] = k === TileKind.Rock ? 0 : k === TileKind.Dune ? 0.84 : k === TileKind.Crystal ? 0.66 : 1;
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
        if (k === TileKind.Rock) return 0;
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
        return 1;
    }

    private addNode(tx: number, ty: number, amount: number, id: number, rng: () => number) {
        this.claimCrystal(tx, ty, 1);
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
}
