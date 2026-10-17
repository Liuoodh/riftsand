/**
 * Physics showcase: stages a tank skirmish on dunes, freezes on an explosion
 * frame, and grabs a terrain/ore shot. Used for the docs screenshots.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const req = createRequire(
    (process.env.SMOKE_NODE_MODULES || 'C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules') + '/',
);
const puppeteer = req('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html?auto=1';
const OUT = process.argv[3] || '.shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.evaluateOnNewDocument(() => {
    document.addEventListener('DOMContentLoaded', () => {
        const l = document.createElement('link');
        l.rel = 'icon';
        l.href = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        document.head.appendChild(l);
    });
});
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction('window.__riftsandGame != null', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 700));

const staged = await page.evaluate(() => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    const h = g.human;
    h.credits = 90000;

    // a wide open lane somewhere in the middle of the map
    let lane = null;
    for (let ty = 18; ty < 46 && !lane; ty++) {
        for (let tx = 22; tx < 42; tx++) {
            let ok = true;
            for (let y = ty; y < ty + 5 && ok; y++) for (let x = tx; x < tx + 14; x++) {
                if (g.isBlocked(x, y)) { ok = false; break; }
            }
            if (ok) { lane = { tx, ty }; break; }
        }
    }
    lane = lane || { tx: 28, ty: 28 };
    const W = (tx, ty) => ({ x: tx * 32 + 16 - 1024, y: ty * 32 + 16 - 1024 });
    const base = W(lane.tx, lane.ty);

    const veh = g.availableUnitsFor(h, 'vehicle');
    const inf = g.availableUnitsFor(h, 'infantry');
    const tank = veh.find((d) => d.id === 'rampart');
    const mortar = veh.find((d) => d.weapon && d.weapon.ballistic);
    const rifle = inf.find((d) => d.weapon && !d.cloak);
    const enemyTank = g.availableUnitsFor(g.players[1], 'vehicle').find((d) => d.id === 'lizard');
    const enemyInf = g.availableUnitsFor(g.players[1], 'infantry').find((d) => d.weapon && !d.cloak);

    // friendly armour column
    const mine = [];
    for (let i = 0; i < 3; i++) mine.push(g.spawnUnit(0, tank, base.x + 40 + i * 46, base.y + 70 + (i % 2) * 30));
    mine.push(g.spawnUnit(0, mortar, base.x + 30, base.y + 130));
    for (let i = 0; i < 4; i++) mine.push(g.spawnUnit(0, rifle, base.x + 10 + i * 26, base.y + 180));

    // enemy line
    const foes = [];
    for (let i = 0; i < 3; i++) foes.push(g.spawnUnit(1, enemyInf, base.x + 330 + i * 22, base.y + 110 + (i % 2) * 24));
    foes.push(g.spawnUnit(1, enemyTank, base.x + 360, base.y + 60));
    foes.push(g.spawnUnit(1, enemyTank, base.x + 390, base.y + 165));

    g.human.explored.fill(1);
    g.updateVisibility(g.human);
    app.cam.setZoom(1.15);
    app.cam.zoom = 1.15;
    app.cam.focus(base.x + 210, base.y + 110, true);
    app.cam.update(1);

    g.selectAllArmy();
    const core = g.buildings.find((b) => b.owner === 1 && b.def.isCore);
    g.orderAttackMove(core.x, core.y);

    // advance until something is burning, then freeze on that frame
    let frozen = false;
    for (let i = 0; i < 260; i++) {
        g.update(0.05);
        if (i > 40 && g.fx.some((f) => f.kind === 'boom' && f.k < 0.4)) {
            for (let k = 0; k < 3; k++) g.update(0.03);
            app.renderer.fog.update(g.human, 1);
            app.ui.mode = 'paused';
            frozen = true;
            break;
        }
    }
    return {
        frozen,
        fx: g.fx.length,
        decals: g.decals.length,
        projectiles: g.projectiles.length,
        lane,
        units: g.units.filter((u) => !u.dead).length,
    };
});
console.log('staged', JSON.stringify(staged));
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: path.join(OUT, 'p1-battle.png') });

// second shot: ore field with harvesters actually driving on the ore
await page.evaluate(() => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    const h = g.human;
    app.ui.mode = 'game';
    const node = g.terrain.nodes.filter((n) => n.amount > 0)
        .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0];
    const harv = g.availableUnitsFor(h, 'vehicle').find((d) => d.kind === 'harvester');
    g.human.explored.fill(0);
    for (let i = 0; i < 3; i++) {
        const u = g.spawnUnit(0, harv, node.x + (i - 1) * 34, node.y + 26);
        u.invulnUntil = 1e9;
        g.startHarvest(u, node);
    }
    app.cam.setZoom(1.15);
    app.cam.zoom = 1.15;
    app.cam.focus(node.x, node.y - 10, true);
    app.cam.update(1);
    let mining = 0;
    for (let i = 0; i < 400; i++) {
        g.update(0.05);
        mining = g.units.filter((u) => u.owner === 0 && u.isHarvester && u.order.phase === 'mining'
            && Math.hypot(u.x - node.x, u.y - node.y) < 60).length;
        if (mining >= 2) break;
    }
    app.renderer.fog.update(g.human, 1);
    app.ui.mode = 'paused';
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: path.join(OUT, 'p2-terrain.png') });

console.log('ERRORS', errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
