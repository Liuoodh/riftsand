/**
 * B3 (combat maths) regression.
 *
 * B3 is the first batch where a wrong line changes *gameplay* instead of just
 * displaying a wrong number, so every assertion here pins a reference behaviour
 * that a reasonable-looking refactor would break:
 *
 *   A. DAMAGE ARITHMETIC — round away from zero, `verses` missing slot = full
 *      damage, and the `|| 1` that also turns an explicit 0% into 100%.
 *   B. DAMAGE MULTIPLIERS — prone discount skipped for radiation/temporal,
 *      veteran armour is a *divisor*, crate armour is a *divisor*.
 *   C. WALL / BRIDGE OVERRIDES — absolute destroyer, wall-only warheads, the
 *      bridge `damage = 0` rule.
 *   D. HEALTHTRAIT — percentage <-> HP round trip, the `max(1, ...)` floor, the
 *      `-30` projected-damage clamp.
 *   E. WEAPON — speed for arcing / hitscan, secondary range cap, rof divisors.
 *   F. TARGETING — paradrop altitude, secondary-only AA, land/naval matrices.
 *   G. RANGE — building bonus, downhill bonus.
 *   H. TARGET — ore sets `isOre` but not `obj`, bridge forces `bridgeMode`.
 *   I. RADIAL WALK — ring order and the distance-0 case.
 *   J. TABLE LOOKUPS — bridge / ore id ranges.
 *   K. END-TO-END DETONATE — a 100-damage shell actually kills a 100-HP tank,
 *      fires the right events, and picks the damage-scaled animation.
 *
 * usage: node tools/combattest.mjs [url]
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
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__riftsandSim, { timeout: 60000 });

const T = (fn) => page.evaluate(fn);

/* ------------------------------------------------- A. damage arithmetic --- */
const arithmetic = await T(() => {
    const S = window.__riftsandSim;
    const world = {
        gameOpts: { destroyableBridges: true },
        rules: { audioVisual: {}, combatDamage: {} },
        generateRandomInt: (a) => a,
    };
    const target = (armor, extra = {}) => ({
        isTechno: () => true, isUnit: () => true, isInfantry: () => false,
        isBuilding: () => false, isAircraft: () => false, isVehicle: () => true,
        isOverlay: () => false, isTerrain: () => false,
        rules: {
            armor, warpable: true, immune: false, immuneToRadiation: false,
            invisibleInGame: false, fraidycat: false, insignificant: false,
            typeImmune: false, wall: false, ...extra,
        },
        invulnerableTrait: { isActive: () => false },
        veteranTrait: undefined,
        crateBonuses: { armor: 1, firepower: 1 },
        zone: 0,
    });
    const wh = (data) => new S.Warhead(new S.WarheadRules({ name: 'T', ...data }));
    const A = S.ArmorType;

    return {
        versesHit: wh({ verses: [1, 0.5] }).computeDamage(10, target(A.Flak), world),
        versesMissing: wh({ verses: [1, 0.5] }).computeDamage(10, target(A.Heavy), world),
        versesExplicitZero: wh({ verses: [0] }).computeDamage(10, target(A.None), world),
        floorPos: wh({}).computeDamage(1.9, target(A.None), world),
        ceilNeg: wh({}).computeDamage(-1.9, target(A.None), world),
        subUnit: wh({}).computeDamage(0.9, target(A.None), world),
        veteran: (() => {
            const t = target(A.None);
            t.veteranTrait = { getVeteranArmorMultiplier: () => 2 };
            return wh({}).computeDamage(10, t, world);
        })(),
        crate: (() => {
            const t = target(A.None);
            t.crateBonuses = { armor: 4, firepower: 1 };
            return wh({}).computeDamage(10, t, world);
        })(),
    };
});

check('verses[Flak]=0.5 生效 → 10 × 0.5 = 5', arithmetic.versesHit === 5, String(arithmetic.versesHit));
check('verses 缺槽位 → `|| 1` 满伤 10', arithmetic.versesMissing === 10, String(arithmetic.versesMissing));
check('verses 显式写 0 → `0 || 1` 仍是满伤 10（原版如此）',
    arithmetic.versesExplicitZero === 10, String(arithmetic.versesExplicitZero));
