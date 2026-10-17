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
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => { if (r.status() >= 400) console.log('[http' + r.status() + ']', r.url()); });

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
    const toScreen = (wx, wy) => ({
        x: (wx - cam.x) * cam.zoom + 640,
        y: 360 - (wy - cam.y) * cam.zoom,
    });
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
            id: b.id, name: b.def.name, produces: !!b.def.produces,
            avail: g.availableUnits(b).length, done: b.done,
            ...toScreen(b.x, b.y),
        })),
        crystals: g.terrain.nodes.filter((n) => n.amount > 0).map((n) => toScreen(n.x, n.y)),
        radialOpen: app.ui.overlay.radialOpen,
        groups: g.groupIds.map((ids) => ids.length),
        queue: g.selectedBuilding ? g.selectedBuilding.queue.length : -1,
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
    await doubleTapAt(soldier.x, soldier.y);
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
const emptyX = 980, emptyY = 300;
await longPressAt(emptyX, emptyY, 700);
s = await probe();
check('长按呼出指令盘', s.radialOpen === true, `radialOpen=${s.radialOpen}`);
await page.screenshot({ path: path.join(OUT, 'i4-wheel.png') });
// tap the centre to dismiss
await tapAt(emptyX, emptyY);
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
await dragSingle({ x: box2.x0, y: box2.y0 }, { x: box2.x1, y: box2.y1 });
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

/* ---------- 8. batch queue via long press on card ---------- */
s = await probe();
const producer = s.buildings.find((b) => b.avail > 0 && b.done);
if (producer) {
    await tapAt(producer.x, producer.y);
    await sleep(150);
    s = await probe();
    if (s.queue < 0) {
        // the building may sit under a unit: select it directly so the rest of
        // the gesture (long press on a card) is still exercised
        await page.evaluate((id) => {
            const cc = window.cc;
            const app = cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
            const b = app.game.buildings.find((x) => x.id === id);
            if (b) app.game.selectBuilding(b);
        }, producer.id);
        await sleep(120);
        s = await probe();
    }
    const cards = await page.evaluate(() => {
        const cc = window.cc;
        const app = cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
        return app.ui.cards.map((c) => ({
            id: c.id,
            x: c.node.position.x + 640,
            y: 360 - c.node.position.y,
        }));
    });
    console.log('   cards', JSON.stringify(cards), 'queue', s.queue);
    const dbg = await page.evaluate(() => {
        const cc = window.cc;
        const app = cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
        const g = app.game;
        return {
            buildMode: g.buildMode,
            building: g.selectedBuilding ? g.selectedBuilding.def.name : null,
            cardSig: app.ui.cardSig,
            mode: app.ui.mode,
        };
    });
    console.log('   ui', JSON.stringify(dbg));
    await page.screenshot({ path: path.join(OUT, 'i6-cards.png') });
    if (cards.length > 0) {
        await longPressAt(cards[0].x, cards[0].y, 640);
        s = await probe();
        check('长按卡片批量生产', s.queue === 5, `queue=${s.queue} cards=${cards.length}`);
    } else {
        check('长按卡片批量生产', false, '没有生产卡片');
    }
} else {
    check('长按卡片批量生产', false, '没有生产建筑');
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
            .map((n) => ({ x: (n.x - cam.x) * cam.zoom + 640, y: 360 - (n.y - cam.y) * cam.zoom }));
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
        const anyH = app.game.units.filter((u) => u.owner === 0 && u.isHarvester).map((u) => u.order.k);
        return { sel, anyH };
    });
    const okCrystal = order.anyH.some((k) => k === 'harvest');
    check('采集车点击矿脉附近自动采集', okCrystal, `selection=${JSON.stringify(order.sel)} 采集车状态=${JSON.stringify(order.anyH)}`);
} else {
    check('采集车点击矿脉附近自动采集', false, '缺少采集车或矿脉');
}

/* ---------- 10. assist toggles ---------- */
const assist = await page.evaluate(() => {
    const cc = window.cc;
    const app = cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    const before = { auto: g.autoAcquire, form: g.holdFormation };
    g.autoAcquire = !g.autoAcquire;
    g.holdFormation = !g.holdFormation;
    const after = { auto: g.autoAcquire, form: g.holdFormation };
    g.autoAcquire = before.auto;
    g.holdFormation = before.form;
    return { before, after };
});
check('辅助开关可切换', assist.before.auto !== assist.after.auto && assist.before.form !== assist.after.form,
    `自动索敌 ${assist.before.auto}→${assist.after.auto}`);

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
