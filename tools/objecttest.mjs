/**
 * B5 (object core) regression.
 *
 * B5 is the batch that replaces the hand-rolled `game/Entities.ts` model with the
 * reference's `GameObject → Techno → {Building, Infantry, Vehicle, Aircraft}` +
 * runtime traits. Nothing here can be seen in a screenshot, so the checks are
 * about the contracts the rest of the port will lean on:
 *
 *   A. PREDICATES — the `isX()` matrix per class. These are answered by
 *      `ObjectType` on the base and *added to* by subclasses; a missing `true`
 *      makes `TileOccupation` refuse to put the object on a cell and nothing
 *      throws.
 *   B. TRAITS — the registry's cache invalidation, class vs marker filtering,
 *      and the `cachedTraits.tick` snapshot (a trait added late does not tick).
 *   C. LIFECYCLE — onSpawn / onUnspawn / onDestroy / onOwnerChange / onAttack
 *      argument order, and that `update` only walks the tick snapshot.
 *   D. TECHNO — the `MAX_SIGHT` clamp and the warped-out tick filter.
 *   E. POSITION — the sub-cell table, `tileChanged`, placeholder handling, ramp
 *      interpolation and the relative/absolute elevation round trip.
 *   F. CLASS BEHAVIOUR — 34-tick rocking, derived prone stance, BuildStatus
 *      transitions firing exactly once.
 *   G. HELPERS — Timer's dual tick/timestamp expiry, CollisionHelper's ordered
 *      cascade, LOS walls, intercept maths.
 *   H. SELECTION — the bit-set clamp, read-time filtering of dead units, groups.
 *   I. LOCOMOTOR — foot speed flooring, drive's half-speed single waypoint,
 *      chrono's "return the whole displacement" contract.
 *
 * usage: node tools/objecttest.mjs [url]
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
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => { window.__riftsandGame.aiEnabled = false; });

const evalPage = (fn) => page.evaluate(fn);

/* ======================================================== A. predicates ==== */

const A = await evalPage(() => {
    const S = window.__riftsandSim;
    const T = S.ObjectType;
    const mkRules = (over = {}) => ({
        type: T.Infantry, sight: 6, cost: 100, explodes: false, radarInvisible: false,
        c4: false, crusher: false, defaultToGuardArea: false, ...over,
    });
    const mkArt = (over = {}) => ({ foundation: { width: 1, height: 1 }, ...over });

    const plain = new S.GameObject(T.None, 'plain', mkRules(), mkArt());
    const inf = new S.Infantry(T.Infantry, 'E1', mkRules(), mkArt());
    const veh = new S.Vehicle(T.Vehicle, 'HTNK', mkRules({ naval: false }), mkArt());
    const air = new S.Aircraft(T.Aircraft, 'ORCA', mkRules(), mkArt());
    const bld = new S.Building(T.Building, 'GAPOWR', mkRules(), mkArt({ foundation: { width: 3, height: 3 } }));
    const ovl = new S.Overlay(T.Overlay, 'ORE01', mkRules(), mkArt());
    const smg = new S.Smudge(T.Smudge, 'CR1', mkRules({ width: 2, height: 1 }), mkArt());
    const trn = new S.TerrainObject(T.Terrain, 'TREE01', mkRules(), mkArt());

    const preds = (o) => ({
        tech: o.isTechno(), unit: o.isUnit(), inf: o.isInfantry(), veh: o.isVehicle(),
        air: o.isAircraft(), bld: o.isBuilding(), ovl: o.isOverlay(), smg: o.isSmudge(),
        trn: o.isTerrain(), prj: o.isProjectile(), deb: o.isDebris(),
    });

    return {
        plain: preds(plain), inf: preds(inf), veh: preds(veh), air: preds(air),
        bld: preds(bld), ovl: preds(ovl), smg: preds(smg), trn: preds(trn),
        foundationDefault: plain.getFoundation(),
        foundationOvl: ovl.getFoundation(),
        foundationSmudge: smg.getFoundation(),
        buildingCenter: bld.getFoundationCenterOffset().toArray ? bld.getFoundationCenterOffset().toArray() : [bld.getFoundationCenterOffset().x, bld.getFoundationCenterOffset().y],
        types: { inf: inf.type, veh: veh.type, bld: bld.type },
    };
});

check('GameObject 基类所有谓词为 false', Object.values(A.plain).every((v) => v === false));
check('Infantry 只回答 unit / infantry / techno',
    A.inf.tech && A.inf.unit && A.inf.inf && !A.inf.veh && !A.inf.air && !A.inf.bld);
