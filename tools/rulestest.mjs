/**
 * B2 (rules layer) regression.
 *
 * The rules layer is a *data* layer, so most of it is trivially correct once the
 * numbers are right. What this script guards is the handful of derivations and
 * defaults where "obviously reasonable" and "what the reference does" differ — the
 * places a future edit would silently break:
 *
 *   A. DERIVED ON READ — `refundPercent` clamped, `revealTriggerRadius` capped,
 *      `UnitCount`-style optional fields staying `undefined`.
 *   B. GUARDS THAT THROW — missing prerequisite bucket, unknown warhead, unknown
 *      missile type, unknown tiberium id, non-techno internal id.
 *   C. THE THREE LAND-RULE EARLY-OUTS — Foot blocked by Track=0, missing column
 *      meaning 1, non-Track/Wheel clamped to 1.
 *   D. OCCUPATION BITS — negative masks folded into [0,8), sub-cell expansion.
 *   E. DERIVED DEFAULTS — `radarInvisible` from wall/rock, `acceleration` from
 *      `ROT === 1`, `isAntiGround` defaulting to true.
 *
 * usage: node tools/rulestest.mjs [url]
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

/* ------------------------------------------- A. GeneralRules derived on read */
const general = await T(() => {
    const S = window.__riftsandSim;
    const build = (generalOverrides) => new S.Rules({
        ...S.RULES_CONTENT,
        general: { ...S.RULES_CONTENT.general, ...generalOverrides },
    });
    const clampHigh = build({ refundPercent: 1.5 }).general.refundPercent;
    const clampLow = build({ refundPercent: -1 }).general.refundPercent;
    const radius = build({ revealTriggerRadius: 50 }).general.revealTriggerRadius;
    const radiusDefault = build({ revealTriggerRadius: undefined }).general.revealTriggerRadius;

    let prereqThrows = false;
    try {
        build({ prerequisiteProc: undefined });
    }
    catch (e) {
        prereqThrows = /prerequisite category/i.test(e.message);
    }

    const live = S.RULES.general;
    let missileOk = false, missileThrows = false;
    try { missileOk = live.getMissileRules('V3Rocket') === live.v3Rocket; } catch (e) { /* noop */ }
    try { live.getMissileRules('Nope'); } catch (e) { missileThrows = true; }

    return {
        clampHigh, clampLow, radius, radiusDefault,
        prereqThrows,
        prereqSize: live.prereqCategories.size,
        missileOk, missileThrows,
        crewAllied: live.crew.alliedCrew,
        buildSpeed: live.buildSpeed,
        multipleFactory: live.multipleFactory,
        closeEnough: live.closeEnough,
        c4: S.RULES.combatDamage.c4Delay,
        reload: live.repair.reloadRate,
    };
});
check('refundPercent 1.5 被夹到 1', general.clampHigh === 1, String(general.clampHigh));
check('refundPercent -1 被夹到 0', general.clampLow === 0, String(general.clampLow));
check('revealTriggerRadius 50 被压到 10', general.radius === 10, String(general.radius));
check('revealTriggerRadius 缺省 → 0', general.radiusDefault === 0, String(general.radiusDefault));
check('缺 prerequisiteProc 时 readPrereqCategories 抛错', general.prereqThrows);
check('六个 prerequisite 桶全部就位', general.prereqSize === 6, String(general.prereqSize));
check('getMissileRules("V3Rocket") 返回 v3Rocket 实例', general.missileOk);
check('getMissileRules 未知类型抛错', general.missileThrows);
check('crew / buildSpeed / multipleFactory / closeEnough 数值就位',
    general.crewAllied === 'pebble' && general.buildSpeed === 1 &&
    general.multipleFactory === 0.8 && general.closeEnough === 2,
    `crew=${general.crewAllied} build=${general.buildSpeed} mf=${general.multipleFactory} close=${general.closeEnough}`);
check('c4Delay 落在 [CombatDamage] 而非 [General]',
    general.c4 === 0.05, String(general.c4));
check('reloadRate 落在 [General] Repair 块', Math.abs(general.reload - 1 / 60) < 1e-12, String(general.reload));

