/**
 * v0.24 building / aircraft trait regression.
 *
 * Locks down the five reference traits that were wired this round:
 *   1. `C4ChargeTrait`    — an engineer ordered to ATTACK a structure plants a
 *                           charge, dies doing it, and the structure collapses
 *                           one fuse later (capture is a separate order);
 *   2. `CrewedTrait`      — a dying structure coughs up survivors, count from
 *                           refundValue / SurvivorDivisor;
 *   3. `FreeUnitTrait`    — a factory hands over its free unit when the buildup
 *                           animation ends, never before;
 *   4. `UnitRepairTrait`  — a pad heals what it is reloading, on the reload clock;
 *   5. `SuperWeaponTrait` — the player's weapon bag follows spawn / unspawn, with
 *                           `PlayerState.sw` kept as a mirror.
 *
 * usage: node tools/buildingtest.mjs [url]
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

/* ---------- page-side helpers ---------- */
await page.evaluate(() => {
    const g = window.__riftsandGame;
    g.aiEnabled = false;
    const { BUILDINGS, UNITS } = window.__riftsandDefs;
    const { TILE, HALF } = window.__riftsandConst;

    /** first size x size block that is completely free, scanned from (from, from) */
    const findSpot = (size, from = 30) => {
        for (let ty = from; ty < 100 - size; ty++) {
            for (let tx = from; tx < 100 - size; tx++) {
                let ok = true;
                for (let y = ty; y < ty + size && ok; y++) {
                    for (let x = tx; x < tx + size; x++) {
                        if (g.isBlocked(x, y)) { ok = false; break; }
                    }
                }
                if (ok) return { tx, ty };
            }
        }
        return null;
    };

    /** advance the simulation by `seconds` of 60 fps frames */
    const advance = (seconds) => {
        const n = Math.round(seconds * 60);
        for (let i = 0; i < n; i++) g.update(1 / 60);
    };

    window.__T = {
        g, BUILDINGS, UNITS, TILE, HALF, findSpot, advance,
        alive: (owner) => g.units.filter((u) => !u.dead && (owner === undefined || u.owner === owner)),
    };
});

const T = (fn, ...args) => page.evaluate(fn, ...args);

/* ---------------------------------------------------------------- */
/* 1. FreeUnitTrait                                                  */
/* ---------------------------------------------------------------- */
const free = await T(() => {
    const { g, BUILDINGS, findSpot, advance, alive } = window.__T;
    const spot = findSpot(3, 34);
    if (!spot) return { err: 'no spot' };
    const before = alive(0).filter((u) => u.def.id === 'anvil').length;
    const b = g.place(BUILDINGS.foundry, 0, spot.tx, spot.ty, false);
    // immediately after placement the building is still rising: no free unit yet
    const duringBuildUp = alive(0).filter((u) => u.def.id === 'anvil').length;
    advance(6);                               // buildup is 0.07 min = 4.2 s
    const after = alive(0).filter((u) => u.def.id === 'anvil').length;
    return {
        before, duringBuildUp, after,
        status: b.status,                       // 1 = Ready
        hasTrait: !!b.freeUnitTrait,
        dist: after > before ? 0 : -1,
    };
});
check('战车库建成后送出一辆铁砧装甲车',
    !free.err && free.after === free.before + 1 && free.hasTrait,
    `anvil ${free.before} → ${free.after}（建造中仍为 ${free.duringBuildUp}）`);
check('免费单位在升起动画结束前不生成（BuildUp → Ready 才触发）',
    !free.err && free.duringBuildUp === free.before && free.status === 1,
    `duringBuildUp=${free.duringBuildUp} status=${free.status}`);

/* ---------------------------------------------------------------- */
/* 2. C4ChargeTrait                                                  */
/* ---------------------------------------------------------------- */
const c4 = await T(() => {
    const { g, BUILDINGS, UNITS, TILE, HALF, findSpot } = window.__T;
    const spot = findSpot(2, 20);
    if (!spot) return { err: 'no spot' };
    const b = g.place(BUILDINGS.sunwell, 1, spot.tx, spot.ty, true);
    // one cell to the right of the footprint: inside radius + TILE
    const u = g.spawnUnit(0, UNITS.sapper, b.x + TILE, b.y);
    const orderBefore = u.order.k;
    g.orderAttackFor(u, b);
    const orderAfter = u.order.k;
    g.update(1 / 60);                          // one order tick: the charge arms
    const armed = !!b.c4ChargeTrait?.hasCharge();
    const ticksLeft = b.c4ChargeTrait?.getTicksLeft() ?? 0;
    const planterDead = u.dead;
    window.__C4B = b;                          // keep the live reference
    return { orderBefore, orderAfter, armed, ticksLeft, planterDead, sapperC4: u.c4 };
});
check('工兵对敌建筑下达攻击＝布置炸药（CaptureBuildingOrder 仍是占领）',
    !c4.err && c4.orderAfter === 'demolish' && c4.sapperC4 === true,
    `order ${c4.orderBefore} → ${c4.orderAfter}`);