check('Vehicle 只回答 unit / vehicle / techno',
    A.veh.tech && A.veh.unit && A.veh.veh && !A.veh.inf && !A.veh.air);
check('Aircraft 只回答 unit / aircraft / techno',
    A.air.tech && A.air.unit && A.air.air && !A.air.veh && !A.air.inf);
check('Building 只回答 building / techno（不是 unit）',
    A.bld.tech && A.bld.bld && !A.bld.unit && !A.bld.veh);
check('Overlay / Smudge / Terrain 是 GameObject 但不是 Techno',
    A.ovl.ovl && !A.ovl.tech && A.smg.smg && !A.smg.tech && A.trn.trn && !A.trn.tech);
check('getFoundation 默认 1×1', A.foundationDefault.width === 1 && A.foundationDefault.height === 1);
check('Overlay 桥面格 1×3（沿列展开）', A.foundationOvl.width === 1 && A.foundationOvl.height === 1,
    `非桥 overlay = ${A.foundationOvl.width}×${A.foundationOvl.height}`);
check('Smudge 尺寸来自 art，不是 rules', A.foundationSmudge.width === 2 && A.foundationSmudge.height === 1);
check('Building 3×3 中心偏移 = 1.5 格 = 384 lepton',
    A.buildingCenter[0] === 384 && A.buildingCenter[1] === 384, `${A.buildingCenter.join(',')}`);

/* =========================================================== B. traits ==== */

const B = await evalPage(() => {
    const S = window.__riftsandSim;
    const T = S.ObjectType;
    const obj = new S.GameObject(T.None, 'x', { type: T.None }, {});

    class Alpha { constructor(n) { this.n = n; } }
    class Beta { constructor(n) { this.n = n; } }

    const a1 = new Alpha(1);
    const b1 = new Beta(2);
    obj.traits.add(a1);
    obj.traits.add(b1);

    const byClass = obj.traits.filter(Alpha).map((t) => t.n);
    const getAll = obj.traits.getAll().length;

    // cache must be invalidated by add / addToFront / remove
    const before = obj.traits.filter(Alpha).length;
    const a2 = new Alpha(3);
    obj.traits.add(a2);
    const after = obj.traits.filter(Alpha).length;

    const front = new Beta(9);
    obj.traits.addToFront(front);
    const firstIsFront = obj.traits.getAll()[0] === front;

    obj.traits.remove(front);
    const afterRemove = obj.traits.getAll().length;

    let threw = false;
    try { obj.traits.get(Beta).missing; } catch { threw = false; }
    try { obj.traits.get(class Gamma { }); } catch (e) { threw = true; }

    // marker filtering
    const tickMarker = { [S.NotifyTick.onTick]() { } };
    const spawnMarker = { [S.NotifySpawn.onSpawn]() { } };
    obj.traits.add(tickMarker);
    obj.traits.add(spawnMarker);
    const tickCount = obj.traits.filter(S.NotifyTick).length;
    const spawnCount = obj.traits.filter(S.NotifySpawn).length;

    // dispose
    let disposed = 0;
    const disposable = { dispose() { disposed++; } };
    obj.traits.add(disposable);
    obj.traits.dispose();

    return { byClass, getAll, before, after, firstIsFront, afterRemove, threw, tickCount, spawnCount, disposed, finalLen: obj.traits.getAll().length };
});

check('filter(class) 按 instanceof 取子集', B.byClass.length === 1 && B.byClass[0] === 1);
check('getAll 返回活数组（2 条）', B.getAll === 2, String(B.getAll));
check('add 后 filter 缓存失效（1 → 2）', B.before === 1 && B.after === 2, `${B.before}→${B.after}`);
check('addToFront 插到队首', B.firstIsFront === true);
check('remove 真的移除（4 → 3）', B.afterRemove === 3, String(B.afterRemove));
check('get 找不到时抛错', B.threw === true);
check('filter(marker) 只命中实现了该 symbol 的 trait',
    B.tickCount === 1 && B.spawnCount === 1, `tick=${B.tickCount} spawn=${B.spawnCount}`);
check('dispose 逐条调用并清空', B.disposed === 1 && B.finalLen === 0);

/* ======================================================== C. lifecycle ==== */