check('正伤害向下取整 1.9 → 1', arithmetic.floorPos === 1, String(arithmetic.floorPos));
check('负伤害向上取整 -1.9 → -1', arithmetic.ceilNeg === -1, String(arithmetic.ceilNeg));
check('0.9 伤害在 computeDamage 处归 0（±1 吸附在 detonate 里，够不着）',
    arithmetic.subUnit === 0, String(arithmetic.subUnit));
check('老兵护甲是除数：10 / 2 = 5', arithmetic.veteran === 5, String(arithmetic.veteran));
check('箱子护甲是除数：10 / 4 = 2.5 → floor 2', arithmetic.crate === 2, String(arithmetic.crate));

/* -------------------------------------------- B. damage multipliers ------- */
const multipliers = await T(() => {
    const S = window.__riftsandSim;
    const world = {
        gameOpts: { destroyableBridges: true },
        rules: { audioVisual: {}, combatDamage: {} },
        generateRandomInt: (a) => a,
    };
    const infantry = (stance) => ({
        isTechno: () => true, isUnit: () => true, isInfantry: () => true,
        isBuilding: () => false, isAircraft: () => false, isVehicle: () => false,
        isOverlay: () => false, isTerrain: () => false,
        rules: {
            armor: S.ArmorType.None, warpable: true, immune: false,
            immuneToRadiation: false, invisibleInGame: false, fraidycat: false,
            insignificant: false, typeImmune: false, wall: false,
        },
        invulnerableTrait: { isActive: () => false },
        crateBonuses: { armor: 1, firepower: 1 },
        stance,
        zone: 0,
    });
    const wh = (data) => new S.Warhead(new S.WarheadRules({ name: 'T', ...data }));
    const prone = wh({ proneDamage: 0.5 });

    return {
        proneHit: prone.computeDamage(10, infantry(S.StanceType.Prone), world),
        standing: prone.computeDamage(10, infantry(S.StanceType.Guard), world),
        radProne: wh({ proneDamage: 0.5, radiation: true }).computeDamage(
            10, infantry(S.StanceType.Prone), world),
        tempProne: wh({ proneDamage: 0.5, temporal: true }).computeDamage(
            10, infantry(S.StanceType.Prone), world),
    };
});

check('卧倒步兵吃 0.5 倍（10 → 5）', multipliers.proneHit === 5, String(multipliers.proneHit));
check('站立步兵不吃折扣（10）', multipliers.standing === 10, String(multipliers.standing));
check('辐射弹头不吃卧倒折扣（10）', multipliers.radProne === 10, String(multipliers.radProne));
check('时空弹头不吃卧倒折扣（10）', multipliers.tempProne === 10, String(multipliers.tempProne));

/* ------------------------------------------------- C. wall / bridge ------- */
const walls = await T(() => {
    const S = window.__riftsandSim;
    const world = {
        gameOpts: { destroyableBridges: true },
        rules: { audioVisual: {}, combatDamage: {} },
        generateRandomInt: (a) => a,
    };
    const obj = (extra) => ({
        isTechno: () => true, isUnit: () => false, isInfantry: () => false,
        isBuilding: () => !!extra.building, isAircraft: () => false, isVehicle: () => false,
        isOverlay: () => !!extra.overlay, isTerrain: () => false,
        isBridge: () => !!extra.bridge,
        overlayId: extra.overlayId ?? 0,
        rules: {
            armor: extra.armor ?? S.ArmorType.None, warpable: true, immune: false,
            immuneToRadiation: false, invisibleInGame: false, fraidycat: false,
            insignificant: false, typeImmune: false, wall: !!extra.wall,
        },
        invulnerableTrait: { isActive: () => false },
        crateBonuses: { armor: 1, firepower: 1 },
        zone: 0,
    });
    const wh = (data) => new S.Warhead(new S.WarheadRules({ name: 'T', ...data }));
    const wallObj = obj({ overlay: true, wall: true, armor: S.ArmorType.Concrete });

    return {
        absDestroyer: (() => {
            const v = wh({ wallAbsoluteDestroyer: true }).computeDamage(10, wallObj, world);
            return !Number.isFinite(v) && v > 0;
        })(),
        plainWh: wh({}).computeDamage(10, wallObj, world),
        wallWh: wh({ wall: true }).computeDamage(10, wallObj, world),
        woodWhOnWoodWall: wh({ wood: true }).computeDamage(
            10, obj({ overlay: true, wall: true, armor: S.ArmorType.Wood }), world),
        woodWhOnConcreteWall: wh({ wood: true }).computeDamage(10, wallObj, world),
        bridgeNoWall: wh({}).computeDamage(
            10, obj({ overlay: true, bridge: true, overlayId: 74 }), world),
        bridgeWithWall: wh({ wall: true }).computeDamage(
            10, obj({ overlay: true, bridge: true, overlayId: 74 }), world),
    };
});

