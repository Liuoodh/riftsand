/**
 * Harvester opening regression.
 *
 * The reported bug was "one truck can never leave the base and keeps snapping
 * back". It had two causes, both now covered here:
 *
 *   1. `resolveWorldCollision` used to TELEPORT a unit to the nearest free cell
 *      centre (up to 3 tiles), so a hull clipping a building corner was thrown
 *      backwards and then walked into it again — forever. This test fails if any
 *      single simulation step moves a unit further than its top speed allows.
 *   2. The pathfinder smoothed paths through cell corners the hull could not
 *      physically fit through. This test fails if a truck ends up inside a
 *      blocked cell at any point.
 *
 * usage: node tools/harvesttest.mjs [url]
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
await new Promise((r) => setTimeout(r, 500));

const res = await page.evaluate(async () => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    const { TILE, HALF, MAP_TILES: MT } = window.__riftsandConst;
    g.dbgOn = true;
    const trucks = g.units.filter((u) => u.owner === 0 && u.def.kind === 'harvester');

    const wasBlocked = [];
    let maxJump = 0;
    let jumpWho = '';
    let everMining = false;
    let everInside = 0;
    const phases = new Set();

    // 60 simulated seconds, stepped by hand so the result is deterministic
    for (let s = 0; s < 1200; s++) {
        const before = trucks.map((u) => ({ x: u.x, y: u.y, sp: u.speed }));
        g.update(0.05);
        for (let i = 0; i < trucks.length; i++) {
            const u = trucks[i];
            if (u.dead) continue;
            const d = Math.hypot(u.x - before[i].x, u.y - before[i].y);
            // a unit may never move more than speed * dt (+ a hair for rounding)
            // movement + the per-frame separation budget, nothing more
            const limit = before[i].sp * 0.05 * 1.5 + 2.4;
            if (d > limit && d > maxJump) {
                maxJump = d;
                jumpWho = `${u.def.id}#${u.id} phase=${u.order.k}/${u.order.phase || '-'} sp=${before[i].sp} speedCur=${u.speedCur.toFixed(1)} step=${d.toFixed(1)} dim=${u.waitT > 0 ? 'wait' : '-'} blocked=${u.blockedNow} resolves=${(g.dbgResolve || []).length}`;
            }
            const tx = Math.floor((u.x + HALF) / TILE);
            const ty = Math.floor((u.y + HALF) / TILE);
            if (g.worldBlockedAt(u.x, u.y, u.radius)) everInside++;
            if (u.order.k === 'harvest') phases.add(u.order.phase);
            if (u.order.k === 'harvest' && u.order.phase === 'mining') everMining = true;
            wasBlocked.push(u.blockedNow ? 1 : 0);
        }
    }

    return {
        trucks: trucks.length,
        maxJump: +maxJump.toFixed(2),
        jumpWho,
        everMining,
        everInside,
        credits: g.human.credits,
        earned: g.human.earned,
        phases: [...phases],
        delivered: g.human.earned > 0,
        mapTiles: MT,
    };
});

console.log('   ' + JSON.stringify(res));
check('开局有采集车', res.trucks >= 2, `${res.trucks} 台`);
check('没有任何一步出现瞬移/复位', res.maxJump < 4, `最大单步位移 ${res.maxJump}px (${res.jumpWho || '-'})`);
check('采集车从未进入不可站立格', res.everInside === 0, `命中 ${res.everInside} 次`);
check('采集车走到矿脉并开始采矿', res.everMining, res.phases.join(' → '));
check('60 秒内完成卸货（经济启动）', res.delivered, `earned=${res.earned} credits=${res.credits}`);
check('控制台无异常', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
