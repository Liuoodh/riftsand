/**
 * Physics regression: terrain speed, ore passability, mass-based collision,
 * crushing, wall safety, direct fire, ballistic splash and anti-air homing.
 *
 *   node tools/phystest.mjs [url]
 */
import { createRequire } from 'node:module';
const req = createRequire(
    (process.env.SMOKE_NODE_MODULES || 'C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules') + '/',
);
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html?auto=1';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
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
await new Promise((r) => setTimeout(r, 600));

const out = await page.evaluate(() => {
    const app = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    const g = app.game;
    const h = g.human;
    const res = {};
    const TILE = 32, HALF = 1024;
    const world = (tx, ty) => ({ x: tx * TILE + 16 - HALF, y: ty * TILE + 16 - HALF });

    const step = (seconds) => { const n = Math.round(seconds / 0.05); for (let i = 0; i < n; i++) g.update(0.05); };
    const findTile = (kind, fromX = 32, fromY = 32) => {
        for (let r = 0; r < 32; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    const tx = fromX + dx, ty = fromY + dy;
                    if (tx < 2 || ty < 2 || tx > 61 || ty > 61) continue;
                    if (g.terrain.kind[ty * 64 + tx] === kind && !g.isBlocked(tx, ty)) return { tx, ty };
                }
            }
        }
        return null;
    };
    const findOpen = () => {
        for (let ty = 6; ty < 58; ty++) {
            for (let tx = 6; tx < 58; tx++) {
                let ok = true;
                for (let y = ty; y < ty + 6 && ok; y++) for (let x = tx; x < tx + 10; x++) {
                    // any driveable ground works; rocks are what fragments the map
                    if (g.isBlocked(x, y) || g.terrain.kind[y * 64 + x] === 2) { ok = false; break; }
                }
                if (ok) return { tx, ty };
            }
        }
        return { tx: 30, ty: 30 };
    };

    const veh = g.availableUnitsFor(h, 'vehicle');
    const inf = g.availableUnitsFor(h, 'infantry');
    const tankDef = veh.find((d) => d.crush && d.armor === 'heavy');
    const infDef = inf.find((d) => d.id === 'pebble' || (d.weapon && !d.cloak));
    const enemyInfDef = g.availableUnitsFor(g.players[1], 'infantry').find((d) => d.weapon && !d.cloak);

    /* 1. terrain multipliers */
    const dune = findTile(1);
    const sand = findTile(0);
    const crystal = findTile(3);
    res.terrain = {
        duneSpeed: dune ? g.terrain.speedAt(dune.tx, dune.ty, false, false) : -1,
        sandSpeed: sand ? g.terrain.speedAt(sand.tx, sand.ty, false, false) : -1,
        duneCost: dune ? g.terrain.costAt(dune.tx, dune.ty) : -1,
        sandCost: sand ? g.terrain.costAt(sand.tx, sand.ty) : -1,
    };
    if (dune && tankDef) {
        const w = world(dune.tx, dune.ty);
        const t = g.spawnUnit(0, tankDef, w.x, w.y);
        t.invulnUntil = 1e9;
        g.update(0.05);
        res.duneMul = t.terrainMul;
        t.dead = true;
    }

    /* 2. ore is passable */
    res.crystalPassable = !!crystal && !g.terrain.isSolid(crystal.tx, crystal.ty) && !g.isBlocked(crystal.tx, crystal.ty);
    if (crystal) {
        const node = g.terrain.nodeAt(crystal.tx, crystal.ty) || g.terrain.nodes[0];
        const path = g.finder.find(node.x - 120, node.y - 120, node.x, node.y, { radius: 14 });
        res.orePath = !!path;
    }

    /* 3. mass-based collision: overlapping friendly tank + infantry */
    const open = findOpen();
    const base = world(open.tx, open.ty);
    const tank = g.spawnUnit(0, tankDef, base.x, base.y);
    const foot = g.spawnUnit(0, infDef, base.x + 4, base.y);
    tank.invulnUntil = 1e9; foot.invulnUntil = 1e9;
    const t0 = { x: tank.x, y: tank.y }, f0 = { x: foot.x, y: foot.y };
    step(0.6);
    res.sep = {
        tankMoved: Math.hypot(tank.x - t0.x, tank.y - t0.y),
        footMoved: Math.hypot(foot.x - f0.x, foot.y - f0.y),
        dist: Math.hypot(tank.x - foot.x, tank.y - foot.y),
        need: (tank.radius + foot.radius) * 0.85,
    };
    tank.dead = true; foot.dead = true;

    /* 4. two tanks must not occupy the same spot */
    const a = g.spawnUnit(0, tankDef, base.x + 120, base.y + 80);
    const b = g.spawnUnit(0, tankDef, base.x + 126, base.y + 80);
    a.invulnUntil = 1e9; b.invulnUntil = 1e9;
    step(0.8);
    res.tankDist = Math.hypot(a.x - b.x, a.y - b.y);
    res.tankNeed = (a.radius + b.radius) * 0.85;
    a.dead = true; b.dead = true;

    /* 5. crushing: a moving heavy tank runs over enemy infantry */
    const laneY = base.y + 60;
    const victim = g.spawnUnit(1, enemyInfDef, base.x + 190, laneY);
    victim.invulnUntil = 1e9;
    const crusher = g.spawnUnit(0, tankDef, base.x + 70, laneY);
    crusher.invulnUntil = 1e9;
    g.orderMoveFor(crusher, base.x + 300, laneY);
    step(3.5);
    res.crush = { victimDead: victim.dead, tankAlive: !crusher.dead };
    crusher.dead = true;

    /* 6. units must never end up inside terrain or a building */
    let inside = 0;
    for (const u of g.units) {
        if (u.dead || u.isAir) continue;
        const tx = Math.floor((u.x + HALF) / TILE), ty = Math.floor((u.y + HALF) / TILE);
        if (g.isBlocked(tx, ty)) inside++;
    }
    res.insideWalls = inside;

    /* 7. direct fire hits and damages the intended target */
    const shooter = g.spawnUnit(0, infDef, base.x + 20, base.y + 150);
    const target = g.spawnUnit(1, enemyInfDef, base.x + 210, base.y + 150);
    shooter.invulnUntil = 1e9;
    const hp0 = target.hp;
    for (let i = 0; i < 6; i++) { g.fire(shooter, shooter.def.weapon, target); g.update(0.25); }
    step(0.6);
    res.direct = { hp0, hp1: Math.round(target.hp), projectiles: g.projectiles.length };
    shooter.dead = true; target.dead = true;

    /* 8. ballistic shell creates a crater and splash damage */
    const mortarDef = veh.find((d) => d.weapon && d.weapon.ballistic);
    if (mortarDef) {
        const art = g.spawnUnit(0, mortarDef, base.x + 20, base.y + 150);
        const cluster = [0, 1, 2].map((i) => g.spawnUnit(1, enemyInfDef, base.x + 230 + i * 14, base.y + 150));
        art.invulnUntil = 1e9;
        const hpBefore = cluster.map((c) => c.hp);
        const decals0 = g.decals.length;
        for (let i = 0; i < 3; i++) { g.fire(art, art.def.weapon, cluster[1]); step(1.4); }
        res.ballistic = {
            decals: g.decals.length - decals0,
            damaged: cluster.filter((c, i) => c.dead || c.hp < hpBefore[i]).length,
        };
        art.dead = true;
        for (const c of cluster) c.dead = true;
    } else {
        res.ballistic = { skipped: true };
    }

    /* 9. AA rockets climb to hit aircraft */
    const aaDef = g.availableUnitsFor(h, 'infantry').find((d) => d.weapon && d.weapon.antiAir);
    const airDef = g.availableUnitsFor(g.players[1], 'aircraft')[0];
    if (aaDef && airDef) {
        const aa = g.spawnUnit(0, aaDef, base.x + 20, base.y + 150);
        const plane = g.spawnUnit(1, airDef, base.x + 220, base.y + 150);
        aa.invulnUntil = 1e9;
        const hp0 = plane.hp;
        for (let i = 0; i < 3; i++) { g.fire(aa, aa.def.weapon, plane); step(1.2); }
        res.aa = { hp0, hp1: Math.round(plane.hp), alt: plane.altitude };
        aa.dead = true; plane.dead = true;
    } else {
        res.aa = { skipped: true };
    }

    return res;
});