check('WallAbsoluteDestroyer → 正无穷', walls.absDestroyer === true, String(walls.absDestroyer));
check('普通弹头打墙 → 0', walls.plainWh === 0, String(walls.plainWh));
check('Wall=yes 弹头打墙 → 10', walls.wallWh === 10, String(walls.wallWh));
check('Wood=yes 打木墙 → 10（不是 0）', walls.woodWhOnWoodWall === 10, String(walls.woodWhOnWoodWall));
check('Wood=yes 打混凝土墙 → 0', walls.woodWhOnConcreteWall === 0, String(walls.woodWhOnConcreteWall));
check('非 Wall 弹头打桥 → 0', walls.bridgeNoWall === 0, String(walls.bridgeNoWall));
check('Wall=yes 弹头打桥 → 保留伤害', walls.bridgeWithWall === 10, String(walls.bridgeWithWall));

/* ------------------------------------------------------- D. HealthTrait -- */
const health = await T(() => {
    const S = window.__riftsandSim;
    const go = { traits: { filter: () => [] } };
    const world = { traits: { filter: () => [] }, events: { dispatch: () => {} }, currentTick: 0 };
    const t = new S.HealthTrait(100, go, 0.5, 0.25);
    const fresh = { hp: t.getHitPoints(), health: t.health, level: t.level };

    t.health = 40;
    const at40 = { hp: t.getHitPoints(), level: t.level };

    t.health = 1;
    const at1 = { hp: t.getHitPoints(), health: t.health };

    t.health = 0;
    const at0 = t.getHitPoints();

    const small = new S.HealthTrait(50, go, 0.5, 0.25);
    small.health = 1;

    const proj = new S.HealthTrait(100, go, 0.5, 0.25);
    proj.projectDamage(50);
    const proj50 = proj.getProjectedHitPoints();
    proj.projectDamage(200);
    const projNeg = proj.getProjectedHitPoints();

    let throwsFractional = false;
    try { proj.setHitPoints(1.5); } catch { throwsFractional = true; }

    const full = new S.HealthTrait(100, go, 0.5, 0.25);
    full.healBy(10, {}, world);

    return {
        fresh, at40, at1, at0,
        smallHp: small.getHitPoints(), smallHealth: small.health,
        proj50, projNeg, throwsFractional,
        healedFull: full.getHitPoints(),
    };
});

check('新建 HealthTrait(100) → HP 100 / health 100 / level Green',
    health.fresh.hp === 100 && health.fresh.health === 100 && health.fresh.level === 0,
    `${health.fresh.hp}/${health.fresh.health}/${health.fresh.level}`);
check('health = 40 → 40 HP / level Yellow',
    health.at40.hp === 40 && health.at40.level === 1, `${health.at40.hp}/${health.at40.level}`);
check('health = 1% → 1 HP，不是 0', health.at1.hp === 1, String(health.at1.hp));
check('health = 0 → 0 HP（唯一能杀死的方式）', health.at0 === 0, String(health.at0));
check('max 50 / health 1% → 1 HP 且回报 2%（百分比与 HP 的不对称）',
    health.smallHp === 1 && health.smallHealth === 2, `${health.smallHp}/${health.smallHealth}`);
