/**
 * Visual showcase: stages the v0.3 systems (new units, veteran chevrons, repair,
 * rally flag, super weapon fields / strike) and grabs screenshots for the docs.
 *
 * usage: node tools/showcase.mjs [url] [outDir]
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
await new Promise((r) => setTimeout(r, 800));

const staged = await page.evaluate(() => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    const h = g.human;
    h.credits = 90000;

    const core = g.buildings.find((b) => b.owner === 0 && b.def.isCore);
    const defs = g.availableStructures(h);

    const spotNear = (def) => {
        for (let r = 4; r <= 12; r++) {
            for (let a = 0; a < 20; a++) {
                const ang = (a / 20) * Math.PI * 2 + r * 0.45;
                const tx = Math.round(core.tx + Math.cos(ang) * r);
                const ty = Math.round(core.ty + Math.sin(ang) * r);
                if (g.canPlace(def, tx, ty, 0, true).ok) return { tx, ty };
            }
        }
        return null;
    };

    // two power plants so the grid survives two super weapons
    const pw = defs.find((d) => d.power > 0);
    for (let i = 0; i < 2; i++) {
        const sp = spotNear(pw);
        if (sp) g.place(pw, 0, sp.tx, sp.ty, true);
    }
    const swDef = defs.find((d) => d.superWeapon === 'orbital');
    const fieldDef = defs.find((d) => d.superWeapon === 'aegis');
    let swOk = false, fieldOk = false;
    const s1 = spotNear(swDef);
    if (s1) swOk = !!g.place(swDef, 0, s1.tx, s1.ty, true);
    const s2 = spotNear(fieldDef);
    if (s2) fieldOk = !!g.place(fieldDef, 0, s2.tx, s2.ty, true);

    // new infantry: one engineer, one elite stealth
    const inf = g.availableUnitsFor(h, 'infantry');
    const engDef = inf.find((d) => d.engineer);
    const stealthDef = inf.find((d) => d.cloak);
    g.spawnUnit(0, engDef, core.x - 120, core.y - 150);
    const st = g.spawnUnit(0, stealthDef, core.x - 80, core.y - 175);
    if (st) g.gainXpAmount(st, st.def.cost * 6.2);
    const tank = g.units.find((u) => u.owner === 0 && u.def.kind === 'vehicle');
    if (tank) g.gainXpAmount(tank, tank.def.cost * 3.1);

    // base car parked nearby
    const mcvDef = g.availableUnitsFor(h, 'vehicle').find((d) => d.mcv);
    if (mcvDef) g.spawnUnit(0, mcvDef, core.x + 90, core.y - 190);

    // rally flag + a refinery under repair
    core.rally = { x: core.x + 130, y: core.y - 50 };
    const refinery = g.buildings.find((b) => b.owner === 0 && b.def.dropoff);
    if (refinery) { refinery.hp = refinery.maxHp * 0.55; refinery.repairing = true; }

    g.update(0.3);
    g.selectBuilding(core);
    app.cam.setZoom(1.0);
    app.cam.zoom = 1.0;
    app.cam.focus(core.x + 20, core.y - 50, true);
    app.cam.update(1);
    return {
        swOk, fieldOk, sw: h.sw.map((x) => x.id),
        power: g.power(h), radar: g.radarOnline(h),
    };
});
console.log('staged', JSON.stringify(staged));

await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: path.join(OUT, 's1-base.png') });

// force shield on our own army
await page.evaluate(() => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    const core = g.buildings.find((b) => b.owner === 0 && b.def.isCore);
    const st = g.swOf(g.human, 'aegis');
    if (st) { st.t = st.total; st.ready = true; g.update(0.05); }
    g.launchSuperWeapon('aegis', core.x - 40, core.y - 110, 0);
    for (let i = 0; i < 8; i++) g.update(0.05);
    app.cam.focus(core.x - 20, core.y - 90, true);
    app.cam.update(1);
});
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: path.join(OUT, 's2-shield.png') });

// orbital strike on the enemy base: warning crosshair, then impact
await page.evaluate(() => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    const core = g.buildings.find((b) => b.owner === 1 && b.def.isCore);
    const st = g.swOf(g.human, 'orbital');
    if (st) { st.t = st.total; st.ready = true; g.update(0.05); }
    g.human.explored.fill(1);
    // a scout next to the target keeps the area lit so the strike is readable
    const scoutDef = g.availableUnitsFor(g.human, 'infantry').find((d) => d.weapon && !d.cloak);
    if (core && scoutDef) {
        const scout = g.spawnUnit(0, scoutDef, core.x + 100, core.y + 60);
        scout.invulnUntil = 1e9;
    }
    g.updateVisibility(g.human);
    app.cam.setZoom(0.9);
    app.cam.zoom = 0.9;
    if (core) app.cam.focus(core.x, core.y, true);
    app.cam.update(1);
    if (core) g.launchSuperWeapon('orbital', core.x, core.y, 0);
    for (let i = 0; i < 5; i++) g.update(0.05);
    // manual updates do not run the renderer, so refresh the shroud explicitly
    app.renderer.fog.update(g.human, 1);
    app.ui.mode = 'paused';
});
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: path.join(OUT, 's3-orbital-warning.png') });

// second strike, frozen right on the impact frame
await page.evaluate(() => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    app.ui.mode = 'game';
    const core = g.buildings.find((b) => b.owner === 1 && b.def.isCore);
    const st = g.swOf(g.human, 'orbital');
    if (st) { st.t = st.total; st.ready = true; g.update(0.05); }
    if (core) g.launchSuperWeapon('orbital', core.x, core.y, 0);
    for (let i = 0; i < 30; i++) g.update(0.05);
    app.renderer.fog.update(g.human, 1);
    app.ui.mode = 'paused';
});
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: path.join(OUT, 's4-orbital-impact.png') });

// vehicle tab icons
await page.evaluate(() => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    app.ui.tab = 'vehicle';
    app.ui.cardSig = '';
    app.ui.refreshCards();
    app.game.clearSelection();
    const core = app.game.buildings.find((b) => b.owner === 0 && b.def.isCore);
    app.cam.setZoom(1.0);
    app.cam.zoom = 1.0;
    app.cam.focus(core.x, core.y - 60, true);
    app.cam.update(1);
});
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: path.join(OUT, 's5-vehicles.png') });

console.log('ERRORS', errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
