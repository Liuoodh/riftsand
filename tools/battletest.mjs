/**
 * Simulation test: drives the real game loop head-lessly (no rendering) to make
 * sure economy / production / AI / pathfinding / combat / super weapons keep
 * working over several minutes.
 *
 * A tiny scripted "player" plays along so the human side is not idle: it queues
 * structures, places them, builds units and pushes the enemy base.
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
await page.evaluateOnNewDocument(() => {
    document.addEventListener('DOMContentLoaded', () => {
        const l = document.createElement('link');
        l.rel = 'icon';
        l.href = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        document.head.appendChild(l);
    });
});
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text()); } });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction('window.__riftsandGame != null', { timeout: 60000 });

/* ------------------------------------------------------------------ */
/* scripted human: exercises the same API the HUD uses                 */
/* ------------------------------------------------------------------ */
await page.evaluate(() => {
    const g = window.__riftsandGame;
    window.__botStep = 0;

    const findSpot = (def) => {
        const core = g.buildings.find((b) => b.owner === 0 && b.def.isCore);
        if (!core) return null;
        for (let r = 4; r <= 12; r++) {
            for (let a = 0; a < 20; a++) {
                const ang = (a / 20) * Math.PI * 2 + r * 0.5;
                const tx = Math.round(core.tx + Math.cos(ang) * r);
                const ty = Math.round(core.ty + Math.sin(ang) * r);
                if (g.canPlace(def, tx, ty, 0).ok) return { tx, ty };
            }
        }
        return null;
    };

    window.__playerBot = () => {
        const h = g.human;
        if (g.phase !== 'playing') return;
        const q = h.queues.structure;

        // place finished structures
        if (q.ready) {
            const ready = g.readyStructure(h);
            if (ready) {
                const def = g.availableStructures(h).find((d) => d.id === ready.defId);
                const spot = def && findSpot(def);
                if (spot) {
                    g.takeReadyStructure(0);
                    g.place(def, 0, spot.tx, spot.ty, false);
                }
            }
        }

        // keep one structure queued, following a sensible tech path
        if (!q.ready && q.items.length === 0) {
            const wish = ['foundry', 'furnace', 'archive', 'sluice', 'turret', 'airpad', 'orbital', 'aegis'];
            const def = g.availableStructures(h).find((d) => wish.includes(d.id) && !g.lockReason(h, d)
                && g.countBuilding(h, d.id) === 0);
            if (def) g.queueBuild(def.id);
        }

        // unit production: keep both queues busy
        const iq = h.queues.infantry;
        const vq = h.queues.vehicle;
        if (iq.items.length < 2 && g.time % 7 < 1) {
            const opts = g.availableUnitsFor(h, 'infantry').filter((d) => !g.lockReason(h, d));
            if (opts.length) g.queueUnit('infantry', opts[Math.floor(g.time) % opts.length].id, 1);
        }
        const harvDef = g.availableUnitsFor(h, 'vehicle').find((d) => d.kind === 'harvester');
        const harvCount = g.units.filter((u) => u.owner === 0 && u.isHarvester).length
            + vq.items.filter((i) => i.defId === (harvDef && harvDef.id)).length;
        if (vq.items.length < 2 && g.time % 5 < 1) {
            if (harvDef && harvCount < 6) {
                g.queueUnit('vehicle', harvDef.id, 1);
            } else {
                const opts = g.availableUnitsFor(h, 'vehicle').filter((d) => !g.lockReason(h, d) && !d.mcv && d.kind !== 'harvester');
                if (opts.length) g.queueUnit('vehicle', opts[Math.floor(g.time) % opts.length].id, 1);
            }
        }
        if (g.time % 9 < 1 && g.factoryCount(h, 'aircraft') > 0) {
            const opts = g.availableUnitsFor(h, 'aircraft').filter((d) => !g.lockReason(h, d));
            if (opts.length && h.queues.aircraft.items.length < 1) g.queueUnit('aircraft', opts[0].id, 1);
        }

        // push every 45 seconds
        if (g.time - (window.__lastPush || -999) > 45) {
            window.__lastPush = g.time;
            const core = g.buildings.find((b) => b.owner === 1 && b.def.isCore);
            g.selectAllArmy();
            if (core) g.orderAttackMove(core.x, core.y);
        }

        // fire super weapons when they are up
        for (const s of h.sw) {
            if (!s.ready) continue;
            const core = g.buildings.find((b) => b.owner === 1 && b.def.isCore);
            if (!core) continue;
            const field = ['aegis', 'mirage'].includes(s.id);
            if (field) {
                const army = g.units.filter((u) => u.owner === 0 && !u.isHarvester);
                if (army.length < 4) continue;
                let cx = 0, cy = 0;
                for (const u of army) { cx += u.x; cy += u.y; }
                g.launchSuperWeapon(s.id, cx / army.length, cy / army.length, 0);
            } else {
                g.launchSuperWeapon(s.id, core.x, core.y, 0);
            }
        }
    };
});

const snap = () => page.evaluate(() => {
    const g = window.__riftsandGame;
    const mine = g.units.filter((u) => u.owner === 0);
    const theirs = g.units.filter((u) => u.owner === 1);
    const core = (o) => g.buildings.filter((b) => b.owner === o && b.def.isCore)[0];
    const hp = (b) => (b ? Math.round(b.hp) + '/' + b.maxHp : 'DEAD');
    const q = (pid, cat) => g.players[pid].queues[cat].items.length;
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
        q0: [q(0, 'structure'), q(0, 'infantry'), q(0, 'vehicle'), q(0, 'aircraft')],
        sw0: g.human.sw.map((s) => s.id + (s.ready ? ':ready' : ':' + Math.round(s.total - s.t))),
        zones: g.zones.length,
        crates: g.crates.length,
        vets: mine.filter((u) => u.level > 0).length,
        maxLevel: Math.max(0, ...mine.map((u) => u.level)),
        projectiles: g.projectiles.length,
        fx: g.fx.length,
    };
});

const sim = (seconds, bot = true) => page.evaluate((s, useBot) => {
    const g = window.__riftsandGame;
    const step = 0.05;
    const n = Math.round(s / step);
    for (let i = 0; i < n; i++) {
        g.update(step);
        if (useBot && i % 60 === 0) window.__playerBot();
    }
}, seconds, bot);

console.log('T0  ', JSON.stringify(await snap()));
await sim(60);
console.log('T60 ', JSON.stringify(await snap()));
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: path.join(OUT, '06-sim60.png') });

await sim(60);
console.log('T120', JSON.stringify(await snap()));

// reveal the enemy base so the screenshot shows the fight
await page.evaluate(() => {
    const g = window.__riftsandGame;
    g.human.explored.fill(1);
    const core = g.buildings.find((b) => b.owner === 1 && b.def.isCore);
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    if (core && app.cam) app.cam.focus(core.x, core.y, true);
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: path.join(OUT, '07-fight.png') });

await sim(120);
console.log('T240', JSON.stringify(await snap()));
await sim(120);
console.log('T360', JSON.stringify(await snap()));

await page.evaluate(() => {
    const g = window.__riftsandGame;
    const core = g.buildings.find((b) => b.owner === 1 && b.def.isCore) || g.buildings.find((b) => b.owner === 0 && b.def.isCore);
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    if (core && app.cam) app.cam.focus(core.x, core.y, true);
});
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: path.join(OUT, '08-late.png') });

console.log('ERRORS', errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(errors.length ? 1 : 0);