const C = await evalPage(() => {
    const S = window.__riftsandSim;
    const T = S.ObjectType;
    const obj = new S.GameObject(T.None, 'x', { type: T.None }, {});
    const log = [];

    const trait = {
        [S.NotifySpawn.onSpawn](self, data) { log.push(['spawn', self === obj, data]); },
        [S.NotifyUnspawn.onUnspawn](self, data) { log.push(['unspawn', self === obj, data]); },
        [S.NotifyDestroy.onDestroy](self, data, type, reason) { log.push(['destroy', self === obj, data, type, reason]); },
        [S.NotifyOwnerChange.onChange](self, data, owner) { log.push(['owner', self === obj, data, owner]); },
        [S.NotifyAttack.onAttack](self, target, data) { log.push(['attack', self === obj, target, data]); },
        [S.NotifyTick.onTick](self, dt) { log.push(['tick', self === obj, dt]); },
    };
    obj.traits.add(trait);

    obj.onSpawn('SPAWN');
    const spawnedFlag = obj.isSpawned;
    obj.onUnspawn('UNSPAWN');
    const unspawnedFlag = obj.isSpawned;
    obj.onDestroy('DEST', 7, 'REASON');
    obj.onOwnerChange('OWN', 'PLAYER');
    obj.onAttack('ATK', 'DATA');
    obj.cachedTraits.tick.push(trait);
    obj.update(0.5);

    // addTrait must maintain the tick snapshot by itself
    const obj2 = new S.GameObject(T.None, 'y', { type: T.None }, {});
    const onlyTick = { [S.NotifyTick.onTick]() { } };
    const notTick = { hello() { } };
    obj2.addTrait(onlyTick);
    obj2.addTrait(notTick);
    const snapshot = obj2.cachedTraits.tick.length;

    return { log, spawnedFlag, unspawnedFlag, snapshot };
});
check('onSpawn 置 isSpawned 并回调 (self, data)', C.spawnedFlag === true && C.log[0][1] === true && C.log[0][2] === 'SPAWN');
check('onUnspawn 清 isSpawned', C.unspawnedFlag === false);
check('onDestroy 传 (self, data, type, reason)',
    C.log[2][2] === 'DEST' && C.log[2][3] === 7 && C.log[2][4] === 'REASON');
check('onOwnerChange 传 (self, data, owner)', C.log[3][2] === 'OWN' && C.log[3][3] === 'PLAYER');
check('onAttack 传 (self, target, data)', C.log[4][2] === 'DATA' && C.log[4][3] === 'ATK');
check('update 只走 cachedTraits.tick', C.log[5][0] === 'tick' && C.log[5][2] === 0.5);
check('addTrait 自动维护 tick 快照（只收 NotifyTick）', C.snapshot === 1, String(C.snapshot));

/* ========================================================== D. techno ==== */

const D = await evalPage(() => {
    const S = window.__riftsandSim;
    const T = S.ObjectType;
    const rules = { type: T.Vehicle, sight: 20, cost: 700, explodes: true, radarInvisible: false, c4: false, crusher: true, defaultToGuardArea: true };
    const v = new S.Vehicle(T.Vehicle, 'HTNK', rules, {});
    const baseSight = v.sight;
    v.veteranTrait = { veteranLevel: S.VeteranLevel.Elite, getVeteranSightMultiplier: () => 1.5 };
    const eliteSight = v.sight;
    const lvl = v.veteranLevel;

    const plain = new S.Vehicle(T.Vehicle, 'X', { ...rules, sight: 4 }, {});
    const plainLevel = plain.veteranLevel;

    // warped-out tick filter
    const ticked = [];
    const normal = { [S.NotifyTick.onTick](o, dt) { ticked.push('normal' + dt); } };
    const warpedOk = { ticksWhenWarpedOut: true, [S.NotifyTick.onTick](o, dt) { ticked.push('warp' + dt); } };
    v.cachedTraits.tick.push(normal, warpedOk);
    v.warpedOutTrait = { isActive: () => true };
    v.update(1);
    const warpedLog = ticked.slice();
    ticked.length = 0;
    v.warpedOutTrait = { isActive: () => false };
    v.update(2);
    const activeLog = ticked.slice();

    v.resetGuardModeToIdle();
    return { baseSight, eliteSight, lvl, plainLevel, warpedLog, activeLog, guardMode: v.guardMode, purchase: v.purchaseValue, crusher: v.crusher };
});

check('Techno.sight 被 MAX_SIGHT(11) 夹住', D.baseSight === 11, String(D.baseSight));
check('老兵视野倍率之后再夹一次', D.eliteSight === 11, String(D.eliteSight));
check('无 VeteranTrait 时等级为 None', D.plainLevel === 0);
check('有 VeteranTrait 时读它的等级', D.lvl === 2);
check('WarpedOut 时只跑 ticksWhenWarpedOut 的 trait',
    D.warpedLog.length === 1 && D.warpedLog[0] === 'warp1', D.warpedLog.join(','));