check('沙地比沙丘快，寻路代价更低',
    out.terrain.sandSpeed > out.terrain.duneSpeed && out.terrain.sandCost < out.terrain.duneCost,
    `沙 ${out.terrain.sandSpeed} / 丘 ${out.terrain.duneSpeed}`);
check('单位踩上沙丘会减速', out.duneMul > 0 && out.duneMul < 1, `terrainMul=${out.duneMul}`);
check('矿脉可通行且能寻路进入', out.crystalPassable === true && out.orePath === true,
    `passable=${out.crystalPassable} path=${out.orePath}`);
// The reference has NO mass-weighted pushing — a parked unit is stepped aside,
// not bulldozed. So the assertion is simply "they end up separated".
check('重叠单位会被分离（原版无质量位移）',
    out.sep && out.sep.dist >= out.sep.need * 0.9,
    out.sep ? `间距 ${out.sep.dist.toFixed(1)} / 需要 ${out.sep.need.toFixed(1)}` : 'no data');
check('两辆坦克不会重叠', out.tankDist >= out.tankNeed * 0.9,
    `${out.tankDist.toFixed(1)} >= ${out.tankNeed.toFixed(1)}`);
check('重坦碾过敌方步兵', out.crush && out.crush.victimDead === true && out.crush.tankAlive === true,
    JSON.stringify(out.crush));
check('没有单位卡进地形/建筑', out.insideWalls === 0, `inside=${out.insideWalls}`);
check('直射命中并造成伤害', out.direct && out.direct.hp1 < out.direct.hp0,
    out.direct ? `${out.direct.hp0} → ${out.direct.hp1}` : 'no data');
check('曲射爆炸留下弹坑并溅射多个目标',
    out.ballistic && !out.ballistic.skipped && out.ballistic.decals > 0 && out.ballistic.damaged >= 2,
    out.ballistic ? JSON.stringify(out.ballistic) : 'no data');
check('防空火箭能爬升命中飞机',
    out.aa && !out.aa.skipped && out.aa.hp1 < out.aa.hp0,
    out.aa ? `${out.aa.hp0} → ${out.aa.hp1} @${out.aa.alt}` : 'no data');

console.log('ERRORS', errors.length);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
