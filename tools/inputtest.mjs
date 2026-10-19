/**
 * Touch input regression: drives the built game through real CDP touch events
 * and checks the mobile command layer.
 *
 *   box select · double-tap same type · two-finger pan/zoom ·
 *   long-press command wheel · control groups · batch queue · crystal snapping
 *
 * usage: node tools/inputtest.mjs [url] [outDir]
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

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
        '--no-sandbox',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--window-size=1280,720',
        '--hide-scrollbars',
    ],
    defaultViewport: { width: 1280, height: 720, hasTouch: true, isMobile: true },
});

const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('response', (r) => { if (r.status() >= 400) console.log('[http' + r.status() + ']', r.url()); });
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('[navigated]', f.url()); });
page.on('error', (e) => console.log('[crash]', e.message));

// silence the browser's automatic /favicon.ico 404 so the error log stays meaningful
await page.evaluateOnNewDocument(() => {
    document.addEventListener('DOMContentLoaded', () => {
        const l = document.createElement('link');
        l.rel = 'icon';
        l.href = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        document.head.appendChild(l);
    });
});

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__RIFTSAND_BOOTED__ === true', { timeout: 60000 });
await sleep(1500);

const client = await page.target().createCDPSession();

/* ---------- helpers ---------- */
async function touchStart(points) {
    await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })),
    });
}
async function touchMove(points) {
    await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })),
    });
}
async function touchEnd() {
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function dragSingle(from, to, steps = 14) {
    await touchStart([{ x: from.x, y: from.y, id: 1 }]);
    for (let i = 1; i <= steps; i++) {
        await touchMove([{
            x: from.x + (to.x - from.x) * (i / steps),
            y: from.y + (to.y - from.y) * (i / steps),
            id: 1,
        }]);
        await sleep(16);
    }
    await touchEnd();
    await sleep(120);
}

async function tapAt(x, y, hold = 40, settle = 90) {
    await touchStart([{ x, y, id: 1 }]);
    await sleep(hold);
    await touchEnd();
    await sleep(settle);
}

async function doubleTapAt(x, y) {
    await tapAt(x, y, 40, 80);
    await tapAt(x, y, 40, 220);
}

async function unitScreen(id) {
    return page.evaluate((uid) => {
        const g = window.__riftsandGame;
        const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
        const cam = app.cam;
        const u = g.units.find((x) => x.id === uid);
        if (!u) return null;
        const TILE = 32;
        const rx = u.x / TILE, ry = u.y / TILE;
        const px = (rx - ry) * 28;
        const py = (rx + ry) * 14 - g.terrain.heightAt(u.x, u.y) * 16;
        return {
            x: (px - cam.x) * cam.zoom + 640,
            y: 360 - (py - cam.y) * cam.zoom,
        };
    }, id);
}

async function longPressAt(x, y, hold = 620) {
    await touchStart([{ x, y, id: 1 }]);
    await sleep(hold);
    await touchEnd();
    await sleep(200);
}

/* ---------- state probes ---------- */
const probe = () => page.evaluate(() => {
    const cc = window.cc;
    const canvas = cc.director.getScene().getChildByName('Canvas');
    const app = canvas.getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    const cam = app.cam;
    const TILE_W = 32, ISO_HW = 28, ISO_HH = 14, HEIGHT_PX = 16;
    const toScreen = (wx, wy) => {
        const rx = wx / TILE_W, ry = wy / TILE_W;
        const px = (rx - ry) * ISO_HW;
        const py = (rx + ry) * ISO_HH - g.terrain.heightAt(wx, wy) * HEIGHT_PX;
        return { x: (px - cam.x) * cam.zoom + 640, y: 360 - (py - cam.y) * cam.zoom };
    };
    return {
        mode: app.ui.mode,
        camX: cam.x,
        camY: cam.y,
        zoom: cam.zoom,
        selection: g.selection.length,
        selType: g.selection.length ? g.selection[0].def.id : null,
        units: g.units.filter((u) => u.owner === 0 && !u.dead).map((u) => ({
            id: u.id, type: u.def.id, harvester: u.isHarvester, ...toScreen(u.x, u.y),
        })),
        buildings: g.buildings.filter((b) => b.owner === 0 && !b.dead).map((b) => ({
            id: b.id, name: b.def.name, done: b.done, size: b.size,
            ...toScreen(b.x, b.y),
        })),
        crystals: g.terrain.nodes.filter((n) => n.amount > 0).map((n) => toScreen(n.x, n.y)),
        radialOpen: app.ui.overlay.radialOpen,
        groups: g.groupIds.map((ids) => ids.length),
        // currentSize is the reference's queue size (a stacked row counts N),
        // items.length is the number of *rows* — retail stacks identical items.
        queues: ['structure', 'infantry', 'vehicle', 'aircraft'].map((c) => g.human.queues[c].currentSize),
        ready: !!g.readyStructure(g.human),
        tab: app.ui.tab,
        waypoint: g.waypointMode,
        sw: g.human.sw.map((x) => x.id + (x.ready ? '*' : '')),
        credits: g.human.credits,
        errors: 0,
    };
});

let s = await probe();
check('auto=1 直接进入对局', s.mode === 'game', `mode=${s.mode}`);
check('开局单位已生成', s.units.length >= 4, `${s.units.length} units`);

/* ---------- board geometry ---------- */
const army = s.units.filter((u) => !u.harvester);
const box = {
    x0: Math.min(...s.units.map((u) => u.x)) - 34,
    x1: Math.max(...s.units.map((u) => u.x)) + 34,
    y0: Math.min(...s.units.map((u) => u.y)) - 34,
    y1: Math.max(...s.units.map((u) => u.y)) + 34,
};
await page.screenshot({ path: path.join(OUT, 'i0-start.png') });

/* ---------- 1. box select ---------- */
await dragSingle({ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y1 });
s = await probe();
check('单指拖拽框选', s.selection > 0, `选中 ${s.selection} 个（作战单位 ${army.length}）`);
const boxSel = s.selection;
await page.screenshot({ path: path.join(OUT, 'i1-box.png') });

/* ---------- 2. empty box clears selection ---------- */
await dragSingle({ x: 120, y: 120 }, { x: 220, y: 200 });
s = await probe();
check('框空清除选择', s.selection === 0, `selection=${s.selection}`);

/* ---------- 3. double tap selects same type on screen ---------- */
const soldier = army[0];
if (soldier) {
    const live = (await unitScreen(soldier.id)) || soldier;
    await doubleTapAt(live.x, live.y);
    s = await probe();
    const sameType = s.units.filter((u) => u.type === soldier.type).length;
    check('双击选中屏幕内同类型', s.selection === sameType && s.selection > 1,
        `selection=${s.selection} 同类在场=${sameType}`);
} else {
    check('双击选中屏幕内同类型', false, '没有作战单位');
}
await page.screenshot({ path: path.join(OUT, 'i2-doubletap.png') });

/* ---------- 4. two finger pan ---------- */
const beforePan = await probe();
// the camera starts clamped to the west edge, so pan east->west to see movement
await touchStart([{ x: 700, y: 500, id: 1 }, { x: 900, y: 500, id: 2 }]);
for (let i = 1; i <= 12; i++) {
    await touchMove([{ x: 700 - i * 12, y: 500, id: 1 }, { x: 900 - i * 12, y: 500, id: 2 }]);
    await sleep(16);
}
await touchEnd();
await sleep(250);
s = await probe();
const panDx = s.camX - beforePan.camX;
check('双指拖动平移视角', Math.abs(panDx) > 60, `camX ${beforePan.camX.toFixed(0)} → ${s.camX.toFixed(0)}`);

/* ---------- 5. two finger zoom ---------- */
const beforeZoom = await probe();
await touchStart([{ x: 560, y: 400, id: 1 }, { x: 720, y: 400, id: 2 }]);
for (let i = 1; i <= 12; i++) {
    await touchMove([{ x: 560 - i * 10, y: 400, id: 1 }, { x: 720 + i * 10, y: 400, id: 2 }]);
    await sleep(16);
}
await touchEnd();
await sleep(400);
s = await probe();
check('双指捏合缩放', Math.abs(s.zoom - beforeZoom.zoom) > 0.05,
    `zoom ${beforeZoom.zoom.toFixed(2)} → ${s.zoom.toFixed(2)}`);
await page.screenshot({ path: path.join(OUT, 'i3-zoom.png') });

/* ---------- 6. long press opens command wheel ---------- */
s = await probe();
// long-press the selected unit, not a fixed screen point: the camera has been
// zoomed by the previous step, so a hard-coded point may no longer be empty
const held = s.units.find((u) => u.id === (s.selection > 0 ? army[0].id : army[0].id));
const holdPt = (await unitScreen(army[0].id)) || held || { x: 980, y: 300 };
await longPressAt(holdPt.x, holdPt.y, 700);
s = await probe();
check('长按呼出指令盘', s.radialOpen === true, `radialOpen=${s.radialOpen}`);
await page.screenshot({ path: path.join(OUT, 'i4-wheel.png') });
// tap away from the wheel to dismiss
await tapAt(holdPt.x + 120, holdPt.y + 60);
s = await probe();
check('指令盘可取消', s.radialOpen === false, `radialOpen=${s.radialOpen}`);

/* ---------- 7. control group assign + recall ---------- */
// re-select the spawn cluster first
s = await probe();
const box2 = {
    x0: Math.min(...s.units.map((u) => u.x)) - 34,
    x1: Math.max(...s.units.map((u) => u.x)) + 34,
    y0: Math.min(...s.units.map((u) => u.y)) - 34,
    y1: Math.max(...s.units.map((u) => u.y)) + 34,
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
console.log('   box2', JSON.stringify(box2));
await dragSingle({ x: clamp(box2.x0, 8, 1272), y: clamp(box2.y0, 8, 712) },
                 { x: clamp(box2.x1, 8, 1272), y: clamp(box2.y1, 8, 712) });
const selBefore = (await probe()).selection;
// group cell #1 centre in design space: x=-601, y=104  -> css (39, 256)
await longPressAt(39, 256, 620);
s = await probe();
check('长按编队格编入', s.groups[0] > 0, `groups=${JSON.stringify(s.groups)} 选中=${selBefore}`);
await page.screenshot({ path: path.join(OUT, 'i5-group.png') });

// clear selection, then tap the cell to recall
await dragSingle({ x: 120, y: 150 }, { x: 220, y: 220 });
await tapAt(39, 256);
s = await probe();
check('点击编队格选中编队', s.selection === s.groups[0] && s.selection > 0,
    `selection=${s.selection} group=${s.groups[0]}`);

/* ---------- 8. sidebar tabs + batch queue ---------- */
await page.evaluate(() => {
    const cc = window.cc;
    const app = cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    app.game.clearSelection();
    app.ui.tab = 'infantry';
    app.ui.cardSig = '';
    app.ui.refreshCards();
});
await sleep(260);
const cards = await page.evaluate(() => {
    const cc = window.cc;
    const app = cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    return app.ui.cards.map((c) => ({
        id: c.id,
        x: c.node.position.x + 640,
        y: 360 - c.node.position.y,
    }));
});
console.log('   cards', JSON.stringify(cards));
await page.screenshot({ path: path.join(OUT, 'i6-cards.png') });
if (cards.length > 0) {
    await longPressAt(cards[0].x, cards[0].y, 640);
    s = await probe();
    check('长按卡片批量生产', s.queues[1] === 5, `infantry queue=${s.queues[1]}`);
} else {
    check('长按卡片批量生产', false, '没有生产卡片');
}
await page.screenshot({ path: path.join(OUT, 'i7-queue.png') });

/* ---------- 9. crystal snapping for harvesters ---------- */
// reset the camera so the harvester and a crystal are both comfortably on screen
await page.evaluate(() => {
    const cc = window.cc;
    const app = cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const core = app.game.buildings.find((b) => b.owner === 0 && b.def.isCore);
    app.cam.setZoom(0.9);
    app.cam.zoom = 0.9;
    if (core) app.cam.focus(core.x + 120, core.y - 120, true);
});
await sleep(350);
let fresh = await probe();
const harv = fresh.units.find((u) => u.harvester);
if (harv && fresh.crystals.length) {
    await tapAt(harv.x, harv.y, 40, 140);
    fresh = await probe();
    const selHarv = await page.evaluate(() => {
        const cc = window.cc;
        const app = cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
        return app.game.selection.map((u) => ({ harv: u.isHarvester, x: u.x, y: u.y }));
    });
    // re-read the crystal position on the current camera, then tap slightly off-centre
    const c = await page.evaluate(() => {
        const cc = window.cc;
        const app = cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
        const cam = app.cam;
        const pts = app.game.terrain.nodes
            .filter((m) => m.amount > 0)
            .map((n) => {
                const rx = n.x / 32, ry = n.y / 32;
                const px = (rx - ry) * 28;
                const py = (rx + ry) * 14 - app.game.terrain.heightAt(n.x, n.y) * 16;
                return { x: (px - cam.x) * cam.zoom + 640, y: 360 - (py - cam.y) * cam.zoom };
            });
        // pick the crystal closest to the screen centre so the tap lands on screen
        pts.sort((a, b) => Math.hypot(a.x - 640, a.y - 360) - Math.hypot(b.x - 640, b.y - 360));
        return pts[0] || null;
    });
    console.log('   crystal css', JSON.stringify(c), 'harvester', JSON.stringify({ x: harv.x, y: harv.y }));
    if (c) {
        await tapAt(c.x + 12, c.y - 9, 40, 220);
    }
    const order = await page.evaluate(() => {
        const cc = window.cc;
        const app = cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
        const sel = app.game.selection.map((x) => ({ t: x.def.id, k: x.order.k }));
        const anyH = app.game.units.filter((u) => u.owner === 0 && u.isHarvester).map((u) => ({
            k: u.order.k,
            tasks: (u.orders?.getTasks?.() || []).map((t) => t.constructor?.name),
        }));
        return { sel, anyH };
    });
    // the harvest order is a task chain now (GatherOreTask), not an Order kind
    const okCrystal = order.anyH.some((h) => h.tasks.includes('GatherOreTask'));
    check('采集车点击矿脉附近自动采集', okCrystal, `selection=${JSON.stringify(order.sel)} 采集车=${JSON.stringify(order.anyH)}`);
} else {
    check('采集车点击矿脉附近自动采集', false, '缺少采集车或矿脉');
}

/* ---------- 10. stance + waypoint toggles ---------- */
const toggles = await page.evaluate(() => {
    const cc = window.cc;
    const app = cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    g.clearSelection();
    const u = g.units.find((x) => x.owner === 0 && !x.isHarvester && !x.isEngineer && !x.isMcv && x.def.weapon);
    if (!u) return { skipped: true };
    g.selectUnit(u, false);
    const before = u.stance;
    g.cycleStance();
    const after = u.stance;
    const w0 = g.waypointMode;
    g.waypointMode = !w0;
    const w1 = g.waypointMode;
    g.waypointMode = w0;
    return { before, after, w0, w1 };
});
check('姿态循环切换', !toggles.skipped && toggles.before !== toggles.after,
    `${toggles.before} → ${toggles.after}`);
check('路径模式开关', !toggles.skipped && toggles.w0 !== toggles.w1, `waypoint ${toggles.w0}→${toggles.w1}`);

/* ---------- 11. structure queue -> ready -> place ---------- */
const prod = await page.evaluate(() => {
    const cc = window.cc;
    const app = cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    const h = g.human;
    const defs = g.availableStructures(h);
    const def = defs.find((d) => d.id === 'foundry') || defs.find((d) => !g.lockReason(h, d));
    if (!def) return { skipped: '没有可用建筑' };
    h.credits = 30000;
    g.queueBuild(def.id);
    const q = h.queues.structure;
    if (!q.currentSize) return { skipped: g.lockReason(h, def) || '入队失败' };
    // run real production ticks (15 Hz) until the structure is paid off and ready
    let ready = false;
    for (let i = 0; i < 3000 && !ready; i++) {
        g.update(0.1);
        ready = q.ready;
    }
    g.beginPlace(def.id);
    const core = g.buildings.find((b) => b.owner === 0 && b.def.isCore);
    let spot = null;
    for (let r = 4; r <= 11 && !spot; r++) {
        for (let a = 0; a < 18; a++) {
            const ang = (a / 18) * Math.PI * 2 + r * 0.4;
            const tx = Math.round(core.tx + Math.cos(ang) * r);
            const ty = Math.round(core.ty + Math.sin(ang) * r);
            if (g.canPlace(def, tx, ty, 0).ok) { spot = { tx, ty }; break; }
        }
    }
    const before = g.buildings.filter((b) => b.owner === 0).length;
    const ok = spot ? g.confirmBuild(spot.tx, spot.ty) : false;
    for (let i = 0; i < 4; i++) g.update(0.05);
    const after = g.buildings.filter((b) => b.owner === 0).length;
    return { ready, placed: !!ok && after > before, def: def.name };
});
check('建筑队列完成进入就绪', prod.ready === true, prod.skipped || prod.def);
check('就绪建筑可放置', prod.placed === true, prod.skipped || `placed=${prod.placed}`);

/* ---------- 12. super weapon charge + strike ---------- */
const swTest = await page.evaluate(() => {
    const cc = window.cc;
    const app = cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    const h = g.human;
    h.credits = 40000;
    const defs = g.availableStructures(h);
    const def = defs.find((d) => d.superWeapon);
    if (!def) return { skipped: '没有超级武器建筑' };
    const core = g.buildings.find((b) => b.owner === 0 && b.def.isCore);
    // two extra power plants so the super weapon does not black out the grid
    for (let n = 0; n < 2; n++) {
        const pw = defs.find((d) => d.id === (h.faction === 'BU' ? 'furnace' : 'sunwell'));
        for (let r = 5; r <= 14; r++) {
            let done = false;
            for (let a = 0; a < 20; a++) {
                const ang = (a / 20) * Math.PI * 2 + r * 0.45;
                const tx = Math.round(core.tx + Math.cos(ang) * r);
                const ty = Math.round(core.ty + Math.sin(ang) * r);
                if (g.canPlace(pw, tx, ty, 0, true).ok) { g.place(pw, 0, tx, ty, true); done = true; break; }
            }
            if (done) break;
        }
    }
    let spot = null;
    for (let r = 5; r <= 14 && !spot; r++) {
        for (let a = 0; a < 20; a++) {
            const ang = (a / 20) * Math.PI * 2 + r * 0.45;
            const tx = Math.round(core.tx + Math.cos(ang) * r);
            const ty = Math.round(core.ty + Math.sin(ang) * r);
            if (g.canPlace(def, tx, ty, 0, true).ok) { spot = { tx, ty }; break; }
        }
    }
    if (!spot) return { skipped: '没有空位' };
    g.place(def, 0, spot.tx, spot.ty, true);
    g.update(0.05);
    const st = h.sw.find((x) => x.id === def.superWeapon);
    if (!st) return { skipped: '未生成超武状态' };
    st.t = st.total - 0.01;
    g.update(0.1);
    const ready = st.ready && g.radarOnline(h);
    const enemyCore = g.buildings.find((b) => b.owner === 1 && b.def.isCore);
    const hp0 = enemyCore ? enemyCore.hp : 0;
    const fired = g.launchSuperWeapon(def.superWeapon, enemyCore.x, enemyCore.y, 0);
    for (let i = 0; i < 50; i++) g.update(0.05);
    const hp1 = enemyCore && !enemyCore.dead ? enemyCore.hp : 0;
    return { ready, fired, damaged: hp1 < hp0, hp0: Math.round(hp0), hp1: Math.round(hp1), id: def.superWeapon };
});
check('超级武器充能完成', swTest.ready === true, swTest.skipped || `${swTest.id} ready=${swTest.ready}`);
check('超级武器发射并造成伤害', swTest.fired === true && swTest.damaged === true,
    swTest.skipped || `${swTest.hp0} → ${swTest.hp1}`);

/* ---------- 13. engineer captures an enemy structure ---------- */
const cap = await page.evaluate(() => {
    const cc = window.cc;
    const app = cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    const h = g.human;
    const engDef = g.availableUnitsFor(h, 'infantry').find((d) => d.engineer);
    const target = g.buildings.find((b) => b.owner === 1 && !b.def.isCore) || g.buildings.find((b) => b.owner === 1);
    if (!engDef || !target) return { skipped: '缺少工兵或目标' };
    const e = g.spawnUnit(0, engDef, target.x + (target.size * 32) / 2 + 18, target.y);
    e.invulnUntil = 1e9;
    g.orderCaptureFor(e, target);
    for (let i = 0; i < 300 && target.owner !== 0; i++) g.update(0.05);
    return { captured: target.owner === 0, name: target.def.name };
});
check('工兵接管敌方建筑', cap.captured === true, cap.skipped || `${cap.name} → owner 0`);

/* ---------- wrap up ---------- */
const final = await probe();
console.log('FINAL', JSON.stringify({
    selection: final.selection, groups: final.groups, zoom: final.zoom.toFixed(2),
    seconds: Math.round(4096),
}));
console.log('ERRORS', errors.length);
for (const e of errors.slice(0, 6)) console.log('  ', e);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