check('projectDamage(50) → 50', health.proj50 === 50, String(health.proj50));
check('projectDamage 下限是 -30', health.projNeg === -30, String(health.projNeg));
check('setHitPoints 拒绝小数', health.throwsFractional);
check('满血 healBy 无副作用', health.healedFull === 100, String(health.healedFull));

/* ------------------------------------------------------------- E. Weapon -- */
const weapon = await T(() => {
    const S = window.__riftsandSim;
    const speed = (weaponRules, projectileRules) =>
        S.Weapon.computeSpeed(
            { name: 'W', iniSpeed: 0, speed: 0, ...weaponRules },
            { name: 'P', iniRot: 1, ...projectileRules },
        );

    const makeBuilding = (over = {}) => ({
        isBuilding: () => true, isUnit: () => false, isVehicle: () => false,
        isInfantry: () => false, isAircraft: () => false, isTechno: () => true,
        overpoweredTrait: undefined,
        garrisonTrait: { isOccupied: () => true, units: { length: 3 } },
        openToppedTrait: undefined,
        veteranTrait: undefined,
        primaryWeapon: { rules: { range: 8 } },
        position: { getMapPosition: () => new S.Vector3() },
        art: { turretOffset: 0 },
        direction: 0,
        crateBonuses: { firepower: 1, armor: 1 },
        rules: {
            distributedFire: false, radialFireSegments: 0,
            burstDelay: undefined, fighter: false, turretAnim: '',
            turretAnimX: 0, turretAnimY: 0,
        },
        ...over,
    });
    const mk = (building, type, rules) =>
        new S.Weapon(
            type, building,
            { name: 'W', burst: 1, rof: 60, iniSpeed: 0, speed: 0, ...rules },
            { rules: {} }, { name: 'P', iniRot: 1 }, new S.FlhCoords(), {},
        );

    const plain = makeBuilding();
    const secRange = mk(plain, S.WeaponType.Secondary, { range: 12 }).range;
    const primRange = mk(plain, S.WeaponType.Primary, { range: 12 }).range;
    const secOverpowered =
        mk(makeBuilding({ overpoweredTrait: {} }), S.WeaponType.Secondary, { range: 12 }).range;
    const garrisonRof = mk(plain, S.WeaponType.Primary, { rof: 60 }).rof;
    const veteranRof =
        mk(makeBuilding({
            veteranTrait: { getVeteranRofMultiplier: () => 0.5 },
            garrisonTrait: { isOccupied: () => false, units: { length: 0 } },
        }), S.WeaponType.Primary, { range: 8, rof: 61 }).rof;

    const isInf = (v) => !Number.isFinite(v) && v > 0;

    return {
        arcing: speed({}, { arcing: true }),
        noRot: isInf(speed({}, { rot: false })),
        inviso: isInf(speed({}, { rot: true, inviso: true })),
        laser: isInf(speed({ isLaser: true }, { rot: true })),
        bolt: isInf(speed({ isElectricBolt: true }, { rot: true })),
        normal: speed({ speed: 42 }, { rot: true }),
        secRange, primRange, secOverpowered, garrisonRof, veteranRof,
    };
});

check('arcing 速度 = 0.75 × min(256, 128) = 96', weapon.arcing === 96, String(weapon.arcing));
check('!rot → 正无穷（不是大数）', weapon.noRot === true, String(weapon.noRot));
check('rot 但 inviso → 正无穷', weapon.inviso === true, String(weapon.inviso));
check('rot 但 isLaser → 正无穷', weapon.laser === true, String(weapon.laser));
check('rot 但 isElectricBolt → 正无穷', weapon.bolt === true, String(weapon.bolt));
check('普通弹道取 rules.speed = 42', weapon.normal === 42, String(weapon.normal));
check('建筑副武器被主武器射程封顶 → min(8,12) = 8', weapon.secRange === 8, String(weapon.secRange));
check('建筑主武器不受封顶 → 12', weapon.primRange === 12, String(weapon.primRange));
check('Overpowered 建筑副武器解封 → 12', weapon.secOverpowered === 12, String(weapon.secOverpowered));
check('驻军 3 人 → rof 60/3 = 20', weapon.garrisonRof === 20, String(weapon.garrisonRof));
check('老兵 ROF 乘完再 floor：61 × 0.5 = 30.5 → 30（未驻军）',
    weapon.veteranRof === 30, String(weapon.veteranRof));

