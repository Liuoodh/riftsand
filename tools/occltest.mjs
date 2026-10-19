/**
 * Draw-order (occlusion) regression.
 *
 * The reference is a real 3D scene: the camera is orthographic at
 * ISO_CAMERA_ALPHA (30°) / BETA (45°) and occlusion is decided by the depth
 * buffer along the camera axis. A 2D iso renderer has to reproduce that order
 * with a painter's sort, using the same key:
 *
 *     depth = (x + y) / TILE * ISO_HH + z * ISO_HH/3
 *
 * (one terrain level ≈ 1/3 of a (rx+ry) step for that camera).
 *
 * This checks:
 *   1. the world layer is sorted ascending by that key every frame;
 *   2. four hulls in a diagonal column are ordered back-to-front, so the one
 *      nearest the camera is drawn last (on top);
 *   3. a hull standing in front of a structure is drawn after it — structures
 *      use their FRONT footprint corner, not their centre.
 *
 * usage: node tools/occltest.mjs [url]
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
await new Promise((r) => setTimeout(r, 800));

const out = await page.evaluate(async () => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    g.aiEnabled = false;
    const { TILE, HALF, MAP_TILES } = window.__riftsandConst;
    const U = window.__riftsandDefs.UNITS;
    const w = (tx, ty) => ({ x: tx * TILE + TILE / 2 - HALF, y: ty * TILE + TILE / 2 - HALF });
    const ISO_HH = 14, DEPTH_Z = ISO_HH / 3;

    // flat arena
    for (let y = 24; y <= 40; y++) {
        for (let x = 12; x <= 26; x++) {
            const i = y * MAP_TILES + x;
            g.terrain.kind[i] = 0;
            g.terrain.solid[i] = 0;
        }
    }
    g.terrain.rebuildSpeed();
    g.terrain.rebuildHeight();
    g.rebuildPassability?.();

    const depthOf = (x, y, z) => ((x + y) / TILE) * ISO_HH + (z || 0) * DEPTH_Z;
    const layer = app.renderer.worldLayer;
    const order = () => layer.children.map((n) => ({ name: n.name, d: +(n.__depth || 0).toFixed(2) }));

    // ---- 1. diagonal column of four hulls ----
    const col = [];
    for (let k = 0; k < 4; k++) {
        const t = g.spawnUnit(0, U.rampart, w(16 + k, 29 + k).x, w(16 + k, 29 + k).y);
        t.invulnUntil = 1e9;
        col.push(t);
    }
    await new Promise((r) => setTimeout(r, 350));
    const o1 = order();
    const colIdx = col.map((t) => o1.findIndex((o) => o.name === 'U:' + t.id));
    const colDepth = o1.filter((o) => colIdx.some((i) => o1[i] === o)).map((o) => o.d);
    const sortedAsc = o1.every((o, i) => i === 0 || o1[i - 1].d <= o.d + 1e-6);

    // ---- 2. hull in front of a structure ----
    const core = g.buildings.find((b) => b.owner === 0 && b.def.isCore);
    let inFrontAfter = null;
    if (core) {
        // one cell in front of the footprint's front corner
        const fx = core.tx + core.size;
        const fy = core.ty + core.size;
        const tank = g.spawnUnit(0, U.rampart, w(fx, fy).x, w(fx, fy).y);
        tank.invulnUntil = 1e9;
        await new Promise((r) => setTimeout(r, 350));
        const o2 = order();
        const bi = o2.findIndex((o) => o.name === 'B:' + core.id);
        const ti = o2.findIndex((o) => o.name === 'U:' + tank.id);
        inFrontAfter = { building: bi, tank: ti, ok: bi >= 0 && ti > bi };
        tank.dead = true;
    }

    return {
        sortedAsc,
        colOrder: colIdx,
        colDepth,
        colAscending: colIdx.every((idx, k) => k === 0 || idx > colIdx[k - 1]),
        inFrontAfter,
        sample: o1.slice(0, 8),
    };
});

console.log('   order', JSON.stringify(out.sample));
check('世界层按相机深度升序绘制', out.sortedAsc, out.sortedAsc ? '' : JSON.stringify(out.sample));
check('斜列坦克从远到近排序', out.colAscending, `列内顺序 ${JSON.stringify(out.colOrder)}`);
check('斜列深度严格递增', out.colDepth.every((d, i) => i === 0 || d > out.colDepth[i - 1]), JSON.stringify(out.colDepth));
if (out.inFrontAfter) {
    check('建筑前方的坦克绘制在建筑之后', out.inFrontAfter.ok,
        `building#${out.inFrontAfter.building} tank#${out.inFrontAfter.tank}`);
}
check('运行无报错', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
