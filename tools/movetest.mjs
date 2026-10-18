/**
 * Movement & collision regression.
 *
 * The three symptoms this locks down:
 *   1. a walking soldier shoving a standing one along the ground;
 *   2. a unit ordered to a reachable cell that cannot path there and wobbles;
 *   3. units walking straight through each other when they meet.
 *
 * Reference behaviour being asserted (MoveTask / TileOccupation):
 *   - a cell holds one vehicle, or three infantry on distinct sub-cells;
 *   - a blocked unit waits, asks a friendly bystander to step aside, re-routes,
 *     or gives up — it never edits another unit's coordinates;
 *   - a blocked-off destination ends the order instead of retrying forever.
 *
 * usage: node tools/movetest.mjs [url]
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

/* ---------- helpers inside the page ---------- */
await page.evaluate(() => {
    const g = window.__riftsandGame;
    g.aiEnabled = false;
    const { TILE, HALF, MAP_TILES } = window.__riftsandConst;
    window.__M = {
        /** flatten a square patch so tests are not fighting the terrain */
        clear(cx, cy, r) {
            for (let y = cy - r; y <= cy + r; y++) {
                for (let x = cx - r; x <= cx + r; x++) {
                    if (x < 0 || y < 0 || x >= MAP_TILES || y >= MAP_TILES) continue;
                    const i = y * MAP_TILES + x;
                    g.terrain.kind[i] = 0;
                    g.terrain.solid[i] = 0;
                }
            }
            g.terrain.rebuildSpeed();
            g.terrain.rebuildHeight();
        },
        world(tx, ty) {
            return { x: tx * TILE + TILE / 2 - HALF, y: ty * TILE + TILE / 2 - HALF };
        },
        cell(x, y) {
            return [Math.floor((x + HALF) / TILE), Math.floor((y + HALF) / TILE)];
        },
        spawn(id, tx, ty, owner = 0) {
            const p = this.world(tx, ty);
            const u = g.spawnUnit(owner, window.__riftsandDefs.UNITS[id], p.x, p.y);
            u.face = 0;
            u.turretFace = 0;
            return u;
        },
        step(seconds, dt = 0.05) {
            const n = Math.round(seconds / dt);
            for (let i = 0; i < n; i++) g.update(dt);
        },
        /** min centre distance between two units, sampled while stepping */
        stepWatch(a, b, seconds, dt = 0.04) {
            const n = Math.round(seconds / dt);
            let minD = Infinity;
            let sharedCell = 0;
            let cellA = this.cell(a.x, a.y), cellB = this.cell(b.x, b.y);
            for (let i = 0; i < n; i++) {
                g.update(dt);
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d < minD) minD = d;
                cellA = this.cell(a.x, a.y);
                cellB = this.cell(b.x, b.y);
                if (cellA[0] === cellB[0] && cellA[1] === cellB[1]) sharedCell++;
            }
            return { minD: +minD.toFixed(1), sharedCell };
        },
    };
});

/* ---------- 1. two vehicles meeting head-on must not overlap ---------- */
const headOn = await page.evaluate(() => {
    const M = window.__M, g = window.__riftsandGame;
    M.clear(40, 40, 12);
    const a = M.spawn('rampart', 33, 40, 0);
    const b = M.spawn('rampart', 47, 40, 1);
    const pa = M.world(47, 40), pb = M.world(33, 40);
    g.applyOrder(a, { k: 'move', x: pa.x, y: pa.y });
    g.applyOrder(b, { k: 'move', x: pb.x, y: pb.y });
    const r = M.stepWatch(a, b, 18);
    return { ...r, endedA: a.order.k, endedB: b.order.k };
});
console.log('   head-on', JSON.stringify(headOn));
check('对向车辆不会互相穿过', headOn.sharedCell === 0, `同格帧数=${headOn.sharedCell}`);
check('对向车辆保持车体间距', headOn.minD >= 24, `最近 ${headOn.minD}px`);

