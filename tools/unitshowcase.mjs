/**
 * Close-up showcase: frames, turret tracking and terrain lift.
 * usage: node tools/unitshowcase.mjs [url] [outDir]
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
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

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__riftsandGame != null', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 900));

const shot = async (name) => {
    await new Promise((r) => setTimeout(r, 420));
    await page.screenshot({ path: path.join(OUT, name) });
    console.log('shot', name);
};

// 1) line up two lances of tanks facing each other, tight camera
const staging = await page.evaluate(() => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    g.aiEnabled = false;
    const { TILE, HALF, MAP_TILES: MT } = window.__riftsandConst;
    const w = (tx, ty) => ({ x: tx * TILE + 16 - HALF, y: ty * TILE + 16 - HALF });
    // clear a patch
    for (let y = 26; y < 40; y++) for (let x = 26; x < 40; x++) {
        const i = y * MT + x;
        g.terrain.kind[i] = 0; g.terrain.solid[i] = 0;
    }
    g.terrain.rebuildSpeed();
    g.terrain.rebuildHeight();
    g.rebuildPassability?.();
    app.renderer.fog.update(g.human, 99);

    const spawn = (id, tx, ty, owner) => {
        const p = w(tx, ty);
        const u = g.spawnUnit(owner, window.__riftsandDefs.UNITS[id], p.x, p.y);
        if (u) { u.face = owner === 0 ? 0 : Math.PI; u.turretFace = u.face; }
        return u;
    };
    // player armour column, facing east
    const a = [spawn('rampart', 30, 31, 0), spawn('rampart', 30, 33, 0), spawn('lizard', 29, 35, 0)];
    // enemy armour, facing west
    const b = [spawn('rampart', 37, 32, 1), spawn('rampart', 37, 34, 1), spawn('gnat', 38, 30, 1)];
    // infantry squad in the middle so the walk cycle is visible
    const inf = [spawn('pebble', 33, 31, 0), spawn('pebble', 34, 33, 0), spawn('sapper', 33, 35, 0)];
    // freeze AI aggression so the shot stays posed
    g.units.forEach((u) => { if (u.owner === 1) u.scan = 999; });
    return { units: g.units.length };
});
console.log('staged', JSON.stringify(staging));

// aim the camera between the two groups
await page.evaluate(() => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const { TILE, HALF, MAP_TILES: MT } = window.__riftsandConst;
    const wx = 34 * TILE + 16 - HALF, wy = 33 * TILE + 16 - HALF;
    const rx = wx / TILE, ry = wy / TILE;
    app.cam.focus((rx - ry) * 28, (rx + ry) * 14, true);
    app.cam.setZoom(1.9);
    app.cam.focus((rx - ry) * 28, (rx + ry) * 14, true);
});
await shot('u1-armour-line.png');

// 2) order the player armour to advance: turrets swing, treads scroll
await page.evaluate(() => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    const { TILE, HALF, MAP_TILES: MT } = window.__riftsandConst;
    const tx = 36 * TILE + 16 - HALF, ty = 33 * TILE + 16 - HALF;
    for (const u of g.units) if (u.owner === 0 && u.def.kind === 'vehicle') g.applyOrder(u, { k: 'move', x: tx, y: ty });
});
await shot('u2-advance.png');

// 3) let them shoot: projectile arcs, muzzle flash, turret aim
await page.evaluate(() => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    for (const u of g.units) {
        if (u.owner !== 0) continue;
        const t = g.units.find((v) => v.owner === 1 && !v.dead && v.def.kind !== 'air');
        if (t) { g.applyOrder(u, { k: 'attack', target: t }); }
    }
});
await shot('u3-firing.png');

// 4) dune lift: put a unit on a raised tile and read its height
const lift = await page.evaluate(() => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    const T = g.terrain;
    const { TILE, HALF, MAP_TILES: MT } = window.__riftsandConst;
    let best = null;
    for (let y = 2; y < MT - 2; y++) for (let x = 2; x < MT - 2; x++) {
        if (T.levelAt(x, y) >= 1 && T.levelAt(x, y + 1) === 0) { best = { x, y }; break; }
        if (best) break;
    }
    return best ? { tile: best, h: T.heightAt(best.x * TILE + TILE / 2 - HALF, best.y * TILE + TILE / 2 - HALF) } : null;
});
console.log('slope probe', JSON.stringify(lift));

console.log('ERRORS', errors.length);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
await browser.close();
