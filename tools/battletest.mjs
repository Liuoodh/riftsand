/**
 * Simulation test: drives the real game loop head-lessly (no rendering) to make
 * sure economy / AI / pathfinding / combat keep working over several minutes.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const req = createRequire(
    (process.env.SMOKE_NODE_MODULES || 'C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules') + '/',
);
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8931/index.html?auto=1';
const OUT = process.argv[3] || '.shots';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction('window.__riftsandGame != null', { timeout: 60000 });

const snap = () => page.evaluate(() => {
    const g = window.__riftsandGame;
    const mine = g.units.filter((u) => u.owner === 0);
    const theirs = g.units.filter((u) => u.owner === 1);
    const core = (o) => g.buildings.filter((b) => b.owner === o && b.def.isCore)[0];
    const hp = (b) => (b ? Math.round(b.hp) + '/' + b.maxHp : 'DEAD');
    return {
        t: Math.round(g.time),
        phase: g.phase,
        credits: Math.round(g.human.credits),
        earned: Math.round(g.human.earned),
        units0: mine.length,
        units1: theirs.length,
        buildings0: g.buildings.filter((b) => b.owner === 0).length,
        buildings1: g.buildings.filter((b) => b.owner === 1).length,
        core0: hp(core(0)),
        core1: hp(core(1)),
        kills: g.human.kills,
        lost: g.human.lost,
        projectiles: g.projectiles.length,
        fx: g.fx.length,
    };
});

// fast-forward 60s of simulation in 50ms steps
const sim = (seconds) => page.evaluate((s) => {
    const g = window.__riftsandGame;
    const step = 0.05;
    const n = Math.round(s / step);
    for (let i = 0; i < n; i++) g.update(step);
}, seconds);

console.log('T0  ', JSON.stringify(await snap()));
await sim(60);
console.log('T60 ', JSON.stringify(await snap()));
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: path.join(OUT, '06-sim60.png') });

// player army pushes the enemy base
await page.evaluate(() => {
    const g = window.__riftsandGame;
    const enemyCore = g.buildings.filter((b) => b.owner === 1 && b.def.isCore)[0];
    g.selectAllArmy();
    if (enemyCore) g.orderAttackMove(enemyCore.x, enemyCore.y);
    // reveal the enemy base so the screenshot shows the fight
    g.human.explored.fill(1);
    if (enemyCore) {
        const w = window;
        w.__cam && w.__cam.focus && w.__cam.focus(enemyCore.x, enemyCore.y);
    }
});
await sim(45);
console.log('T105', JSON.stringify(await snap()));
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: path.join(OUT, '07-fight.png') });

await sim(90);
console.log('T195', JSON.stringify(await snap()));
await sim(120);
console.log('T315', JSON.stringify(await snap()));

await page.screenshot({ path: path.join(OUT, '08-late.png') });
console.log('ERRORS', errors.length, errors.join(' | '));
await browser.close();