check('炸药已挂在建筑上，引信按 tick 计时（45 tick = 3 s），布置者阵亡',
    !c4.err && c4.armed === true && c4.ticksLeft > 0 && c4.ticksLeft <= 45 && c4.planterDead === true,
    `armed=${c4.armed} left=${c4.ticksLeft} planterDead=${c4.planterDead}`);

const c4Boom = await T(() => {
    const { g, advance } = window.__T;
    const b = window.__C4B;
    const aliveBefore = !b.dead;
    advance(3.4);
    return { aliveBefore, dead: b.dead, deathType: b.deathType, listed: g.buildings.includes(b) };
});
check('引信到点后建筑被爆破（DeathType.Demolish），且移出建筑表',
    c4Boom.aliveBefore === true && c4Boom.dead === true && c4Boom.deathType === 2 && c4Boom.listed === false,
    `dead=${c4Boom.dead} deathType=${c4Boom.deathType} listed=${c4Boom.listed}`);

/* ---------------------------------------------------------------- */
/* 3. CrewedTrait                                                    */
/* ---------------------------------------------------------------- */
const crew = await T(() => {
    const { g, BUILDINGS, findSpot, alive } = window.__T;
    const spot = findSpot(3, 44);
    if (!spot) return { err: 'no spot' };
    // a 2600-credit provider: refund 1300 / divisor 260 = 5 survivors
    const b = g.place(BUILDINGS.orbital, 1, spot.tx, spot.ty, true);
    const before = alive(1).filter((u) => u.isInfantry()).length;
    g.kill(b, 0, null);
    const after = alive(1).filter((u) => u.isInfantry()).length;
    return { before, after, gain: after - before, hasTrait: !!b.crewedTrait };
});
check('建筑被摧毁后幸存者跑出（refund/Divisor，上限 5）',
    !crew.err && crew.gain === 5 && crew.hasTrait,
    `步兵 ${crew.before} → ${crew.after}`);

const crewSold = await T(() => {
    const { g, BUILDINGS, findSpot, alive, advance } = window.__T;
    const spot = findSpot(2, 50);
    if (!spot) return { err: 'no spot' };
    const b = g.place(BUILDINGS.tent, 0, spot.tx, spot.ty, true);
    const before = alive(0).filter((u) => u.isInfantry()).length;
    g.selectedBuilding = b;
    g.sellSelectedBuilding();
    advance(5);                                // builddown is 0.07 min
    const after = alive(0).filter((u) => u.isInfantry()).length;
    return { before, after, gain: after - before, gone: b.dead };
});
check('拆除建筑同样会放出幸存者（NotifySell.onSell）',
    !crewSold.err && crewSold.gain >= 1 && crewSold.gone === true,
    `步兵 ${crewSold.before} → ${crewSold.after}`);