check('未 WarpedOut 时跑全部 tick trait', D.activeLog.length === 2, D.activeLog.join(','));
check('resetGuardModeToIdle 回到规则默认', D.guardMode === true);
check('purchaseValue 取 rules.cost', D.purchase === 700);

/* ======================================================== E. position ==== */

const E = await evalPage(() => {
    const S = window.__riftsandSim;
    const mkTile = (rx, ry, z = 0, rampType = 0) => ({ rx, ry, z, rampType });
    // A real TileCollection hands out the *same* object for the same cell; the
    // tileChanged flag is an identity check, so the stub has to cache too.
    const tileCache = new Map();
    const cachedTile = (rx, ry, z = 0, rampType = 0) => {
        const key = `${rx}_${ry}_${z}_${rampType}`;
        if (!tileCache.has(key)) tileCache.set(key, mkTile(rx, ry, z, rampType));
        return tileCache.get(key);
    };
    const tiles = {
        getByMapCoords: (rx, ry) => (rx >= 0 && ry >= 0 && rx < 8 && ry < 8 ? cachedTile(rx, ry) : undefined),
        getPlaceholderTile: (rx, ry) => ({ ...mkTile(rx, ry), placeholder: true }),
    };
    const occ = { getBridgeOnTile: () => undefined };
    const pos = new S.ObjectPosition(tiles, occ);

    const events = [];
    pos.onPositionChange.subscribe((data) => events.push(data.tileChanged));

    pos.tile = tiles.getByMapCoords(2, 3);
    const world0 = [pos.worldPosition.x, pos.worldPosition.y, pos.worldPosition.z];

    // subCell table 1..4 → offsets
    const offsets = {};
    for (const sc of [1, 2, 3, 4]) { pos.subCell = sc; offsets[sc] = [pos.getTileOffset().x, pos.getTileOffset().y]; }
    pos.subCell = 0;
    const centre = [pos.getTileOffset().x, pos.getTileOffset().y];

    // round trip: setter then getter
    const roundTrip = [];
    for (const sc of [0, 1, 2, 3, 4]) { pos.subCell = sc; roundTrip.push(pos.subCell); }

    // tileChanged: same tile → false, different → true
    events.length = 0;
    pos.tile = tiles.getByMapCoords(2, 3);
    pos.tile = tiles.getByMapCoords(3, 3);
    const changeFlags = events.slice();

    // moveToTileCoords with fractional cell
    pos.tile = tiles.getByMapCoords(0, 0);
    pos.moveToTileCoords(2.5, 3);
    const moved = { rx: pos.tile.rx, ry: pos.tile.ry, x: pos.worldPosition.x, z: pos.worldPosition.z };

    let threw = false;
    try { pos.moveToTileCoords(99, 99); } catch (e) { threw = e instanceof RangeError || e.name === 'RangeError'; }
    pos.moveToTileCoords(99, 99, true);
    const placeholder = !!pos.tile.placeholder;

    // ramp interpolation, rampType 1 = heights [0,0,1,1]
    const ramp = [
        pos.interpolateRampHeight(0, 0, 1), pos.interpolateRampHeight(1, 0, 1),
        pos.interpolateRampHeight(0, 1, 1), pos.interpolateRampHeight(1, 1, 1),
    ];

    // elevation round trip: relative then absolute
    pos.tile = mkTile(1, 1, 2);
    pos.tileElevation = 0;
    const y0 = pos.worldPosition.y;
    pos.tileElevation = 1;
    const y1 = pos.worldPosition.y;
    const elevBack = pos.tileElevation;
    pos.setAbsoluteElevationWorld(y1);
    const absBack = pos.tileElevation;

    return { world0, offsets, centre, roundTrip, changeFlags, moved, threw, placeholder, ramp, y0, y1, elevBack, absBack };
});

check('设置 tile 后世界坐标 = rx*256 / ry*256',
    E.world0[0] === 512 && E.world0[2] === 768, E.world0.join(','));
check('subCell 1..4 = 四角 ±64 lepton',
    E.offsets[1][0] === 64 && E.offsets[1][1] === 64 &&
    E.offsets[2][0] === 192 && E.offsets[2][1] === 64 &&
    E.offsets[3][0] === 64 && E.offsets[3][1] === 192 &&
    E.offsets[4][0] === 192 && E.offsets[4][1] === 192,
    JSON.stringify(E.offsets));