/* ---------------------------------------------------------- F. targeting -- */
const targeting = await T(() => {
    const S = window.__riftsandSim;
    const shooter = {
        name: 'SHOOTER', owner: 'p1',
        rules: { navalTargeting: S.NavalTargeting.NavalNone, landTargeting: S.LandTargeting.LandOk },
        isUnit: () => true, isInfantry: () => false, isVehicle: () => true,
        isAircraft: () => false, isBuilding: () => false, isTechno: () => true,
    };
    const target = (extra = {}) => ({
        name: 'T', owner: 'p2',
        rules: { navalTargeting: S.NavalTargeting.NavalAll, landTargeting: S.LandTargeting.LandOk },
        zone: 0,
        isUnit: () => true, isInfantry: () => false, isVehicle: () => true,
        isAircraft: () => false, isBuilding: () => false, isTechno: () => true,
        ...extra,
    });
    const mk = (type, proj) =>
        new S.WeaponTargeting(type, proj, { damage: 10 }, {}, shooter, { prism: { type: 'PRISM' } });

    return {
        secOnlyAaGround: mk(S.WeaponType.Secondary, { isAntiGround: false, isAntiAir: true })
            .canTarget(target()),
        bothGround: mk(S.WeaponType.Primary, { isAntiGround: true, isAntiAir: true })
            .canTarget(target()),
        airWithAg: mk(S.WeaponType.Primary, { isAntiGround: true, isAntiAir: false })
            .canTarget(target({ zone: 1 })),
        airWithAa: mk(S.WeaponType.Primary, { isAntiGround: true, isAntiAir: true })
            .canTarget(target({ zone: 1 })),
        paradropAg: mk(S.WeaponType.Primary, { isAntiGround: true, isAntiAir: false })
            .canTarget(target({ isInfantry: () => true, stance: S.StanceType.Paradrop, tileElevation: 5 })),
        paradropAa: mk(S.WeaponType.Primary, { isAntiGround: true, isAntiAir: true })
            .canTarget(target({ isInfantry: () => true, stance: S.StanceType.Paradrop, tileElevation: 5 })),
        paradropLow: mk(S.WeaponType.Primary, { isAntiGround: true, isAntiAir: false })
            .canTarget(target({ isInfantry: () => true, stance: S.StanceType.Paradrop, tileElevation: 2 })),
    };
});

check('Secondary 专用对空武器不能打地面（zone 判定拦截）',
    targeting.secOnlyAaGround === false, String(targeting.secOnlyAaGround));
check('双用途主武器可以打地面', targeting.bothGround === true, String(targeting.bothGround));
check('纯对地武器打不了空中', targeting.airWithAg === false, String(targeting.airWithAg));
check('对空武器可以打空中', targeting.airWithAa === true, String(targeting.airWithAa));
check('空降中（>2 格）步兵需要防空武器', targeting.paradropAg === false, String(targeting.paradropAg));
check('空降中步兵被防空武器接受', targeting.paradropAa === true, String(targeting.paradropAa));
check('高度 2 的空降步兵不吃防空豁免（走地面判定）',
    targeting.paradropLow === true, String(targeting.paradropLow));