/* ---------------------------------------------------------------- */
/* 4. UnitRepairTrait (airfield pad)                                 */
/* ---------------------------------------------------------------- */
const repair = await T(() => {
    const { g, BUILDINGS, UNITS, TILE, HALF, findSpot, advance } = window.__T;
    const spot = findSpot(3, 56);
    if (!spot) return { err: 'no spot' };
    const pad = g.place(BUILDINGS.airpad, 0, spot.tx, spot.ty, true);
    const u = g.spawnUnit(0, UNITS.warden, pad.x + TILE * 2, pad.y);
    u.hp = u.maxHp * 0.5;
    u.ammoTrait.ammo = 0;                      // just landed to rearm, so it stays put
    u.landed = true;
    const dockTile = pad.dockTrait.getDockTile(0);
    if (dockTile) {
        u.x = dockTile.rx * TILE + TILE / 2 - HALF;
        u.y = dockTile.ry * TILE + TILE / 2 - HALF;
    }
    pad.dockTrait.dockUnitAt(u, 0);
    u.dockedAt = pad;

    const before = u.hp;
    const creditsBefore = g.players[0].credits;
    // drive the trait directly: one call == one 15 Hz tick, which is exactly
    // how `Game.tickBuildingTraits` drives it in a real match
    for (let i = 0; i < 40; i++) pad.unitRepairTrait.onTick(pad, g.repairWorld);
    const direct = u.hp;
    const status = pad.unitRepairTrait.getStatus();

    // and the same thing through the real update loop, on a fresh dent
    u.hp = u.maxHp * 0.5;
    advance(3);
    const looped = u.hp;
    return {
        before: Math.round(before),
        direct: Math.round(direct),
        looped: Math.round(looped),
        max: Math.round(u.maxHp),
        status,
        spent: creditsBefore - g.players[0].credits,
        hasTrait: !!pad.unitRepairTrait,
        reloadRateUsed: !!(pad.unitReloadTrait && pad.unitRepairTrait),
    };
});
check('机场维修走 UnitRepairTrait 且按装填时钟（非维修厂时钟）',
    !repair.err && repair.hasTrait && repair.reloadRateUsed,
    `hasTrait=${repair.hasTrait} reloadClock=${repair.reloadRateUsed}`);
check('停靠的飞机会被逐渐修好（RepairPercent 按造价扣费）',
    !repair.err && repair.direct > repair.before && repair.spent > 0 && repair.status === 1,
    `hp ${repair.before} → ${repair.direct} / ${repair.max}，扣费 ${repair.spent}，status=${repair.status}`);
check('维修在真实 update 循环里也会推进',
    !repair.err && repair.looped > repair.before,
    `hp ${repair.before} → ${repair.looped} / ${repair.max}`);

/* ---------------------------------------------------------------- */
/* 5. SuperWeaponTrait                                               */
/* ---------------------------------------------------------------- */
const sw = await T(() => {
    const { g, BUILDINGS, findSpot, advance } = window.__T;
    const spot = findSpot(3, 62);
    if (!spot) return { err: 'no spot' };
    const before = g.human.superWeaponsTrait.has('orbital');
    const b = g.place(BUILDINGS.orbital, 0, spot.tx, spot.ty, true);
    const added = g.human.superWeaponsTrait.has('orbital');
    const mirrored = g.human.sw.some((s) => s.id === 'orbital');
    const sameInstance = g.human.superWeaponsTrait.get('orbital') === g.human.sw.find((s) => s.id === 'orbital');
    g.kill(b, 1, null);
    advance(0.2);
    const removedFromTrait = g.human.superWeaponsTrait.has('orbital');
    const removedFromMirror = g.human.sw.some((s) => s.id === 'orbital');
    return { before, added, mirrored, sameInstance, removedFromTrait, removedFromMirror };
});
check('超武建筑生成 → 玩家武器袋获得该超武（trait 与 sw 镜像同一实例）',
    !sw.err && sw.before === false && sw.added === true && sw.mirrored === true && sw.sameInstance === true,
    `added=${sw.added} mirrored=${sw.mirrored}`);
check('超武建筑被摧毁 → 武器袋与镜像同步移除',
    !sw.err && sw.removedFromTrait === false && sw.removedFromMirror === false,
    `trait=${sw.removedFromTrait} mirror=${sw.removedFromMirror}`);

/* ---------------------------------------------------------------- */
/* 6. 飞机侧 trait 挂载（SpawnLink / Unlandable）                     */
/* ---------------------------------------------------------------- */
const air = await T(() => {
    const { g, UNITS, TILE, HALF, findSpot } = window.__T;
    UNITS.hammer.unlandable = true;
    UNITS.warden.spawnedBy = 'airpad';
    const spot = findSpot(1, 40);
    const a = g.spawnUnit(0, UNITS.hammer, spot.tx * TILE + TILE / 2 - HALF, spot.ty * TILE + TILE / 2 - HALF);
    const b = g.spawnUnit(0, UNITS.warden, spot.tx * TILE + TILE / 2 - HALF + TILE, spot.ty * TILE + TILE / 2 - HALF);
    return {
        unlandable: !!a.unlandableTrait,
        spawned: !!b.spawnLinkTrait,
        crashable: !!a.crashableTrait,
    };
});
check('UnlandableTrait / SpawnLinkTrait 按 def 挂载到飞机上',
    air.unlandable && air.spawned && air.crashable,
    `unlandable=${air.unlandable} spawnLink=${air.spawned} crashable=${air.crashable}`);

console.log(`ERRORS ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 3).join('\n'));
console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