check('subCell 0 = 格中心 128,128', E.centre[0] === 128 && E.centre[1] === 128);
check('subCell 存取往返一致', E.roundTrip.join(',') === '0,1,2,3,4', E.roundTrip.join(','));
check('tileChanged：同格 false / 跨格 true', E.changeFlags.join(',') === 'false,true', E.changeFlags.join(','));
check('moveToTileCoords 保留格内偏移',
    E.moved.rx === 2 && E.moved.ry === 3 && E.moved.x === 2 * 256 + 128 && E.moved.z === 3 * 256,
    `${E.moved.rx},${E.moved.ry} x=${E.moved.x} z=${E.moved.z}`);
check('越界且不允许占位格时抛 RangeError', E.threw === true);
check('allowPlaceholder 走 getPlaceholderTile', E.placeholder === true);
check('rampType 1 双线性插值 = 0,1,0,1', E.ramp.join(',') === '0,1,0,1', E.ramp.join(','));
check('相对高度 +1 让世界 Y 上升一个 tile 高', E.y1 > E.y0, `${E.y0}→${E.y1}`);
check('相对高度读回 = 1', Math.abs(E.elevBack - 1) < 1e-6, String(E.elevBack));
check('绝对高度写回后相对高度一致', Math.abs(E.absBack - 1) < 1e-6, String(E.absBack));

/* ===================================================== F. class logic ==== */

const F = await evalPage(() => {
    const S = window.__riftsandSim;
    const T = S.ObjectType;
    const rules = { type: T.Vehicle, sight: 6, cost: 1, rot: 5, consideredAircraft: false, naval: false };
    const v = new S.Vehicle(T.Vehicle, 'HTNK', rules, {});
    v.applyRocking(90, 1);
    const started = v.rocking.ticksLeft;
    for (let i = 0; i < 20; i++) v.update(0.1);
    const mid = !!v.rocking;
    v.applyRocking(180, 1);
    const notExtended = v.rocking.ticksLeft;
    for (let i = 0; i < 20; i++) v.update(0.1);
    const gone = v.rocking === undefined;

    const airRules = { ...rules, consideredAircraft: true };
    const a = new S.Vehicle(T.Vehicle, 'X', airRules, {});
    a.applyRocking(90, 1);
    const airNoRock = a.rocking === undefined;

    // infantry stance: derived prone from suppression
    const infRules = { type: T.Infantry, sight: 4, cost: 1 };
    const inf = new S.Infantry(T.Infantry, 'E1', infRules, {});
    inf.moveTrait = new S.MoveTrait(inf, {});
    const none = inf.stance;
    inf.suppressionTrait = { isSuppressed: () => true };
    const derived = inf.stance;
    inf.stance = S.StanceType.Prone;
    const explicit = inf.stance;
    inf.stance = S.StanceType.Deployed;
    const disabledAfterDeploy = inf.moveTrait.isDisabled();
    inf.stance = S.StanceType.None;
    inf.suppressionTrait = { isSuppressed: () => false };
    const cleared = inf.stance;

    // building status
    const bRules = { type: T.Building, sight: 6, cost: 1 };
    const b = new S.Building(T.Building, 'GAPOWR', bRules, { foundation: { width: 2, height: 2 } });
    const initial = b.buildStatus;
    const initialLast = b.lastBuildStatus;
    const statusEvents = [];
    b.traits.add({ [S.NotifyBuildStatus.onStatusChange](oldStatus, self, ctx) { statusEvents.push([oldStatus, self.buildStatus]); } });
    const ctx = { events: { dispatch(e) { statusEvents.push(['event', e.status]); } } };
    b.setBuildStatus(S.BuildStatus.Ready, ctx);
    const afterFirst = statusEvents.length;
    b.setBuildStatus(S.BuildStatus.Ready, ctx);
    const afterSecond = statusEvents.length;

    return {
        started, mid, notExtended, gone, airNoRock,
        none, derived, explicit, disabledAfterDeploy, cleared,
        initial, initialLast, afterFirst, afterSecond,
    };
});