/* --------------------------------------------------------------- G. range -- */
const range = await T(() => {
    const S = window.__riftsandSim;
    const helper = new S.RangeHelper({ calculateTilesForGameObject: (t) => [t] });
    const gameRules = { elevationModel: { getBonus: (from, to) => (from - to) * 5 } };
    const weapon = (rules = {}, proj = {}) => ({
        minRange: 0, range: 10,
        rules: { limboLaunch: false, cellRangefinding: false, ...rules },
        projectileRules: {
            arcing: false, vertical: false, subjectToElevation: true, isAntiAir: false, ...proj,
        },
        warhead: { rules: { ivanBomb: false } },
    });
    const shooter = {
        tile: { z: 0, rx: 0, ry: 0 }, position: { tileElevation: 0 },
        isTechno: () => true, isUnit: () => true, isBuilding: () => false,
        rules: { movementZone: 0, airRangeBonus: 0 },
    };
    const bigBuilding = {
        tile: { z: 0, rx: 5, ry: 5 }, position: { tileElevation: 0 },
        isBuilding: () => true, isUnit: () => false, isTechno: () => true,
        getFoundation: () => ({ width: 4, height: 2 }),
        rules: { movementZone: 0, airRangeBonus: 0 },
    };
    const flatTarget = {
        tile: { z: 0, rx: 5, ry: 5 }, position: { tileElevation: 0 },
        isBuilding: () => false, isUnit: () => true, isTechno: () => true,
        rules: { movementZone: 0, airRangeBonus: 0 },
    };

    return {
        buildingBonus: helper.computeWeaponRangeVsTarget(shooter, bigBuilding, weapon(), gameRules).range,
        arcingNoBonus: helper.computeWeaponRangeVsTarget(
            shooter, bigBuilding, weapon({}, { arcing: true }), gameRules).range,
        downhill: helper.computeWeaponRangeVsTarget(
            { ...shooter, tile: { z: 4, rx: 0, ry: 0 } }, flatTarget, weapon(), gameRules).range,
        uphill: helper.computeWeaponRangeVsTarget(
            shooter, { ...flatTarget, tile: { z: 4, rx: 5, ry: 5 } }, weapon(), gameRules).range,
    };
});

check('4x2 建筑 × 平射武器 → ceil(min(4,2)/2) = 1 → 11',
    range.buildingBonus === 11, String(range.buildingBonus));
check('抛物线武器不给建筑加成 → 10', range.arcingNoBonus === 10, String(range.arcingNoBonus));
check('下坡 (4-0)×5 = 20 加成 → 30', range.downhill === 30, String(range.downhill));
check('上坡无加成 → 10', range.uphill === 10, String(range.uphill));

/* --------------------------------------------------------------- H. Target -- */
const targetObj = await T(() => {
    const S = window.__riftsandSim;
    const occ = { getBridgeOnTile: () => ({ tileElevation: 4 }) };
    const tile = { rx: 3, ry: 4, z: 0, landType: S.LandType.Clear };

    const oreObj = {
        isOverlay: () => true, isBridge: () => false, isTiberium: () => true, tile, value: 5,
    };
    const bridgeObj = {
        isOverlay: () => true, isBridge: () => true, isTiberium: () => false,
        tile: { rx: 7, ry: 8, z: 0, landType: S.LandType.Clear },
        tileElevation: 4,
    };
    const building = {
        isOverlay: () => false, isBridge: () => false, isTiberium: () => false,
        isBuilding: () => true, tile: { rx: 1, ry: 1 }, centerTile: { rx: 2, ry: 2 },
    };

    const tOre = new S.Target(oreObj, tile, occ);
    const tBridge = new S.Target(bridgeObj, bridgeObj.tile, occ);
    const tBuilding = new S.Target(building, building.tile, occ);
    const tOreTile = new S.Target(null, { ...tile, landType: S.LandType.Tiberium }, occ);

    return {
        oreHasObj: !!tOre.obj,
        oreIsOre: tOre.isOre,
        oreTileRx: tOre.tile.rx,
        oreTileLand: tOreTile.isOre,
        bridgeMode: tBridge.getBridgeMode(),
        bridgeIsBridge: tBridge.isBridge(),
        buildingTileRx: tBuilding.tile.rx,
    };
});

check('矿石 overlay：isOre=true 但不设 obj',
    targetObj.oreIsOre === true && targetObj.oreHasObj === false,
    `${targetObj.oreIsOre}/${targetObj.oreHasObj}`);
check('矿石 overlay：tile 取矿石自己的格', targetObj.oreTileRx === 3, String(targetObj.oreTileRx));
check('Tiberium 地块（无对象）也算 isOre', targetObj.oreTileLand === true);
check('桥 overlay 强制 bridgeMode = Bridge(2)', targetObj.bridgeMode === 2, String(targetObj.bridgeMode));
check('桥 overlay → isBridge() true', targetObj.bridgeIsBridge === true);
check('建筑 target 用 centerTile，不是 tile', targetObj.buildingTileRx === 2, String(targetObj.buildingTileRx));

