/**
 * Grid A* path-finding with terrain cost, footprint clearance and best-effort
 * fallback.
 *
 * - terrain cost makes columns prefer sand over dunes and ore fields
 * - vehicles ask for a footprint radius so they do not thread 1-tile gaps
 * - if the goal is unreachable the closest reached cell is returned instead of
 *   freezing the unit (same "best effort" idea as the reference engine)
 * - line-of-sight smoothing keeps the paths from looking like staircases
 */
import { MAP_TILES, TILE, HALF } from '../core/Core';

class Heap {
    ids: number[] = [];
    f: number[] = [];
    push(id: number, f: number) {
        this.ids.push(id); this.f.push(f);
        let i = this.ids.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.f[p] <= this.f[i]) break;
            this.swap(p, i); i = p;
        }
    }
    pop(): number {
        const top = this.ids[0];
        const lastId = this.ids.pop()!;
        const lastF = this.f.pop()!;
        if (this.ids.length > 0) {
            this.ids[0] = lastId; this.f[0] = lastF;
            let i = 0;
            for (;;) {
                const l = i * 2 + 1, r = l + 1;
                let m = i;
                if (l < this.ids.length && this.f[l] < this.f[m]) m = l;
                if (r < this.ids.length && this.f[r] < this.f[m]) m = r;
                if (m === i) break;
                this.swap(m, i); i = m;
            }
        }
        return top;
    }
    get size() { return this.ids.length; }
    clear() { this.ids.length = 0; this.f.length = 0; }
    private swap(a: number, b: number) {
        const ti = this.ids[a]; this.ids[a] = this.ids[b]; this.ids[b] = ti;
        const tf = this.f[a]; this.f[a] = this.f[b]; this.f[b] = tf;
    }
}

const N = MAP_TILES;
const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
];

export interface PathOptions {
    /** collision radius in world units; values above 10 require a wide corridor */
    radius?: number;
    /** hard cap on expanded nodes, keeps a frame from stalling */
    maxNodes?: number;
}

export class PathFinder {
    private g = new Float32Array(N * N);
    private came = new Int32Array(N * N);
    private closed = new Uint8Array(N * N);
    private stamp = new Int32Array(N * N);
    private run = 0;
    private heap = new Heap();
    private blocked: (tx: number, ty: number) => boolean;
    private cost: (tx: number, ty: number) => number;

    constructor(blocked: (tx: number, ty: number) => boolean, cost?: (tx: number, ty: number) => number) {
        this.blocked = blocked;
        this.cost = cost || (() => 1);
    }

    /** Returns world-space waypoints (excluding the start), or null. */
    find(sx: number, sy: number, gx: number, gy: number, opts: PathOptions = {}): Array<{ x: number; y: number }> | null {
        const radius = opts.radius || 0;
        const maxNodes = opts.maxNodes || 5200;
        const stx = Math.floor((sx + HALF) / TILE);
        const sty = Math.floor((sy + HALF) / TILE);
        let gtx = Math.floor((gx + HALF) / TILE);
        let gty = Math.floor((gy + HALF) / TILE);
        if (stx < 0 || sty < 0 || stx >= N || sty >= N) return null;
        gtx = Math.max(0, Math.min(N - 1, gtx));
        gty = Math.max(0, Math.min(N - 1, gty));

        // walk out of an occupied cell so units never freeze inside each other
        if (!this.clear(gtx, gty, radius)) {
            const alt = this.nearestFree(gtx, gty, radius);
            if (!alt) return null;
            gtx = alt.tx; gty = alt.ty;
        }

        const startId = sty * N + stx;
        const goalId = gty * N + gtx;
        if (startId === goalId) {
            return [{ x: gx, y: gy }];
        }

        const run = ++this.run;
        const heap = this.heap;
        heap.clear();
        this.stamp[startId] = run;
        this.g[startId] = 0;
        this.came[startId] = -1;
        this.closed[startId] = 0;
        heap.push(startId, this.heur(stx, sty, gtx, gty));

        let found = false;
        let expanded = 0;
        // best-effort bookkeeping: the reached cell closest to the goal
        let bestId = startId;
        let bestH = this.heur(stx, sty, gtx, gty);

        while (heap.size > 0 && expanded++ < maxNodes) {
            const cur = heap.pop();
            if (cur === goalId) { found = true; break; }
            if (this.stamp[cur] === run && this.closed[cur]) continue;
            this.closed[cur] = 1;
            const cx = cur % N, cy = (cur / N) | 0;
            for (let i = 0; i < 8; i++) {
                const dx = DIRS[i][0], dy = DIRS[i][1];
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
                if (!this.clear(nx, ny, radius)) continue;
                // no corner cutting
                if (dx !== 0 && dy !== 0) {
                    if (this.blocked(cx + dx, cy) || this.blocked(cx, cy + dy)) continue;
                }
                const nid = ny * N + nx;
                if (this.stamp[nid] === run && this.closed[nid]) continue;
                /*
                 * Turn penalty. The reference adds 0.2 to the heuristic whenever
                 * the direction of travel changes (game/map/Terrain.ts:93-96),
                 * which makes columns prefer straight lines. Without it units
                 * zig-zag across open sand because diagonals and cardinals cost
                 * almost the same.
                 */
                let turnPenalty = 0;
                const prevId = this.came[cur];
                if (prevId >= 0 && this.stamp[prevId] === run) {
                    const pdx = cx - (prevId % N);
                    const pdy = cy - ((prevId / N) | 0);
                    if (pdx !== dx || pdy !== dy) turnPenalty = 0.2;
                }
                const ng = this.g[cur] + DIRS[i][2] * this.cost(nx, ny) + turnPenalty;
                if (this.stamp[nid] !== run) {
                    this.stamp[nid] = run;
                    this.g[nid] = ng;
                    this.came[nid] = cur;
                    this.closed[nid] = 0;
                    const h = this.heur(nx, ny, gtx, gty);
                    heap.push(nid, ng + h);
                    if (h < bestH) { bestH = h; bestId = nid; }
                } else if (ng < this.g[nid]) {
                    this.g[nid] = ng;
                    this.came[nid] = cur;
                    const h = this.heur(nx, ny, gtx, gty);
                    heap.push(nid, ng + h);
                    if (h < bestH) { bestH = h; bestId = nid; }
                }
            }
        }

        // unreachable goal: head for the closest cell we actually reached
        const endId = found ? goalId : bestId;
        if (endId === startId) return null;

        const cells: number[] = [];
        let c = endId;
        while (c !== -1) {
            cells.push(c);
            if (c === startId) break;
            c = this.came[c];
        }
        cells.reverse();

        const pts: Array<{ x: number; y: number }> = [];
        for (let i = 1; i < cells.length; i++) {
            const tx = cells[i] % N, ty = (cells[i] / N) | 0;
            pts.push({ x: tx * TILE + TILE / 2 - HALF, y: ty * TILE + TILE / 2 - HALF });
        }
        if (pts.length === 0) pts.push({ x: gx, y: gy });
        else if (found) pts[pts.length - 1] = { x: gx, y: gy };

        return this.smooth(sx, sy, pts, radius);
    }