/* ------------------------------------------------ C. LandRules three early-outs */
const land = await T(() => {
    const S = window.__riftsandSim;
    const { SpeedType, LandType } = S;
    // A synthetic section: Track 0 blocks Foot too, Hover has a positive modifier
    // that must collapse to exactly 1.
    const blocked = new S.LandRules({
        buildable: false,
        speed: { [SpeedType.Track]: 0, [SpeedType.Hover]: 0.4, [SpeedType.Wheel]: 0.5 },
    });
    const rock = S.RULES.getLandRules(LandType.Rock);
    const water = S.RULES.getLandRules(LandType.Water);
    const cliff = S.RULES.getLandRules(LandType.Cliff);
    const clear = S.RULES.getLandRules(LandType.Clear);
    return {
        footBlocked: blocked.getSpeedModifier(SpeedType.Foot),
        hoverOnBlocked: blocked.getSpeedModifier(SpeedType.Hover),
        wheelOnBlocked: blocked.getSpeedModifier(SpeedType.Wheel),
        missingColumn: blocked.getSpeedModifier(SpeedType.Float),
        rockTrack: rock.getSpeedModifier(SpeedType.Track),
        rockFoot: rock.getSpeedModifier(SpeedType.Foot),
        rockHover: rock.getSpeedModifier(SpeedType.Hover),
        waterTrack: water.getSpeedModifier(SpeedType.Track),
        waterFoot: water.getSpeedModifier(SpeedType.Foot),
        waterWheel: water.getSpeedModifier(SpeedType.Wheel),
        waterHover: water.getSpeedModifier(SpeedType.Hover),
        cliffTrack: cliff.getSpeedModifier(SpeedType.Track),
        clearBuildable: clear.buildable,
        rockBuildable: rock.buildable,
        isLandRules: cliff instanceof S.LandRules,
    };
});
check('Track=0 时 Foot 也被挡住 → 0', land.footBlocked === 0, String(land.footBlocked));
check('非 Track/Wheel 的正 modifier 被夹成 1（Hover 不吃减速）',
    land.hoverOnBlocked === 1, String(land.hoverOnBlocked));
check('Wheel 保留自己的 modifier（0.5）', land.wheelOnBlocked === 0.5, String(land.wheelOnBlocked));
check('缺失列按 1 处理（不是 0）', land.missingColumn === 1, String(land.missingColumn));
check('Rock: 只有 Track/Wheel 保留小数，Foot 被夹成 1',
    land.rockTrack === 0.7 && land.rockFoot === 1,
    `track=${land.rockTrack} foot=${land.rockFoot}`);
check('Rock: Hover 被夹成 1', land.rockHover === 1, String(land.rockHover));
check('Water: 三条地面列显式为 0（水不可通行）',
    land.waterTrack === 0 && land.waterFoot === 0 && land.waterWheel === 0,
    `track=${land.waterTrack} foot=${land.waterFoot} wheel=${land.waterWheel}`);
check('Water: Hover 缺列 → 1（气垫船能过水）',
    land.waterHover === 1, String(land.waterHover));
check('Cliff 走显式 [Cliff] 段（硬不可通行，不回落 [Rock] 的 0.7）',
    land.cliffTrack === 0 && land.isLandRules, String(land.cliffTrack));
check('buildable: Clear=true / Rock=false',
    land.clearBuildable === true && land.rockBuildable === false);

/* ------------------------------------------------- D. occupation bits folding */
const terrain = await T(() => {
    const S = window.__riftsandSim;
    const mk = (bits) => new S.TerrainRules(S.ObjectType.Terrain, {
        name: 'TREE', temperateOccupationBits: bits, snowOccupationBits: bits,
    });
    return {
        negOne: mk(-1).temperateOccupationBits,
        eight: mk(8).temperateOccupationBits,
        nine: mk(9).temperateOccupationBits,
        all: mk(S.OccupationBits.All).getOccupiedSubCells(S.TheaterType.Temperate),
        rightOnly: mk(S.OccupationBits.Right).getOccupiedSubCells(S.TheaterType.Temperate),
        snowSeparate: (() => {
            const t = new S.TerrainRules(S.ObjectType.Terrain, {
                name: 'TREE', temperateOccupationBits: S.OccupationBits.All, snowOccupationBits: S.OccupationBits.Right,
            });
            return [t.getOccupiedSubCells(S.TheaterType.Snow).length, t.getOccupiedSubCells(S.TheaterType.Temperate).length];
        })(),
    };
});
check('occupationBits -1 折回 7', terrain.negOne === 7, String(terrain.negOne));
check('occupationBits 8 折回 0', terrain.eight === 0, String(terrain.eight));
check('occupationBits 9 折回 1', terrain.nine === 1, String(terrain.nine));
check('All → 五个子格全占', terrain.all.length === 5 && terrain.all.join(',') === '0,1,2,3,4');
check('Right(1) → 只占 0,1,2', terrain.rightOnly.join(',') === '0,1,2');
check('Snow 与 Temperate 分开取值',
    terrain.snowSeparate[0] === 3 && terrain.snowSeparate[1] === 5,
    terrain.snowSeparate.join('/'));