/* ------------------------------------------------------- I. radial walk --- */
const radial = await T(() => {
    const S = window.__riftsandSim;
    const tiles = [];
    for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) tiles.push({ rx: x, ry: y, z: 0, landType: 0 });
    }
    const collection = { getByMapCoords: (x, y) => tiles.find((t) => t.rx === x && t.ry === y) };
    const bounds = { isWithinBounds: () => true };
    const centre = tiles.find((t) => t.rx === 4 && t.ry === 4);

    const walk = (maxDistance, predicate) => {
        const out = [];
        const finder = new S.RadialTileFinder(
            collection, bounds, centre, { width: 1, height: 1 }, 0, maxDistance, predicate);
        let t;
        while ((t = finder.getNextTile())) out.push(`${t.rx},${t.ry}`);
        return out;
    };

    return {
        order0: walk(0, () => true),
        order1: walk(1, () => true),
        rejected: walk(0, () => false).length,
    };
});

check('distance 0 只给起始格',
    radial.order0.length === 1 && radial.order0[0] === '4,4', radial.order0.join(' | '));
check('predicate 拒绝时 distance 0 什么都不给', radial.rejected === 0, String(radial.rejected));
check('环 1 的环序：底行右→左，右列下→上，顶行左→右，左列下→上',
    radial.order1.join(' ') === '4,4 5,5 4,5 3,5 5,4 5,3 3,3 4,3 3,4',
    radial.order1.join(' '));

/* ---------------------------------------------------------- J. id tables -- */
const tables = await T(() => {
    const S = window.__riftsandSim;
    return {
        wood74: S.BridgeOverlayTypes.getOverlayBridgeType(74),
        concrete205: S.BridgeOverlayTypes.getOverlayBridgeType(205),
        concrete24: S.BridgeOverlayTypes.getOverlayBridgeType(24),
        notBridge: S.BridgeOverlayTypes.getOverlayBridgeType(50),
        lowHead92: S.BridgeOverlayTypes.isLowBridgeHead(92),
        ore127: S.OreOverlayTypes.getOverlayTibType(127),
        ore110: S.OreOverlayTypes.getOverlayTibType(110),
        gems30: S.OreOverlayTypes.getOverlayTibType(30),
    };
});

check('桥 id 74 → Wood(2)', tables.wood74 === 2, String(tables.wood74));
check('桥 id 205 → Concrete(1)', tables.concrete205 === 1, String(tables.concrete205));
check('桥 id 24 → Concrete(1)', tables.concrete24 === 1, String(tables.concrete24));
check('桥 id 50 → NotBridge(0)', tables.notBridge === 0, String(tables.notBridge));
check('低桥头 id 92（74+18）→ true', tables.lowHead92 === true, String(tables.lowHead92));
check('矿 id 127 落在 Riparius/Vinifera 重叠区 → Riparius(1)（先测 Riparius）',
    tables.ore127 === 1, String(tables.ore127));
check('矿 id 110 → Riparius(1)', tables.ore110 === 1, String(tables.ore110));
check('矿 id 30 → Cruentus(2)', tables.gems30 === 2, String(tables.gems30));