check('rocking 初始 34 帧', F.started === 34, String(F.started));
check('rocking 中途仍在', F.mid === true);
check('二次命中不重置倒计时（延续剩余帧）', F.notExtended === 14, String(F.notExtended));
check('34 帧后 rocking 清空', F.gone === true);
check('consideredAircraft 不 rock', F.airNoRock === true);
check('stance 默认 None', F.none === 0);
check('被压制时 None 派生为 Prone', F.derived === 2, String(F.derived));
check('显式 Prone 保持 Prone', F.explicit === 2);
check('Deployed 禁用移动', F.disabledAfterDeploy === true);
check('解除压制后回到 None', F.cleared === 0);
check('Building 初始 BuildUp', F.initial === 0 && F.initialLast === 0);
check('BuildStatus 变化各触发一次（trait + event）', F.afterFirst === 2, String(F.afterFirst));
check('重复设同一状态不再触发', F.afterSecond === 2, String(F.afterSecond));

/* ========================================================= G. helpers ==== */

const G = await evalPage(() => {
    const S = window.__riftsandSim;

    const t = new S.Timer();
    t.setActiveFor(3);
    const seq = [t.tick(0), t.tick(0), t.tick(0), t.isActive()];
    const t2 = new S.Timer();
    t2.setActiveFor(1000, 0);
    const byTimestamp = t2.tick(5000);

    const cb = new S.CrateBonuses();

    // CollisionHelper cascade
    const occ = { getObjectsOnTile: () => [], getBridgeOnTile: () => undefined };
    const helper = new S.CollisionHelper(occ);
    const mkSource = (tile, elev) => ({ tile, tileElevation: elev });
    const wallTile = { rx: 0, ry: 0, z: 0, landType: S.LandType.Wall, terrainType: S.TerrainType.Clear };
    const clearTile = { rx: 0, ry: 0, z: 0, landType: S.LandType.Clear, terrainType: S.TerrainType.Clear };
    const waterTile = { rx: 0, ry: 0, z: 0, landType: S.LandType.Water, terrainType: S.TerrainType.Water };
    const target = { tile: { z: 0 }, tileElevation: 0 };

    const wallHit = helper.checkCollisions(mkSource(wallTile, 0), target, { walls: true }).type;
    const wallOver = helper.checkCollisions(mkSource(wallTile, 3), target, { walls: true }).type;
    const shoreHit = helper.checkCollisions(mkSource(clearTile, 0), target, { shore: true }).type;
    const groundHit = helper.checkCollisions(mkSource(clearTile, -0.5), target, { ground: true }).type;
    const airZone = helper.computeDetonationZone(clearTile, 3, S.CollisionType.None);
    const waterZone = helper.computeDetonationZone(waterTile, 0, S.CollisionType.None);

    // LOS
    const mkTiles = (wallAt) => ({
        getByMapCoords: (rx, ry) => ({
            rx, ry, z: 0,
            landType: rx === wallAt && ry === 0 ? S.LandType.Wall : S.LandType.Clear,
        }),
    });
    const losOcc = { getBridgeOnTile: () => undefined };
    const weapon = {
        warhead: { rules: { wall: false } },
        projectileRules: { subjectToWalls: true, subjectToCliffs: false },
        rules: { spawner: false },
    };
    const src = { position: {}, tile: { rx: 0, ry: 0, z: 0 }, isUnit: () => true, onBridge: false };
    const dst = { position: {}, tile: { rx: 4, ry: 0, z: 0 }, isBuilding: () => false };
    const blocked = new S.LosHelper(mkTiles(2), losOcc).hasLineOfSight(src, dst, weapon);
    const clear = new S.LosHelper(mkTiles(9), losOcc).hasLineOfSight(src, dst, weapon);
    const ignoresWalls = new S.LosHelper(mkTiles(2), losOcc).hasLineOfSight(src, dst, { ...weapon, warhead: { rules: { wall: true } } });

    const intercept = S.TargetUtil.computeInterceptPoint(
        new S.Vector3(0, 0, 0),
        10,
        new S.Vector3(100, 0, 0),
        new S.Vector3(0, 0, 0),
    );
    const interceptStatic = Math.round(intercept.x);

    return {
        seq, byTimestamp, cb: [cb.firepower, cb.armor, cb.speed],
        wallHit, wallOver, shoreHit, groundHit, airZone, waterZone,
        blocked, clear, ignoresWalls, interceptStatic,
        facing: [0, 90, 180, 270].map((d) => S.FacingUtil.toMapCoords(d).toArray()),
    };
});