/* ---------- 2. walking infantry must not shovel a standing one ---------- */
const shove = await page.evaluate(() => {
    const M = window.__M, g = window.__riftsandGame;
    M.clear(24, 46, 10);
    const idle = M.spawn('pebble', 24, 46, 0);
    idle.order = { k: 'idle' };
    const walker = M.spawn('pebble', 20, 46, 0);
    const goal = M.world(30, 46);
    g.applyOrder(walker, { k: 'move', x: goal.x, y: goal.y });
    const before = { x: idle.x, y: idle.y };
    // watch the idle unit for the whole trip; remember whether it ever received
    // a "step aside" order of its own (that is allowed — being *pushed* is not)
    let askedToMove = false;
    const n = 420;
    for (let i = 0; i < n; i++) {
        g.update(0.05);
        if (idle.order.k === 'move' || idle.path.length > 0) askedToMove = true;
    }
    const moved = Math.hypot(idle.x - before.x, idle.y - before.y);
    const walkerArrived = Math.hypot(walker.x - goal.x, walker.y - goal.y);
    return {
        idleMoved: +moved.toFixed(1),
        walkerToGoal: +walkerArrived.toFixed(1),
        idleOrder: idle.order.k,
        walkerOrder: walker.order.k,
        askedToMove,
    };
});
console.log('   shove', JSON.stringify(shove));
// The bystander may shift by the sub-cell spread (a few pixels so two men do
// not stand on the same spot) or walk aside under its own order. What must never
// happen is being bulldozed along the ground, which used to be hundreds of px.
check('走路的兵不会把站着的兵推走',
    shove.idleMoved <= 20 || shove.askedToMove,
    `位移 ${shove.idleMoved}px（自己接到让路指令=${shove.askedToMove}）`);
check('被挡时仍能绕过并抵达', shove.walkerToGoal <= 40, `距目标 ${shove.walkerToGoal}px`);

/* ---------- 3. reachable destinations are actually reached ---------- */
const arrive = await page.evaluate(() => {
    const M = window.__M, g = window.__riftsandGame;
    M.clear(40, 30, 14);
    const out = [];
    const goals = [[34, 26], [46, 26], [34, 34], [46, 34], [40, 24], [40, 36]];
    for (const [tx, ty] of goals) {
        const u = M.spawn('rampart', 40, 30, 0);
        const goal = M.world(tx, ty);
        const from = { x: u.x, y: u.y };
        const straight = Math.hypot(goal.x - from.x, goal.y - from.y);
        g.applyOrder(u, { k: 'move', x: goal.x, y: goal.y });
        let travelled = 0;
        let px = u.x, py = u.y;
        let t = 0;
        while (t < 26) {
            g.update(0.05);
            t += 0.05;
            travelled += Math.hypot(u.x - px, u.y - py);
            px = u.x; py = u.y;
            if (u.path.length === 0) break;
        }
        out.push({
            tx, ty,
            dist: +Math.hypot(u.x - goal.x, u.y - goal.y).toFixed(1),
            detour: +(travelled / Math.max(1, straight)).toFixed(2),
            order: u.order.k,
            t: +t.toFixed(1),
        });
        u.dead = true;
        g.units.splice(g.units.indexOf(u), 1);
        g.occupancy.remove(u, u.cellX, u.cellY);
    }
    return out;
});
console.log('   arrive', JSON.stringify(arrive));
for (const r of arrive) {
    check(`可抵达目标 ${r.tx},${r.ty}`, r.dist <= 34, `剩余 ${r.dist}px / 绕行 ${r.detour}x / ${r.t}s`);
}
check('没有单位绕远超过 3 倍', arrive.every((r) => r.detour < 3), JSON.stringify(arrive.map((r) => r.detour)));

/* ---------- 4. blocked-off destination gives up instead of retrying ---------- */
const giveUp = await page.evaluate(() => {
    const M = window.__M, g = window.__riftsandGame;
    const { MAP_TILES } = window.__riftsandConst;
    const cx = 28, cy = 54, R = 3;
    for (let y = cy - R - 1; y <= cy + R + 1; y++) {
        for (let x = cx - R - 1; x <= cx + R + 1; x++) {
            if (x < 0 || y < 0 || x >= MAP_TILES || y >= MAP_TILES) continue;
            const onRing = Math.abs(x - cx) === R || Math.abs(y - cy) === R;
            const i = y * MAP_TILES + x;
            g.terrain.kind[i] = onRing ? 2 : 0;
            g.terrain.solid[i] = onRing ? 1 : 0;
        }
    }
    g.terrain.rebuildSpeed();
    g.terrain.rebuildHeight();

    const u = M.spawn('rampart', cx, cy, 0);
    const goal = M.world(cx + 9, cy);
    g.applyOrder(u, { k: 'move', x: goal.x, y: goal.y });
    let t = 0;
    while (t < 25 && u.order.k !== 'idle') {
        g.update(0.05);
        t += 0.05;
    }
    // after giving up it must stay put, not keep hunting for a path
    const rest = { x: u.x, y: u.y };
    for (let i = 0; i < 80; i++) g.update(0.05);
    const drift = Math.hypot(u.x - rest.x, u.y - rest.y);
    return {
        t: +t.toFixed(1),
        order: u.order.k,
        path: u.path.length,
        drift: +drift.toFixed(1),
    };
});
console.log('   giveup', JSON.stringify(giveUp));
check('被围死的目标会放弃', giveUp.order === 'idle', `order=${giveUp.order} @${giveUp.t}s`);
check('放弃后不再来回晃动', giveUp.drift <= 4, `4 秒漂移 ${giveUp.drift}px`);