/* ---------------------------------------------------- K. end-to-end hit --- */
const e2e = await T(() => {
    const S = window.__riftsandSim;

    const tile = { rx: 5, ry: 5, z: 0, landType: S.LandType.Clear, rampType: 0 };
    const onTile = [];
    const events = [];
    const destroyed = [];
    const world = {
        map: {
            tiles: { getByMapCoords: (x, y) => (x === 5 && y === 5 ? tile : undefined) },
            mapBounds: { isWithinBounds: () => true, width: 16, height: 16 },
            tileOccupation: { calculateTilesForGameObject: (t) => [t] },
            getObjectsOnTile: () => onTile,
        },
        alliances: { areAllied: () => false },
        traits: { filter: () => [] },
        events: { dispatch: (e) => events.push(e.type) },
        rules: {
            audioVisual: { weaponNullifyAnim: 'NULLIFY', weatherConBoltExplosion: 'WX' },
            combatDamage: { splashList: ['S1', 'S2', 'S3'], c4Warhead: 'C4' },
        },
        gameOpts: { destroyableBridges: true },
        mapRadiationTrait: { createRadSite: () => {} },
        art: { hasObject: () => false },
        smudgeRules: new Map(),
        destroyObject: (o) => destroyed.push(o),
        generateRandomInt: (a) => a,
    };

    const makeGo = () => {
        const go = {
            traits: { filter: () => [] },
            isSpawned: true, isDisposed: false, isDestroyed: false, isCrashing: false,
            rules: {
                armor: S.ArmorType.None, warpable: true, immune: false,
                immuneToRadiation: false, invisibleInGame: false, fraidycat: false,
                insignificant: false, typeImmune: false, wall: false,
            },
            position: {
                worldPosition: new S.Vector3(0, 0, 0),
                getMapPosition: () => new S.Vector3(0, 0, 0),
                tileElevation: 0,
            },
            direction: 0, owner: { isCombatant: () => true }, name: 'TANK',
            zone: 0, tileElevation: 0,
            isTechno: () => true, isUnit: () => true, isBuilding: () => false,
            isInfantry: () => false, isAircraft: () => false, isVehicle: () => true,
            isOverlay: () => false, isTerrain: () => false, isBridge: () => false,
            onAttack: () => {},
            applyRocking: () => {},
            warpedOutTrait: { isInvulnerable: () => false },
            invulnerableTrait: { isActive: () => false },
            moveTrait: { reservedPathNodes: [], isIdle: () => true },
            unitOrderTrait: { hasTasks: () => false, addTask: () => {} },
            crateBonuses: { armor: 1, firepower: 1 },
        };
        go.healthTrait = new S.HealthTrait(100, go, 0.5, 0.25);
        return go;
    };

    const detonate = (wh, damage) => {
        const evBefore = events.length;
        wh.detonate(
            world, damage, tile, 0, new S.Vector3(0, 0, 0), S.ZoneType.Ground, undefined,
            { obj: onTile[0] }, undefined, false, undefined,
        );
        return events.slice(evBefore);
    };

    // 100 damage vs 100 HP
    onTile.length = 0;
    const victim = makeGo();
    onTile.push(victim);
    const killEvents = detonate(
        new S.Warhead(new S.WarheadRules({ name: 'HE', animList: ['A1', 'A2', 'A3'] })), 100);

    // 60 damage: survives at 40
    onTile.length = 0;
    const survivor = makeGo();
    onTile.push(survivor);
    detonate(new S.Warhead(new S.WarheadRules({ name: 'HE' })), 60);

    // 0.5 damage: floored away by computeDamage, NOT snapped to 1
    onTile.length = 0;
    const scratched = makeGo();
    onTile.push(scratched);
    detonate(new S.Warhead(new S.WarheadRules({ name: 'HE' })), 0.5);

    return {
        victimHp: victim.healthTrait.getHitPoints(),
        destroyed: destroyed.length,
        killEvents,
        survivorHp: survivor.healthTrait.getHitPoints(),
        scratchedHp: scratched.healthTrait.getHitPoints(),
    };
});

check('端到端：100 伤害打 100 HP → 死亡且 HP 归零',
    e2e.victimHp === 0 && e2e.destroyed === 1, `${e2e.victimHp}/${e2e.destroyed}`);
check('端到端：事件链 HealthChange(29) → InflictDamage(28) → ObjectAttacked(12) → WarheadDetonate(30)',
    e2e.killEvents.join(',') === '29,28,12,30', e2e.killEvents.join(','));
check('端到端：60 伤害剩 40 HP', e2e.survivorHp === 40, String(e2e.survivorHp));
check('端到端：0.5 伤害被 computeDamage 取整成 0，一滴血都不掉',
    e2e.scratchedHp === 100, String(e2e.scratchedHp));

/* ------------------------------------------------------------------ done --- */
console.log('');
console.log(`${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