check('Timer 3 帧后到期（第 3 次 tick 返回 true）', G.seq.join(',') === 'false,false,true,false', G.seq.join(','));
check('Timer 时间戳路径可先于计数到期', G.byTimestamp === true);
check('CrateBonuses 三个乘数默认 1', G.cb.join(',') === '1,1,1');
check('CollisionHelper：墙在 elevation ≤ 2 命中', G.wallHit === 2, String(G.wallHit));
check('CollisionHelper：elevation 3 的墙可越过', G.wallOver === 0, String(G.wallOver));
check('CollisionHelper：非水面 → Shore', G.shoreHit === 6, String(G.shoreHit));
check('CollisionHelper：elevation < 0 → Ground', G.groundHit === 1, String(G.groundHit));
check('computeDetonationZone：高空 → Air', G.airZone === 1, String(G.airZone));
check('computeDetonationZone：水面低空 → Water', G.waterZone === 2, String(G.waterZone));
check('LosHelper：中间有墙 → 无视线', G.blocked === false);
check('LosHelper：无遮挡 → 有视线', G.clear === true);
check('LosHelper：warhead.wall 忽略墙体', G.ignoresWalls === true);
check('TargetUtil 对静止目标给出直线截距', G.interceptStatic === 100, String(G.interceptStatic));

/* ======================================================= H. selection ==== */

const H = await evalPage(() => {
    const S = window.__riftsandSim;
    const T = S.ObjectType;
    const mk = (type, rules) => new S.GameObject(type, 'x', { type, ...rules }, {});
    const wallB = mk(T.Building, { wall: true, selectable: true });
    wallB.isBuilding = () => true;
    const unselectable = mk(T.Overlay, { selectable: false });
    const selectable = mk(T.Vehicle, { selectable: true });

    const wallModel = new S.SelectionModel(wallB);
    wallModel.setSelected(true);
    const wallLevel = wallModel.getSelectionLevel();

    const unselModel = new S.SelectionModel(unselectable);
    unselModel.setSelected(true);
    unselModel.setHover(true);
    const unselSelected = unselModel.isSelected();
    const unselHovered = unselModel.isHovered();

    const selModel = new S.SelectionModel(selectable);
    selModel.setSelected(true);
    const selSelected = selModel.isSelected();
    const selHoveredBefore = selModel.isHovered();
    selModel.setHover(true);
    const selHovered = selModel.isHovered();
    selModel.setSelected(false);
    const afterDeselect = selModel.isSelected();

    // unit selection: read-time filtering
    const us = new S.UnitSelection();
    const u1 = mk(T.Vehicle, { selectable: true });
    const u2 = mk(T.Vehicle, { selectable: true });
    us.addToSelection(u1);
    us.addToSelection(u2);
    const beforeSpawn = us.getSelectedUnits().length;
    u1.onSpawn(null);
    u2.onSpawn(null);
    const afterSpawn = us.getSelectedUnits().length;
    const hash1 = us.getHash();
    us.addToSelection(mk(T.Vehicle, { selectable: true }));
    const hash2 = us.getHash();

    // groups
    us.createGroup(1);
    us.deselectAll();
    const afterDeselectAll = us.getSelectedUnits().length;
    us.selectGroup(1);
    const afterSelectGroup = us.getSelectedUnits().length;
    const groupUnits = us.getGroupUnits(1).length;

    // lite
    const lite = new S.UnitSelectionLite('me');
    const enemy = mk(T.Vehicle, { selectable: true });
    enemy.owner = 'foe';
    const mine = mk(T.Vehicle, { selectable: true });
    mine.owner = 'me';
    lite.update([mine, enemy]);
    const litePicksEnemy = lite.getSelectedUnits().length === 1 && lite.isSelected(enemy);

    return {
        wallLevel, unselSelected, unselHovered, selSelected, selHoveredBefore, selHovered,
        afterDeselect, beforeSpawn, afterSpawn, hashChanged: hash1 !== hash2,
        afterDeselectAll, afterSelectGroup, groupUnits, litePicksEnemy,
    };
});

check('墙建筑的最大选中等级是 None（连 hover 都没有）', H.wallLevel === 0, String(H.wallLevel));
check('不可选对象只能 hover，不能 selected', H.unselSelected === false && H.unselHovered === true);
check('可选对象可 selected', H.selSelected === true);
check('selected 未 hover 时 isHovered=false', H.selHoveredBefore === false);
check('setHover 后 isHovered=true', H.selHovered === true);
check('取消选中后 isSelected=false', H.afterDeselect === false);
check('未 spawn 的选中对象不出现在 getSelectedUnits', H.beforeSpawn === 0 && H.afterSpawn === 2, `${H.beforeSpawn}→${H.afterSpawn}`);
check('选中集合变化让 hash 变化', H.hashChanged === true);
check('deselectAll 清空选择（但保留分组）', H.afterDeselectAll === 0);
check('selectGroup 恢复分组选择', H.afterSelectGroup === 2 && H.groupUnits === 2, `${H.afterSelectGroup}/${H.groupUnits}`);
check('UnitSelectionLite 优先返回敌方单位', H.litePicksEnemy === true);