    private heur(x: number, y: number, gx: number, gy: number) {
        const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
        return (dx > dy ? dx + 0.4142 * dy : dy + 0.4142 * dx);
    }

    /** tile is free, and wide enough for the unit footprint */
    private clear(tx: number, ty: number, radius: number) {
        if (this.blocked(tx, ty)) return false;
        // Wide hulls need the disc centred on the cell to fit; below ~1/3 of a
        // tile the unit is narrower than a cell and the single check is exact.
        if (radius <= TILE * 0.34) return true;
        return this.discFree(tx * TILE + TILE / 2 - HALF, ty * TILE + TILE / 2 - HALF, radius);
    }

    /**
     * Is a disc of `r` free of blocking cells?
     *
     * This is what stops a tank from clipping the corner of a building: the
     * centre line of a diagonal path is clear, but the hull is not. The reference
     * solves the same problem with its footprint test against tile occupation.
     */
    discFree(x: number, y: number, r: number) {
        if (r <= 0) return !this.blocked(Math.floor((x + HALF) / TILE), Math.floor((y + HALF) / TILE));
        const x0 = Math.floor((x - r + HALF) / TILE);
        const x1 = Math.floor((x + r + HALF) / TILE);
        const y0 = Math.floor((y - r + HALF) / TILE);
        const y1 = Math.floor((y + r + HALF) / TILE);
        const rr = r * r * 0.86;
        for (let ty = y0; ty <= y1; ty++) {
            for (let tx = x0; tx <= x1; tx++) {
                if (!this.blocked(tx, ty)) continue;
                const cx = Math.max(tx * TILE - HALF, Math.min(x, tx * TILE + TILE - HALF));
                const cy = Math.max(ty * TILE - HALF, Math.min(y, ty * TILE + TILE - HALF));
                const dx = x - cx, dy = y - cy;
                if (dx * dx + dy * dy < rr) return false;
            }
        }
        return true;
    }

    private nearestFree(tx: number, ty: number, radius: number): { tx: number; ty: number } | null {
        for (let r = 1; r <= 8; r++) {
            for (let y = ty - r; y <= ty + r; y++) {
                for (let x = tx - r; x <= tx + r; x++) {
                    if (x < 0 || y < 0 || x >= N || y >= N) continue;
                    if (this.clear(x, y, radius)) return { tx: x, ty: y };
                }
            }
        }
        return null;
    }

    /** Removes intermediate waypoints that are directly walkable. */
    private smooth(sx: number, sy: number, pts: Array<{ x: number; y: number }>, radius: number) {
        if (pts.length <= 2) return pts;
        const out: Array<{ x: number; y: number }> = [];
        let ax = sx, ay = sy;
        let i = 0;
        while (i < pts.length) {
            let j = pts.length - 1;
            for (; j > i; j--) {
                if (this.lineClear(ax, ay, pts[j].x, pts[j].y, radius)) break;
            }
            out.push(pts[j]);
            ax = pts[j].x; ay = pts[j].y;
            i = j + 1;
        }
        return out;
    }

    lineClear(x0: number, y0: number, x1: number, y1: number, radius = 0) {
        // sample finely enough that a hull cannot slip through a cell corner
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (TILE * 0.25));
        for (let s = 1; s < steps; s++) {
            const t = s / steps;
            const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
            const tx = Math.floor((x + HALF) / TILE), ty = Math.floor((y + HALF) / TILE);
            if (tx < 0 || ty < 0 || tx >= N || ty >= N) return false;
            if (!this.discFree(x, y, radius)) return false;
        }
        return true;
    }
}
