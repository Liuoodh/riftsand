/**
 * Steering / turret / traffic probe.
 *
 * Measures the three things the player reports as "the hull keeps wobbling",
 * "the turret keeps re-centring" and "friendly units jam each other":
 *
 *   1. straight run  — how many times the 8-way image changes on a dead
 *      straight leg (retail: zero, the direction is fixed at waypoint entry)
 *   2. engage        — turret facing over time against a stationary target
 *      (retail: settles once, never returns to the hull heading)
 *   3. column        — 10 tanks ordered onto one point, count of cancelled
 *      orders and of units still stuck after 60 s
 *
 * Usage: node tools/steertest.mjs [url]
 */
import { createRequire } from 'node:module';

const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html?auto=1';

const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__riftsandGame != null', { timeout: 60000 });

const out = await page.evaluate(() => {
    const g = window.__riftsandGame;
    g.aiEnabled = false;
    const { TILE, HALF, MAP_TILES } = window.__riftsandConst;
    const w = (tx, ty) => ({ x: tx * TILE + TILE / 2 - HALF, y: ty * TILE + TILE / 2 - HALF });
    const dir8Of = (rad) => Math.round((((rad * 180 / Math.PI) - 45 + 360) % 360) / 360 * 8) % 8;
    const clear = (x0, y0, x1, y1) => {
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const i = y * MAP_TILES + x;
                g.terrain.kind[i] = 0;
                g.terrain.solid[i] = 0;
            }
        }
        g.terrain.rebuildSpeed();
        g.terrain.rebuildHeight();
    };
    const drop = (u) => {
        u.dead = true;
        g.occupancy.remove(u, u.cellX, u.cellY);
        const i = g.units.indexOf(u);
        if (i >= 0) g.units.splice(i, 1);
    };

    /* ---------------- 1. straight leg ---------------- */
    clear(8, 8, 72, 72);
    const tank = g.spawnUnit(0, window.__riftsandDefs.UNITS.rampart, w(30, 50).x, w(30, 50).y);
    tank.order = { k: 'idle' };
    tank.face = 0;
    tank.turretFace = 0;
    for (let i = 0; i < 6; i++) g.update(0.05);
    g.applyOrder(tank, { k: 'move', x: w(64, 50).x, y: w(64, 50).y });

    const straight = { dirFlips: 0, faceDeltaDeg: 0, samples: [] };
    let prevDir = dir8Of(tank.face);
    let prevFace = tank.face;
    for (let i = 0; i < 240; i++) {
        g.update(0.05);
        const d = dir8Of(tank.face);
        if (d !== prevDir) straight.dirFlips++;
        straight.faceDeltaDeg += Math.abs(tank.face - prevFace) * 180 / Math.PI;
        prevDir = d;
        prevFace = tank.face;
        if (i % 40 === 0) {
            straight.samples.push({
                t: +(i * 0.05).toFixed(1),
                dir: d,
                face: +(tank.face * 180 / Math.PI).toFixed(1),
                sp: +tank.speedCur.toFixed(1),
                p: tank.path.length,
            });
        }
    }
    straight.pathLen = tank.path.length;
    straight.reached = Math.hypot(tank.x - w(64, 50).x, tank.y - w(64, 50).y);
    straight.order = tank.order.k;
    drop(tank);

    /* ---------------- 2. engage a stationary target ---------------- */
    const hq = g.place(window.__riftsandDefs.BUILDINGS.core, 1, 35, 59, true);
    if (hq) hq.done = true;
    const gunner = g.spawnUnit(0, window.__riftsandDefs.UNITS.rampart, w(28, 60).x, w(28, 60).y);
    gunner.order = { k: 'idle' };
    gunner.face = 0;
    gunner.turretFace = 0;
    gunner.turretAim = 0;
    g.update(0.05);
    g.applyOrder(gunner, { k: 'attack', target: hq });

    const engage = { samples: [], dirFlips: 0, retreats: 0, fired: 0 };
    let pDir = dir8Of(gunner.turretFace);
    let lastAim = gunner.turretAim;
    let prevCd = gunner.cd;
    for (let i = 0; i < 260; i++) {
        g.update(0.05);
        const d = dir8Of(gunner.turretFace);
        if (d !== pDir) engage.dirFlips++;
        pDir = d;
        // "recentring": the turret swung more than 25 deg away from the target
        // bearing while it was already on it
        const off = Math.abs(((gunner.turretFace - gunner.turretAim + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (off > 0.44) engage.retreats++;
        lastAim = gunner.turretAim;
        if (gunner.cd > prevCd + 1e-6) engage.fired++;
        prevCd = gunner.cd;
        if (i % 26 === 0) {
            engage.samples.push({
                t: +(i * 0.05).toFixed(1),
                turret: +(gunner.turretFace * 180 / Math.PI).toFixed(1),
                aim: +(gunner.turretAim * 180 / Math.PI).toFixed(1),
                hull: +(gunner.face * 180 / Math.PI).toFixed(1),
                dir: d,
                focus: gunner.focus ? gunner.focus.id : null,
                off: +(off * 180 / Math.PI).toFixed(1),
            });
        }
    }
    engage.fired = engage.fired;
    engage.hp = hq ? hq.hp : null;
    engage.order = gunner.order.k;
    if (hq) { hq.dead = true; }
    drop(gunner);

    /* ---------------- 3. column onto one point ---------------- */
    let giveUp = 0;
    const origGiveUp = g.giveUpOrder ? g.giveUpOrder.bind(g) : null;
    if (origGiveUp) {
        g.giveUpOrder = function (u, reason) { giveUp++; return origGiveUp(u, reason); };
    }
    const col = [];
    for (let i = 0; i < 10; i++) {
        const u = g.spawnUnit(0, window.__riftsandDefs.UNITS.rampart, w(18 + i * 3.2, 52).x, w(18 + i * 3.2, 52).y);
        u.order = { k: 'idle' };
        col.push(u);
    }
    const dest = w(56, 52);
    for (const u of col) g.applyOrder(u, { k: 'move', x: dest.x, y: dest.y });
    for (let i = 0; i < 3600; i++) g.update(0.05);   // 180 s
    const stuck = col.filter((u) => !u.dead && Math.hypot(u.x - dest.x, u.y - dest.y) > 90).length;
    const arrived = col.filter((u) => !u.dead && Math.hypot(u.x - dest.x, u.y - dest.y) <= 90).length;
    const stillMoving = col.filter((u) => !u.dead && u.path.length > 0).length;
    const column = { giveUp, stuck, arrived, stillMoving, dist: col.map((u) => Math.round(Math.hypot(u.x - dest.x, u.y - dest.y))) };
    col.forEach(drop);

    return { straight, engage, column };
});

console.log(JSON.stringify(out, null, 1));
console.log('page errors', errs.length, errs.slice(0, 2).join(' | '));
await browser.close();