/* -------------------------------------- E. derived defaults on object rules */
const derived = await T(() => {
    const S = window.__riftsandSim;
    const { ObjectType } = S;
    const overlay = (data) => new S.OverlayRules(ObjectType.Overlay, { name: 'X', ...data });
    const proj = (data) => new S.ProjectileRules(ObjectType.Projectile, { name: 'P', ...data });
    const debris = (data) => new S.DebrisRules(ObjectType.VoxelAnim, { name: 'D', ...data });
    return {
        wallRadar: overlay({ wall: true }).radarInvisible,
        rockRadar: overlay({ isARock: true }).radarInvisible,
        plainRadar: overlay({}).radarInvisible,
        forcedRadar: overlay({ wall: true, radarInvisible: true }).radarInvisible,
        accelInstant: String(proj({ rot: 1 }).acceleration),
        accelDefault: proj({}).acceleration,
        accelExplicit: proj({ acceleration: 5 }).acceleration,
        agDefault: proj({}).isAntiGround,
        aaDefault: proj({}).isAntiAir,
        rotDegs: proj({ rot: 128 }).rot,
        shadowDefault: proj({}).shadow,
        elasticityHigh: debris({ elasticity: 2 }).elasticity,
        elasticityLow: debris({ elasticity: -1 }).elasticity,
        elasticityDefault: debris({}).elasticity,
        white: (() => { const c = S.Color.fromHsv(0, 0, 255); return [c.r, c.g, c.b]; })(),
        red: (() => { const c = S.Color.fromHsv(0, 255, 255); return [c.r, c.g, c.b]; })(),
        hueWrap: (() => { const c = S.Color.fromHsv(255, 255, 255); return [c.r, c.g, c.b]; })(),
    };
});
check('Overlay: Wall 默认不上雷达', derived.wallRadar === false);
check('Overlay: IsARock 默认不上雷达', derived.rockRadar === false);
check('Overlay: 普通 overlay 默认上雷达', derived.plainRadar === true);
check('Overlay: 显式 radarInvisible 覆盖推导值', derived.forcedRadar === true);
check('Projectile: ROT=1 且无加速度 → Infinity（不是 0/3）',
    derived.accelInstant === 'Infinity', derived.accelInstant);
check('Projectile: 无加速度 → 3', derived.accelDefault === 3, String(derived.accelDefault));
check('Projectile: 显式加速度保留', derived.accelExplicit === 5, String(derived.accelExplicit));
check('Projectile: AG 默认 true / AA 默认 false',
    derived.agDefault === true && derived.aaDefault === false);
check('Projectile: ROT 128 → 180 度/帧', derived.rotDegs === 180, String(derived.rotDegs));
check('Projectile: Shadow 默认 true', derived.shadowDefault === true);
check('Debris: elasticity 夹到 [0,1]，缺省 0.75',
    derived.elasticityHigh === 1 && derived.elasticityLow === 0 && derived.elasticityDefault === 0.75,
    `${derived.elasticityHigh}/${derived.elasticityLow}/${derived.elasticityDefault}`);
check('Color.fromHsv: 0,0,255 → 白',
    derived.white.join(',') === '255,255,255', derived.white.join(','));
check('Color.fromHsv: 0,255,255 → 红',
    derived.red.join(',') === '255,0,0', derived.red.join(','));
check('Color.fromHsv: h=255 绕回红色',
    derived.hueWrap.join(',') === '255,0,0', derived.hueWrap.join(','));