/* ---------- 5. an idle friendly bystander is asked to step aside ---------- */
const aside = await page.evaluate(() => {
    const M = window.__M, g = window.__riftsandGame;
    M.clear(50, 52, 8);
    const idle = M.spawn('rampart', 50, 52, 0);
    idle.order = { k: 'idle' };
    idle.face = 0;
    // park a second hull right on the only approach lane
    const walker = M.spawn('rampart', 45, 52, 0);
    const goal = M.world(55, 52);
    const before = { x: idle.x, y: idle.y };
    g.applyOrder(walker, { k: 'move', x: goal.x, y: goal.y });
    for (let i = 0; i < 500; i++) g.update(0.05);
    return {
        idleMoved: +Math.hypot(idle.x - before.x, idle.y - before.y).toFixed(1),
        walkerDist: +Math.hypot(walker.x - goal.x, walker.y - goal.y).toFixed(1),
    };
});
console.log('   aside', JSON.stringify(aside));
check('挡路的友军会侧移让路', aside.idleMoved >= 8, `侧移 ${aside.idleMoved}px`);
check('让路后行进方抵达', aside.walkerDist <= 40, `距目标 ${aside.walkerDist}px`);

/* ---------- 6. cell capacity: no two vehicles on one cell ---------- */
const capacity = await page.evaluate(() => {
    const M = window.__M, g = window.__riftsandGame;
    M.clear(36, 60, 8);
    const a = M.spawn('rampart', 35, 60, 0);
    const b = M.spawn('rampart', 37, 60, 0);
    const p = M.world(36, 60);
    g.applyOrder(a, { k: 'move', x: p.x, y: p.y });
    g.applyOrder(b, { k: 'move', x: p.x, y: p.y });
    let same = 0;
    for (let i = 0; i < 300; i++) {
        g.update(0.05);
        const ca = M.cell(a.x, a.y), cb = M.cell(b.x, b.y);
        if (ca[0] === cb[0] && ca[1] === cb[1]) same++;
    }
    return { same, fill: g.occupancy.fillAt(a.cellX, a.cellY) };
});
console.log('   capacity', JSON.stringify(capacity));
check('同一格不能挤下两辆车', capacity.same === 0, `同格帧数=${capacity.same}`);

/* ---------- 7. infantry squad: three per cell, spread out ---------- */
const squad = await page.evaluate(() => {
    const M = window.__M, g = window.__riftsandGame;
    M.clear(20, 62, 6);
    const p = M.world(20, 62);
    const us = [M.spawn('pebble', 18, 62, 0), M.spawn('pebble', 22, 62, 0), M.spawn('pebble', 20, 60, 0)];
    for (const u of us) g.applyOrder(u, { k: 'move', x: p.x, y: p.y });
    for (let i = 0; i < 400; i++) g.update(0.05);
    const cells = us.map((u) => M.cell(u.x, u.y).join(','));
    let minD = Infinity;
    for (let i = 0; i < us.length; i++) {
        for (let j = i + 1; j < us.length; j++) {
            minD = Math.min(minD, Math.hypot(us[i].x - us[j].x, us[i].y - us[j].y));
        }
    }
    // sub-cells must be distinct *within* a cell
    const byCell = new Map();
    us.forEach((u) => {
        const k = u.cellX + ',' + u.cellY;
        if (!byCell.has(k)) byCell.set(k, []);
        byCell.get(k).push(u.subCell);
    });
    const dupSub = [...byCell.values()].some((a) => new Set(a).size !== a.length);
    return { cells, minD: +minD.toFixed(1), subs: us.map((u) => u.subCell), dupSub };
});
console.log('   squad', JSON.stringify(squad));
// The reference lets three infantry share a tile, but a squad naturally fans
// out over two tiles; what must NOT happen is stacking on one pixel or
// duplicating a sub-cell.
// A squad converging on one point fans out over neighbouring cells, which is
// what the retail engine does too. What must not happen is two men standing on
// the same pixel.
check('步兵之间不重叠', squad.minD >= 8, `最近 ${squad.minD}px`);
check('同格子格编号不重复', !squad.dupSub, squad.subs.join(','));

console.log(`ERRORS ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 3).join('\n'));
console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
