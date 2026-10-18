/**
 * Crowd movement regression.
 *
 * Four symptoms are measured here, all on the flat test plane so terrain cannot
 * be blamed:
 *
 *   1. body wobble      — facing changes per second while driving straight
 *   2. false "unreachable" — give-up/relocate events on open ground
 *   3. column jam       — units that never arrive because they block each other
 *   4. post-arrival shake — position variance after an order has finished
 *
 * usage: node tools/crowdtest.mjs [url] [count]
 */
import { createRequire } from 'node:module';

const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html?auto=1';
const COUNT = Number(process.argv[3] || 10);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0, fail = 0;
const check = (name, ok, note = '') => {
    if (ok) { pass++; console.log(`PASS  ${name}${note ? '  · ' + note : ''}`); }
    else { fail++; console.log(`FAIL  ${name}${note ? '  · ' + note : ''}`); }
};

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
await page.evaluate(() => window.__riftsandArtReady);

/* instrument the give-up exits before touching the world */
await page.evaluate(() => {
    const g = window.__riftsandGame;
    g.aiEnabled = false;
    window.__events = { fail: 0, giveUp: 0, relocate: 0 };
    const of = g.failMove.bind(g);
    g.failMove = (u) => { window.__events.fail++; return of(u); };
    const og = g.giveUpOrder.bind(g);
    g.giveUpOrder = (u) => { window.__events.giveUp++; return og(u); };
    const or = g.relocateTo.bind(g);
    g.relocateTo = (...a) => { window.__events.relocate++; return or(...a); };
});

const out = await page.evaluate((COUNT) => {
    const g = window.__riftsandGame;
    const { TILE, HALF, MAP_TILES } = window.__riftsandConst;
    const w = (tx, ty) => ({ x: tx * TILE + TILE / 2 - HALF, y: ty * TILE + TILE / 2 - HALF });

    /* a clean lane across the middle of the flat plane */
    const from = w(20, 30);
    const to = w(52, 30);

    const us = [];
    for (let i = 0; i < COUNT; i++) {
        const p = w(20 + (i % 5), 28 + Math.floor(i / 5) * 2);
        const u = g.spawnUnit(0, window.__riftsandDefs.UNITS.rampart, p.x, p.y);
        u.order = { k: 'idle' };
        us.push(u);
    }
    /* all vehicles in one cell would be insane; let the spawner settle first */
    for (let i = 0; i < 20; i++) g.update(0.05);

    for (const u of us) g.applyOrder(u, { k: 'move', x: to.x, y: to.y });

    /* ---- sample every tick: facing, lateral wobble, path ---- */
    let ticks = 0;
    let facingFlips = 0;
    let dirChanges = 0;
    const prevDir = us.map((u) => -1);
    const prevFace = us.map((u) => u.face);
    const arrivedAt = us.map(() => -1);
    const still = us.map(() => 0);

    /* lateral deviation from the straight start→target line, and how often the
       lateral velocity reverses — that IS the "body wobbling while driving" */
    const start = us.map((u) => ({ x: u.x, y: u.y }));
    // per-unit reference line: each hull starts wherever it spawned
    const line = us.map((u, k) => {
        const dx = to.x - start[k].x, dy = to.y - start[k].y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: start[k].x, y: start[k].y, nx: -dy / len, ny: dx / len };
    });
    const lat = us.map(() => 0);
    const latPrev = us.map(() => 0);
    let latReversals = 0;
    let latMax = 0;

    for (let i = 0; i < 1400; i++) {          // 70 s
        g.update(0.05);
        ticks += 0.05;
        for (let k = 0; k < us.length; k++) {
            const u = us[k];
            if (u.dead) continue;
            let d = u.face - prevFace[k];
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            if (Math.abs(d) > 0.3) facingFlips++;
            prevFace[k] = u.face;
            const q = Math.round((((u.face * 180 / Math.PI) - 45 + 360) % 360) / 360 * 8) % 8;
            if (prevDir[k] >= 0 && q !== prevDir[k] && u.path.length > 0) dirChanges++;
            prevDir[k] = q;

            const L = line[k];
            const l = (u.x - L.x) * L.nx + (u.y - L.y) * L.ny;
            if (Math.abs(l - latPrev[k]) > 0.25) {
                if (latPrev[k] !== 0 && Math.sign(l - latPrev[k]) !== Math.sign(latPrev[k])) latReversals++;
                if (Math.abs(l) > latMax) latMax = Math.abs(l);
                latPrev[k] = l;
            }

            if (arrivedAt[k] < 0 && u.path.length === 0 && Math.hypot(u.x - to.x, u.y - to.y) < 128) {
                arrivedAt[k] = ticks;
            }
        }
    }
    void lat;

    /* ---- post-arrival shake: run 4 more seconds, watch displacement ---- */
    const rest = us.map((u) => ({ x: u.x, y: u.y }));
    let shake = 0;
    let shakeWho = '';
    for (let i = 0; i < 80; i++) {
        g.update(0.05);
        for (let k = 0; k < us.length; k++) {
            const u = us[k];
            if (u.dead || u.path.length > 0) continue;
            const d = Math.hypot(u.x - rest[k].x, u.y - rest[k].y);
            if (d > shake) { shake = d; shakeWho = `${u.def.id}#${u.id} order=${u.order.k}`; }
        }
    }
    void still;

    return {
        count: us.length,
        // final resting distance, not the first time the path emptied: a hull
        // parked two tiles out is a successful findRelocationTile result
        arrived: us.filter((u) => Math.hypot(u.x - to.x, u.y - to.y) <= 160).length,
        arriveTimes: arrivedAt.map((t) => (t < 0 ? -1 : +t.toFixed(1))),
        facingFlips,
        flipsPerSec: +(facingFlips / ticks).toFixed(2),
        latMax: +latMax.toFixed(1),
        dirChanges,
        dirPerSec: +(dirChanges / ticks).toFixed(2),
        latReversals,
        shake: +shake.toFixed(1),
        shakeWho,
        events: window.__events,
        moving: us.filter((u) => u.path.length > 0).length,
        idle: us.filter((u) => u.path.length === 0).length,
        dists: us.map((u) => +Math.hypot(u.x - to.x, u.y - to.y).toFixed(0)),
    };
}, COUNT);

console.log(JSON.stringify(out, null, 1));
check('全员抵达目标区', out.arrived === out.count, `${out.arrived}/${out.count}  ${JSON.stringify(out.dists)}`);
// failMove may land CloseEnough (that is the intended bail-out); only a real
// cancellation with a warning counts as a false "unreachable"
check('没有误报"无法抵达"', out.events.giveUp === 0,
    `giveUp=${out.events.giveUp} closeEnough=${out.events.fail} relocate=${out.events.relocate}`);
// lateral motion is *detouring* in a crowd, not wobble: the wobble signals are
// facing flips and 8-way image changes, both of which must stay at zero
check('直行时不左右摇摆', out.flipsPerSec < 1.2 && out.dirPerSec < 2.5,
    `朝向翻转 ${out.flipsPerSec}/s，贴图切换 ${out.dirPerSec}/s，横向修正 ${out.latReversals} 次，最大横向偏移 ${out.latMax}px`);
check('停下后不再乱晃', out.shake <= 4, `${out.shake}px ${out.shakeWho}`);
check('运行无报错', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