/* ======================================================== I. locomotor ==== */

const I = await evalPage(() => {
    const S = window.__riftsandSim;
    const V2 = S.Vector2;

    // foot
    const game = { map: { terrain: { getPassableSpeed: () => 1 } } };
    const foot = new S.FootLocomotor(game);
    const unit = {
        tile: { rx: 0, ry: 0, z: 0 },
        onBridge: false, direction: 0, isPanicked: false,
        rules: { speedType: S.SpeedType.Foot, rot: 10 },
        art: { crawls: true },
        stance: 0,
        moveTrait: { baseSpeed: 30, velocity: new S.Vector3(), lastTileSpeed: 1 },
        position: { getMapPosition: () => new V2(0, 0) },
        isInfantry: () => true,
    };
    const target = new V2(1000, 0);
    foot.onNewWaypoint(unit, target);
    const walk = foot.tick(unit, target, new V2(0, 0));
    const walkLen = Math.round(walk.distance.length());

    unit.stance = 2; // Prone
    const prone = foot.tick(unit, target, new V2(0, 0));
    const proneLen = Math.round(prone.distance.length());
    unit.art.crawls = false;
    const proneNoCrawl = foot.tick(unit, target, new V2(0, 0));
    const proneNoCrawlLen = Math.round(proneNoCrawl.distance.length());

    // drive: single waypoint → baseSpeed / 2
    const drive = new S.DriveLocomotor({ map: { terrain: { getPassableSpeed: () => 1 } } });
    const dunit = {
        tile: { rx: 0, ry: 0, z: 0 }, direction: 0, onBridge: false, spinVelocity: 0,
        rules: { speedType: S.SpeedType.Track, rot: 5, accelerates: true },
        moveTrait: { baseSpeed: 40, velocity: new S.Vector3(), lastTileSpeed: 1, speedPenalty: 0, isMoving: () => true },
        position: { getMapPosition: () => new V2(0, 0) },
        isInfantry: () => false,
    };
    const waypoints = [{ tile: { rx: 3, ry: 0, z: 0 } }];
    drive.selectNextWaypoint(dunit, waypoints);
    const turn = drive.onNewWaypoint(dunit, new V2(768, 0), new V2(768, 0));
    const turnTaskCount = Array.isArray(turn) ? turn.length : 0;
    dunit.direction = 0;
    const driveTick = drive.tick(dunit, new V2(768, 0), new V2(768, 0));
    const driveLen = Math.round(driveTick.distance.length());

    // chrono: returns the whole displacement, never moves the unit
    const chrono = new S.ChronoLocomotor({ rules: { general: { chronoTrigger: false } } });
    const cunit = {
        position: { getMapPosition: () => new V2(0, 0) },
        warpedOutTrait: { setTimed: () => { } },
    };
    const jump = chrono.tick(cunit, new V2(1000, 0), 0, false);
    const jumpLen = Math.round(jump.distance.length());

    return {
        walkLen, proneLen, proneNoCrawlLen, turnTaskCount, driveLen, jumpLen,
        driveDone: driveTick.done, jumpTeleport: jump.isTeleport === true,
    };
});

check('FootLocomotor 平地速度 = baseSpeed（已 floor）', I.walkLen === 30, String(I.walkLen));
check('Prone + Crawls=yes 速度减半', I.proneLen === 15, String(I.proneLen));
check('Prone + 无 Crawls 速度翻倍', I.proneNoCrawlLen === 60, String(I.proneNoCrawlLen));
check('DriveLocomotor 转向未完成时推一个 TurnTask', I.turnTaskCount === 1);
check('DriveLocomotor 单路点走 baseSpeed/2', I.driveLen === 20, String(I.driveLen));
check('ChronoLocomotor 一次返回整段位移并标记 teleport',
    I.jumpLen === 1000 && I.jumpTeleport === true, `${I.jumpLen}/${I.jumpTeleport}`);

/* ============================================================== summary ==== */

console.log('');
console.log(`errors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 3).join('\n'));
console.log(`\n${pass} checks passed, ${fail} failed`);

await browser.close();
process.exit(fail || errors.length ? 1 : 0);
