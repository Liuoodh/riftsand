/**
 * Game-speed and pathing-giveup regression.
 *
 *  1. the speed ladder must scale SIMULATION time (construction, movement, ROF)
 *     without scaling real time;
 *  2. a unit ordered behind an impassable wall must give up (order -> idle)
 *     instead of retrying forever.
 *
 * usage: node tools/speedtest.mjs [url]
 */
import { createRequire } from 'node:module';
const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html?auto=1';
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
await new Promise((r) => setTimeout(r, 900));

const probeTime = () => page.evaluate(() => ({
    t: window.__riftsandGame.time,
    speed: window.__riftsandGame.speed,
    mul: window.__riftsandGame.speedMul,
}));

// ---- 1. ladder values match the retail table ----
const ladder = await page.evaluate(() => {
    const g = window.__riftsandGame;
    const out = [];
    for (let s = 0; s <= 6; s++) { g.speed = s; out.push(+g.speedMul.toFixed(3)); }
    g.speed = 2;
    return out;
});
console.log('   ladder', JSON.stringify(ladder));
check('速度阶梯 7 档', ladder.length === 7, ladder.join(' / '));
check('2 档 = 1.0x', Math.abs(ladder[2] - 1) < 0.001);
check('4 档 = 2.0x', Math.abs(ladder[4] - 2) < 0.001);
check('6 档 = 4.0x', Math.abs(ladder[6] - 4) < 0.001);
check('0 档 ≈ 0.67x', Math.abs(ladder[0] - 0.667) < 0.01, `${ladder[0]}`);

// ---- 2. simulation time scales, real time does not ----
await page.evaluate(() => { window.__riftsandGame.speed = 2; });
const a0 = await probeTime();
await new Promise((r) => setTimeout(r, 1200));
const a1 = await probeTime();
const slowRate = (a1.t - a0.t) / 1.2;

await page.evaluate(() => { window.__riftsandGame.speed = 6; });
const b0 = await probeTime();
await new Promise((r) => setTimeout(r, 1200));
const b1 = await probeTime();
const fastRate = (b1.t - b0.t) / 1.2;
await page.evaluate(() => { window.__riftsandGame.speed = 2; });

console.log(`   sim rate: 1.0x=${slowRate.toFixed(2)}/s  4.0x=${fastRate.toFixed(2)}/s`);
check('1.0x 时模拟时间≈真实时间', Math.abs(slowRate - 1) < 0.25, `${slowRate.toFixed(2)}/s`);
check('4.0x 时模拟时间≈4 倍', Math.abs(fastRate / Math.max(0.01, slowRate) - 4) < 0.7,
    `ratios ${(fastRate / slowRate).toFixed(2)}`);

// ---- 3. construction speed follows the clock ----
const buildRate = async (speed) => page.evaluate(async (sp) => {
    const g = window.__riftsandGame;
    g.speed = sp;
    const q = g.human.queues.structure;
    q.items.length = 0;
    g.queueBuild('furnace');
    const p0 = (q.items[0] || {}).progress || 0;
    await new Promise((r) => setTimeout(r, 1000));
    const p1 = (q.items[0] || {}).progress || 0;
    q.items.length = 0;
    return p1 - p0;
}, speed);
const slowBuild = await buildRate(2);
const fastBuild = await buildRate(6);
console.log(`   build progress per real second: 1.0x=${slowBuild.toFixed(3)}  4.0x=${fastBuild.toFixed(3)}`);
check('建造速度随游戏速度提高', fastBuild > slowBuild * 2.5,
    `${slowBuild.toFixed(3)} → ${fastBuild.toFixed(3)}`);

// ---- 4. stuck unit gives up instead of retrying forever ----
const stuck = await page.evaluate(async () => {
    const g = window.__riftsandGame;
    g.speed = 2;
    g.aiEnabled = false;
    const TILE = 32, HALF = 1024;
    const w = (tx, ty) => ({ x: tx * TILE + 16 - HALF, y: ty * TILE + 16 - HALF });

    // build a solid rock ring around a patch of sand
    const cx = 30, cy = 30, R = 3;
    for (let y = cy - R - 1; y <= cy + R + 1; y++) {
        for (let x = cx - R - 1; x <= cx + R + 1; x++) {
            if (x < 0 || y < 0 || x >= 64 || y >= 64) continue;
            const onRing = Math.abs(x - cx) === R || Math.abs(y - cy) === R;
            const i = y * 64 + x;
            if (onRing) { g.terrain.kind[i] = 2; g.terrain.solid[i] = 1; }
            else { g.terrain.kind[i] = 0; g.terrain.solid[i] = 0; }
        }
    }
    g.terrain.rebuildSpeed();
    g.terrain.rebuildHeight();

    const p = w(cx, cy);
    const u = g.spawnUnit(0, window.__riftsandDefs.UNITS.rampart, p.x, p.y);
    u.face = 0; u.retry = 0; u.waitT = 0;

    // order it outside the ring — unreachable
    const goal = w(cx + 9, cy);
    g.applyOrder(u, { k: 'move', x: goal.x, y: goal.y });

    const t0 = g.time;
    // let the simulation run until it gives up (or 25 sim-seconds)
    while (g.time - t0 < 25 && u.order.k !== 'idle') {
        await new Promise((r) => setTimeout(r, 120));
    }
    return {
        elapsed: +(g.time - t0).toFixed(2),
        order: u.order.k,
        retry: u.retry,
        moved: +Math.hypot(u.x - p.x, u.y - p.y).toFixed(1),
        pathLen: u.path.length,
    };
});
console.log('   stuck', JSON.stringify(stuck));
check('被围住的单位会在限时内放弃', stuck.order === 'idle', `order=${stuck.order} @${stuck.elapsed}s`);
check('放弃时清空重试计数', stuck.retry === 0);
check('放弃后不再保留路径', stuck.pathLen === 0);

// ---- 5. a reachable order still completes ----
const reachable = await page.evaluate(async () => {
    const g = window.__riftsandGame;
    g.speed = 6;
    const TILE = 32, HALF = 1024;
    const w = (tx, ty) => ({ x: tx * TILE + 16 - HALF, y: ty * TILE + 16 - HALF });
    const core = g.buildings.find((b) => b.owner === 0 && b.def.isCore);
    const bx = core ? core.tx : 12, by = core ? core.ty : 32;
    // outside the core footprint (a size-4 core covers tx..tx+3)
    const sx = Math.min(60, bx + 6);
    const s = w(sx, Math.min(60, by + 2));
    const u = g.spawnUnit(0, window.__riftsandDefs.UNITS.rampart, s.x, s.y);
    const goal = w(Math.min(61, sx + 4), Math.min(60, by + 2));
    g.applyOrder(u, { k: 'move', x: goal.x, y: goal.y });
    const t0 = g.time;
    while (g.time - t0 < 20) {
        if (Math.hypot(u.x - goal.x, u.y - goal.y) < 12) break;
        await new Promise((r) => setTimeout(r, 80));
    }
    g.speed = 2;
    return { d: +Math.hypot(u.x - goal.x, u.y - goal.y).toFixed(1), t: +(g.time - t0).toFixed(2) };
});
console.log('   reachable', JSON.stringify(reachable));
check('可达目标能正常抵达', reachable.d < 20, `dist=${reachable.d} in ${reachable.t}s`);

console.log(`ERRORS ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 3).join('\n'));
console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