/* --------------------------------- B. guards that throw + optional semantics */
const guards = await T(() => {
    const S = window.__riftsandSim;
    const { ObjectType } = S;
    const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };
    return {
        warheadThrows: throws(() => S.RULES.getWarhead('NoSuchWarhead')),
        tib0: S.RULES.getTiberium(0).value,
        tib1: S.RULES.getTiberium(1).value,
        tibThrows: throws(() => S.RULES.getTiberium(99)),
        overlayIdThrows: throws(() => S.RULES.getOverlayName(99)),
        nonTechnoThrows: throws(() => S.RULES.getTechnoByInternalId(0, ObjectType.Overlay)),
        projectileDefaults: S.RULES.getProjectile('NoSuchProjectile').acceleration,
        ensureUnknown: S.RULES.ensureMapObjectDefaults('NoSuchObject', ObjectType.Building),
        hasNuke: [...S.RULES.weaponTypes.values()].includes('NukePayload'),
        crateNone: new S.CrateRules().read({ unitCrateType: 'NONE' }).unitCrateType,
        crateReal: new S.CrateRules().read({ unitCrateType: 'MTNK' }).unitCrateType,
        mpAbsent: new S.MpDialogSettings().read({}).techLevel,
        mpZero: new S.MpDialogSettings().read({ techLevel: 0 }).techLevel,
        swLower: new S.SuperWeaponRules(0, { name: 'NukeSpecial', sidebarImage: 'NUKICON' }).sidebarImage,
        elevStep: new S.ElevationModelRules().read({ elevationIncrement: 4, elevationIncrementBonus: 5, elevationBonusCap: 50 }).getBonus(13, 4),
        elevDown: new S.ElevationModelRules().read({ elevationIncrement: 4, elevationIncrementBonus: 5, elevationBonusCap: 50 }).getBonus(4, 13),
        elevCap: new S.ElevationModelRules().read({ elevationIncrement: 4, elevationIncrementBonus: 5, elevationBonusCap: 50 }).getBonus(400, 0),
        fires: new S.AudioVisualRules().read({ damageFireTypes: 'FIRE01.FIRE02,FIRE03' }).fireNames,
        idle: new S.AudioVisualRules().read({ idleActionFrequency: 0.5 }).idleActionFrequency,
        countryNoSide: throws(() => new S.CountryRules('0', { name: 'X' })),
        countryBadSide: throws(() => new S.CountryRules('0', { name: 'X', side: 'Nope' })),
        countryEnum: new S.CountryRules('0', { name: 'X', side: S.SideType.GDI }).side,
        powerupsKept: new S.PowerupsRules().read({ Money: '20,<none>,yes', IonStorm: '5,<none>,no' }).powerups.map((p) => p.type),
        powerupAnim: new S.PowerupsRules().read({ Money: '20,<none>,yes' }).powerups[0].animName,
    };
});
check('未知 warhead 抛错', guards.warheadThrows);
check('Tiberium 表: 0 → 25 / 1 → 50',
    guards.tib0 === 25 && guards.tib1 === 50, `${guards.tib0}/${guards.tib1}`);
check('未知 tiberium id 抛错', guards.tibThrows);
check('未知 overlay id 抛错', guards.overlayIdThrows);
check('非 techno 类型查 internal id 抛错', guards.nonTechnoThrows);
check('无 section 的 projectile 合成默认值（acceleration 3）',
    guards.projectileDefaults === 3, String(guards.projectileDefaults));
check('ensureMapObjectDefaults 对未声明对象返回 false', guards.ensureUnknown === false);
check('武器表包含 NukePayload', guards.hasNuke);
check('CrateRules: UnitCrateType="NONE" → undefined', guards.crateNone === undefined);
check('CrateRules: 真实值保留', guards.crateReal === 'MTNK');
check('MpDialogSettings: 缺 key 保持 undefined，0 保持 0',
    guards.mpAbsent === undefined && guards.mpZero === 0);
check('SuperWeaponRules: sidebarImage 小写化', guards.swLower === 'nukicon', guards.swLower);
check('ElevationModel: 高差 9 / 步长 4 → 2 步 × 5 = 10', guards.elevStep === 10, String(guards.elevStep));
check('ElevationModel: 低处打高处 → 0', guards.elevDown === 0, String(guards.elevDown));
check('ElevationModel: bonusCap 卡的是步数不是百分比（50 步 × 5 = 250）',
    guards.elevCap === 250, String(guards.elevCap));
check('AudioVisual: DamageFireTypes 同时按 . 和 , 切分',
    guards.fires.join(',') === 'FIRE01,FIRE02,FIRE03', guards.fires.join(','));
check('AudioVisual: idleActionFrequency 乘 60', guards.idle === 30, String(guards.idle));
check('CountryRules: 缺 Side 抛错', guards.countryNoSide);
check('CountryRules: 未知 Side 抛错', guards.countryBadSide);
check('CountryRules: 接受 SideType 枚举', guards.countryEnum === 0, String(guards.countryEnum));
check('PowerupsRules: 不支持的 payout 在读取时被剔除',
    guards.powerupsKept.length === 1 && guards.powerupsKept[0] === 3,
    guards.powerupsKept.join(','));
check('PowerupsRules: "<none>" 动画名归一成 undefined', guards.powerupAnim === undefined);

/* ------------------------------------------------------------------ done --- */
console.log('');
console.log(`${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
