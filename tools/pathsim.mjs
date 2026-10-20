/**
 * Movement failure census.
 *
 * `pathprobe.mjs` proves the search itself finds a route. This asks the next
 * question: when a player taps a spot that A* can reach, does the unit get
 * there — and if not, WHY?
 *
 * The budget is derived per order from the path length, not a flat timeout:
 * a 2000px trip legitimately takes 40s at tank speed, and counting that as a
 * failure was hiding the real signal. A unit is only reported as stuck when it
 * stops closing the distance for STALL seconds while it still has a path.
 *
 * usage: node tools/pathsim.mjs [url] [rounds]
 */
import { createRequire } from 'node:module';

const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html?auto=1';
const ROUNDS = Number(process.argv[3] || 24);
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

const out = await page.evaluate((ROUNDS) => {
    const g = window.__riftsandGame;
    g.aiEnabled = false;
    const { TILE, HALF, MAP_TILES: N } = window.__riftsandConst;
    const UNITS = window.__riftsandDefs.UNITS;
    const STALL = 6;

    let seed = 20261018;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const world = (tx, ty) => ({ x: tx * TILE + TILE / 2 - HALF, y: ty * TILE + TILE / 2 - HALF });

    /* ---- outcome bookkeeping (the ported MoveTask reports MoveResult) ---- */
    const fails = [];
    const lastResult = new Map();
    function noteResult(u) {
        const r = u.moveTrait && u.moveTrait.lastMoveResult;
        if (r === undefined) return;
        if (lastResult.get(u.id) === r) return;
        lastResult.set(u.id, r);
        if (r === 3 /* Fail */) {
            fails.push({
                why: 'MoveResult.Fail', unit: u.def.id, order: u.order.k,
                pathLeft: u.path.length, cell: [u.cellX, u.cellY],
                target: u.moveTrait.currentWaypoint ? u.moveTrait.currentWaypoint.tile.id : null,
            });
        }
    }

    /* passable cells, giant component from the human base */
    const passable = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) passable[y * N + x] = g.isBlocked(x, y) ? 0 : 1;
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const seen = new Uint8Array(N * N);
    const stack = [32 * N + 32];
    seen[32 * N + 32] = 1;
    while (stack.length) {
        const cur = stack.pop();
        const cx = cur % N, cy = (cur / N) | 0;
        for (const [dx, dy] of DIRS) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            const nid = ny * N + nx;
            if (seen[nid] || !passable[nid]) continue;
            if (dx && dy && (!passable[cy * N + nx] || !passable[ny * N + cx])) continue;
            seen[nid] = 1; stack.push(nid);
        }
    }
    const spots = [];
    for (let i = 0; i < seen.length; i++) if (seen[i]) spots.push(i);

    const results = { arrived: 0, gaveUp: 0, stuck: 0, moving: 0, total: 0 };
    const samples = [];
    const stalls = [];

    function runOne(unitId, squad) {
        const starts = [[24, 24], [26, 22], [22, 26], [28, 26], [26, 28]];
        const us = [];
        for (let k = 0; k < squad; k++) {
            const p = world(starts[k][0], starts[k][1]);
            const u = g.spawnUnit(0, UNITS[unitId], p.x, p.y);
            u.order = { k: 'idle' };
            us.push(u);
        }
        /* goals are drawn from cells within ~700px so travel time stays sane */
        const from = us[0];
        let target = null;
        for (let tries = 0; tries < 40; tries++) {
            const c = spots[(rnd() * spots.length) | 0];
            const w = world(c % N, (c / N) | 0);
            const d = Math.hypot(w.x - from.x, w.y - from.y);
            if (d > 260 && d < 760) { target = w; break; }
        }
        if (!target) {
            for (const u of us) { u.dead = true; g.units.splice(g.units.indexOf(u), 1); g.occupancy.unoccupySingleTile(u.tile, u); }
            return;
        }
        for (const u of us) g.applyOrder(u, { k: 'move', x: target.x, y: target.y });

        const speed = Math.max(20, UNITS[unitId].speed);
        const budget = 20 + 900 / speed;
        let t = 0;
        const best = us.map(() => Infinity);
        const lastGain = us.map(() => 0);
        while (t < budget) {
            g.update(0.05); t += 0.05;
            for (const u of us) noteResult(u);
            let done = true;
            for (let k = 0; k < us.length; k++) {
                const d = Math.hypot(us[k].x - target.x, us[k].y - target.y);
                if (d < best[k] - 4) { best[k] = d; lastGain[k] = t; }
                if (us[k].path.length > 0) done = false;
            }
            if (done) break;
        }
        const per = us.map((u, k) => {
            const d = Math.hypot(u.x - target.x, u.y - target.y);
            let kind = 'moving';
            if (d <= 44) kind = 'arrived';
            else if (u.path.length === 0) kind = 'gaveUp';
            else if (t - lastGain[k] > STALL) kind = 'stuck';
            results[kind]++;
            results.total++;
            if (kind === 'stuck' && stalls.length < 8) {
                /* the ported MoveTask keeps tile nodes, not world points */
                const wp = u.path[0];
                const wc = wp ? [wp.tile.rx, wp.tile.ry] : null;
                const wpWorld = wc ? { x: wc[0] * TILE + TILE / 2 - HALF, y: wc[1] * TILE + TILE / 2 - HALF } : null;
                stalls.push({
                    unit: unitId, d: +d.toFixed(0), best: +best[k].toFixed(0),
                    t: +t.toFixed(1), sinceGain: +(t - lastGain[k]).toFixed(1),
                    order: u.order.k, pathLeft: u.path.length,
                    cell: [u.cellX, u.cellY],
                    speed: +u.speedCur.toFixed(1), blk: u.blockedNow,
                    terrainMul: +u.terrainMul.toFixed(2), defSpeed: u.def.speed,
                    face: +(u.face * 57.3).toFixed(0),
                    dir: u.direction,
                    moveState: u.moveTrait.moveState,
                    collisionState: u.moveTrait.collisionState,
                    task: u.orders.hasTasks(),
                    harv: !!u.isHarvester,
                    pos: [+u.x.toFixed(1), +u.y.toFixed(1)],
                    accel: u.accel, speedCap: u.speedCap, slowed: u.slowed,
                    wp: wpWorld ? [+wpWorld.x.toFixed(0), +wpWorld.y.toFixed(0)] : null,
                    wpCell: wc,
                    wpTerrainBlocked: wc ? g.isBlocked(wc[0], wc[1]) : null,
                    wpHasRoom: wp ? g.occupancy.hasRoomFor(u, wc[0], wc[1]) : null,
                    inWallNow: g.worldBlockedAt(u.x, u.y, u.radius),
                    dWp: wpWorld ? +Math.hypot(wpWorld.x - u.x, wpWorld.y - u.y).toFixed(0) : null,
                });
            }
            return { d: +d.toFixed(0), kind, order: u.order.k };
        });
        if (samples.length < 6) samples.push({ unitId, squad, t: +t.toFixed(1), per });
        for (const u of us) {
            u.dead = true;
            g.units.splice(g.units.indexOf(u), 1);
            g.occupancy.unoccupySingleTile(u.tile, u);
        }
    }

    /* the squad / other-hull runs scale with ROUNDS so a quick pass is quick */
    const sub = Math.max(1, Math.round(ROUNDS / 4));
    for (let r = 0; r < ROUNDS; r++) runOne('rampart', 1);
    for (let r = 0; r < Math.min(6, sub + 1); r++) runOne('pebble', 5);
    for (let r = 0; r < sub; r++) runOne('hourglass', 1);
    for (let r = 0; r < sub; r++) runOne('lizard', 1);

    return {
        map: g.options.mapId,
        results,
        stuckRate: results.total ? +((results.stuck / results.total) * 100).toFixed(1) : 0,
        failCount: fails.length,
        fails: fails.filter((f) => f.order !== 'capture' && f.order !== 'idle').slice(0, 10),
        stalls, samples,
    };
}, ROUNDS);

console.log('SUMMARY', JSON.stringify(out.results), 'stuckRate', out.stuckRate, 'fails', out.failCount);
console.log('STALLS', JSON.stringify(out.stalls.slice(0, 4)));
console.log(JSON.stringify(out, null, 2));
console.log('ERRORS', errors.length, errors.slice(0, 2).join(' | '));
await browser.close();
process.exit(out.results.stuck === 0 ? 0 : 1);
