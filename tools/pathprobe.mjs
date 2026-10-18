/**
 * Path-finding ground-truth probe.
 *
 * The complaint being measured: "the game says a target is unreachable while a
 * road is plainly visible". A* quality cannot be judged by eyeballing one path,
 * so this script:
 *
 *   1. builds the true reachability map with a flood fill over passable cells
 *      (the same predicate A* uses: terrain solid + structures),
 *   2. asks the real `PathFinder` for a few thousand random pairs,
 *   3. reports every case where the flood fill found a route and A* did not.
 *
 * Anything in the "miss" column is a genuine bug — the ground truth and the
 * search disagree on the same graph.
 *
 * usage: node tools/pathprobe.mjs [url] [samples]
 */
import { createRequire } from 'node:module';

const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html?auto=1';
const SAMPLES = Number(process.argv[3] || 600);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__riftsandGame != null', { timeout: 60000 });

const report = await page.evaluate((SAMPLES) => {
    const g = window.__riftsandGame;
    g.aiEnabled = false;
    const { TILE, HALF, MAP_TILES: N } = window.__riftsandConst;

    /* deterministic RNG so a failure can be reproduced */
    let seed = 12345;
    const rnd = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };

    const passable = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) passable[y * N + x] = g.isBlocked(x, y) ? 0 : 1;

    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

    /** flood fill from a cell; returns Uint8Array of reachable cells */
    function flood(sx, sy) {
        const seen = new Uint8Array(N * N);
        const q = new Int32Array(N * N);
        let head = 0, tail = 0;
        const s = sy * N + sx;
        seen[s] = 1; q[tail++] = s;
        while (head < tail) {
            const cur = q[head++];
            const cx = cur % N, cy = (cur / N) | 0;
            for (const [dx, dy] of DIRS) {
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
                const nid = ny * N + nx;
                if (seen[nid] || !passable[nid]) continue;
                if (dx !== 0 && dy !== 0) {
                    if (!passable[cy * N + nx] || !passable[ny * N + cx]) continue;
                }
                seen[nid] = 1; q[tail++] = nid;
            }
        }
        return seen;
    }

    /* a representative hull: the main battle tank (radius 13 -> steer 5.85) */
    const def = window.__riftsandDefs.UNITS.rampart;
    const radius = def.radius * 0.45;

    const free = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (passable[y * N + x]) free.push(y * N + x);

    const world = (c) => ({ x: (c % N) * TILE + TILE / 2 - HALF, y: ((c / N) | 0) * TILE + TILE / 2 - HALF });

    /* one flood fill from the first sample gives the giant component; sampling
       across it keeps every pair genuinely connected so any miss is a bug */
    const comp = flood(free[0] % N, (free[0] / N) | 0);
    const inComp = free.filter((c) => comp[c]);

    const miss = [];
    const short = [];
    let ok = 0, total = 0, sumRatio = 0, maxMs = 0;

    for (let i = 0; i < SAMPLES; i++) {
        const a = inComp[(rnd() * inComp.length) | 0];
        const b = inComp[(rnd() * inComp.length) | 0];
        if (a === b) continue;
        const pa = world(a), pb = world(b);
        /* the search is only guaranteed for points in the same connected area */
        if (!flood(b % N, (b / N) | 0)[a]) continue;
        total++;

        const t0 = performance.now();
        const path = g.finder.find(pa.x, pa.y, pb.x, pb.y, { radius });
        const ms = performance.now() - t0;
        if (ms > maxMs) maxMs = ms;

        const end = path && path.length ? path[path.length - 1] : null;
        const dEnd = end ? Math.hypot(end.x - pb.x, end.y - pb.y) : Infinity;
        if (!path || path.length === 0 || dEnd > 20) {
            if (miss.length < 24) {
                miss.push({
                    from: [a % N, (a / N) | 0], to: [b % N, (b / N) | 0],
                    nodes: path ? path.length : 0, dEnd: +Math.min(dEnd, 9999).toFixed(0),
                });
            }
            continue;
        }
        ok++;
        /* compare against the Manhattan-ish optimum on the same grid */
        let sum = 0;
        for (let k = 1; k < path.length; k++) sum += Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y);
        const ideal = Math.max(Math.abs((a % N) - (b % N)), Math.abs(((a / N) | 0) - ((b / N) | 0))) * TILE;
        sumRatio += sum / Math.max(1, ideal);
        if (sum / Math.max(1, ideal) > 2.4 && short.length < 12) {
            short.push({ from: [a % N, (a / N) | 0], to: [b % N, (b / N) | 0], ratio: +(sum / Math.max(1, ideal)).toFixed(2) });
        }
    }

    return {
        map: g.options.mapId,
        total, ok, missCount: total - ok,
        missRate: total ? +(((total - ok) / total) * 100).toFixed(2) : 0,
        avgDetour: ok ? +(sumRatio / ok).toFixed(2) : 0,
        maxMs: +maxMs.toFixed(1),
        miss: miss.slice(0, 12),
        longDetour: short,
    };
}, SAMPLES);

console.log(JSON.stringify(report, null, 2));
console.log('ERRORS', errors.length, errors.slice(0, 2).join(' | '));
await browser.close();
process.exit(report.missCount === 0 ? 0 : 1);
