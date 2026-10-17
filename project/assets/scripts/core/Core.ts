/**
 * RIFTSAND / 裂沙战线 — core data layer.
 * All gameplay content (factions, units, buildings, economy) is defined here.
 * Original IP: no Red Alert names, art, sounds or stats are used.
 */
import { Color } from 'cc';

export type Faction = 'BU' | 'DS';
export type Armor = 'light' | 'heavy' | 'air' | 'building';
export type DmgType = 'small' | 'ap' | 'explosive';
export type ProjKind = 'bullet' | 'shell' | 'rocket' | 'bomb';

/** sidebar production categories, same split as the classics */
export type ProdCat = 'structure' | 'infantry' | 'vehicle' | 'aircraft';
/** how a unit behaves when it is not explicitly ordered around */
export type Stance = 'aggressive' | 'guard' | 'hold';
export type SuperWeaponId = 'orbital' | 'aegis' | 'sandstorm' | 'mirage';

export interface WeaponDef {
    dmg: number;
    type: DmgType;
    range: number;
    cd: number;
    splash?: number;
    proj: ProjKind;
    turret?: boolean;   // can only shoot in facing arc (visual only here)
    antiAir?: boolean;  // required to shoot at aircraft
    /** muzzle velocity in world units / second (defaults per projectile kind) */
    speed?: number;
    /** follow a gravity arc instead of flying straight (shells, bombs, mortars) */
    ballistic?: boolean;
    /** steer toward the target every frame (rockets) */
    homing?: boolean;
    /** how much damage remains at the edge of the splash radius (0..1) */
    falloff?: number;
}

export interface UnitDef {
    id: string;
    name: string;
    faction: Faction;
    kind: 'infantry' | 'vehicle' | 'air' | 'harvester' | 'mcv';
    /** heavy hulls run over enemy infantry */
    crush?: boolean;
    /** rides an air cushion: ignores dune slowdown and can cross rubble */
    hover?: boolean;
    /** flight height, used by the renderer and by ground weapons */
    altitude?: number;
    cost: number;
    time: number;
    hp: number;
    armor: Armor;
    speed: number;      // world units / second
    sight: number;      // tiles
    radius: number;     // collision radius (world units)
    from: string;       // producing building id (spawn / tech hint)
    tech: number;       // 0 = always, 1 = needs tech building, 2/3 = higher tiers
    desc: string;
    weapon?: WeaponDef;
    cargo?: number;
    mineTime?: number;
    /** stays hidden from enemies unless a detector is nearby */
    cloak?: boolean;
    /** captures enemy structures instead of shooting */
    engineer?: boolean;
    /** deploys into a command core */
    mcv?: boolean;
}

export interface BuildingDef {
    id: string;
    name: string;
    faction: Faction;
    cost: number;
    time: number;
    hp: number;
    size: number;       // in tiles (square)
    sight: number;      // tiles
    power: number;      // + produces, - consumes
    tech: number;
    produces?: string[];    // legacy list, kept for flavour text
    factory?: ProdCat;      // which sidebar queue this building unlocks
    dropoff?: boolean;      // accepts harvesters
    isCore?: boolean;
    detects?: boolean;      // reveals cloaked enemies
    superWeapon?: SuperWeaponId;
    desc: string;
    weapon?: WeaponDef;
}

/* ------------------------------------------------------------------ */
/* Palette — desert + slate + cyan neon, matching the reference sheet  */
/* ------------------------------------------------------------------ */
export const PAL = {
    sand: '#c9a173',
    sandLight: '#d9b585',
    sandDark: '#ad8757',
    sandShadow: '#8d6b45',
    rock: '#9c8464',
    rockDark: '#6f5b41',
    slate: '#2b3038',
    slateLight: '#3d444f',
    slateDark: '#191d23',
    ink: '#10141a',
    cyan: '#3fd9ec',
    cyanDim: '#1d7c8a',
    amber: '#e8a33d',
    red: '#e5523f',
    green: '#5cc46a',
    teamBU: '#e8a33d',
    teamDS: '#3fbf9a',
    ds: '#3fbf9a',
    dsDim: '#1d6b58',
    violet: '#a06bd6',
    white: '#f2f5f7',
};

export const HEX = (h: string, a = 255): Color => {
    const s = h.replace('#', '');
    return new Color(
        parseInt(s.substring(0, 2), 16),
        parseInt(s.substring(2, 4), 16),
        parseInt(s.substring(4, 6), 16),
        a,
    );
};

export const TEAM_COLOR: Record<Faction, string> = { BU: PAL.teamBU, DS: PAL.teamDS };

/* ------------------------------------------------------------------ */
/* World constants                                                     */
/* ------------------------------------------------------------------ */
export const TILE = 32;
/**
 * 80x80 cells. The retail maps are ~100 cells a side and the camera keeps the
 * viewport inside the playfield, so a 64-cell map left the camera pinned against
 * an edge with the base off-centre.
 */
export const MAP_TILES = 80;
export const MAP_SIZE = TILE * MAP_TILES;
export const HALF = MAP_SIZE / 2;

export const START_CREDITS = 4200;
export const MAX_CREDITS = 99999;
export const HARVEST_TICK = 4.2;      // seconds to fill cargo
export const UNLOAD_TIME = 2.2;
export const QUEUE_MAX = 5;           // per unit queue
export const POWER_PENALTY_TIME = 1.7;

/** veterancy: xp needed per rank = unit cost * ratio, kills grant target cost */
export const VET_XP_RATIO = 3;
export const VET_MAX_LEVEL = 2;
/** seconds for a super weapon to recharge */
export const SW_CHARGE = 170;
/** how often a supply crate drops somewhere on the map */
export const CRATE_INTERVAL = 52;
/** buildings must be raised within this many tiles of an existing structure */
export const BUILD_RADIUS_TILES = 9;

/* ------------------------------------------------------------------ */
/* Touch interface tuning (mobile-first)                               */
/* ------------------------------------------------------------------ */
export const TAP_MAX_MS = 320;        // press shorter than this = tap
export const TAP_SLOP = 10;           // px the finger may drift and still count as a tap
export const LONG_PRESS_MS = 400;     // hold longer than this = advanced command wheel
export const BOX_MIN_PX = 18;         // drag further than this = box select
export const SNAP_PX = 28;            // target snap radius in screen pixels
export const GROUP_COUNT = 5;         // control groups

export const tileToWorld = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2 - HALF, y: ty * TILE + TILE / 2 - HALF });
export const worldToTile = (x: number, y: number) => ({ tx: Math.floor((x + HALF) / TILE), ty: Math.floor((y + HALF) / TILE) });
export const inMap = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < MAP_TILES && ty < MAP_TILES;

/** which sidebar tab a unit belongs to */
export const unitCategory = (d: UnitDef): ProdCat =>
    d.kind === 'infantry' ? 'infantry' : d.kind === 'air' ? 'aircraft' : 'vehicle';

/* ------------------------------------------------------------------ */
/* Damage matrix                                                       */
/* ------------------------------------------------------------------ */
export const DMG_TABLE: Record<DmgType, Record<Armor, number>> = {
    small: { light: 0.75, heavy: 0.28, air: 0.55, building: 0.25 },
    ap: { light: 0.85, heavy: 1.00, air: 0.40, building: 0.60 },
    explosive: { light: 0.80, heavy: 0.70, air: 0.15, building: 0.95 },
};

/* ------------------------------------------------------------------ */
/* Factions                                                            */
/* ------------------------------------------------------------------ */
export interface FactionDef {
    id: Faction;
    name: string;
    en: string;
    motto: string;
    blurb: string;
    color: string;
    glow: string;
    style: string;
    core: string;
    harvester: string;
    mcv: string;
    engineer: string;
    stealth: string;
}

export const FACTIONS: Record<Faction, FactionDef> = {
    BU: {
        id: 'BU',
        name: '磐岩联合',
        en: 'BASTION UNION',
        motto: '钢铁不退，沙海为墙',
        blurb: '矿工与工程师的后代。重甲厚盾、火力压制，以要塞化的推进节奏碾过沙海。',
        color: PAL.teamBU,
        glow: PAL.cyan,
        style: '重装 · 阵地 · 高生存',
        core: 'core',
        harvester: 'hourglass',
        mcv: 'rig',
        engineer: 'sapper',
        stealth: 'veil',
    },
    DS: {
        id: 'DS',
        name: '沙蜥商团',
        en: 'DUNE SYNDICATE',
        motto: '风往哪吹，我们就去哪',
        blurb: '拾荒者与走私者的联盟。轻装高机动、量产快攻，用速度与数量撕开缺口。',
        color: PAL.teamDS,
        glow: PAL.violet,
        style: '机动 · 游击 · 高产',
        core: 'nest',
        harvester: 'scav',
        mcv: 'crawler',
        engineer: 'wire',
        stealth: 'shade',
    },
};

/* ------------------------------------------------------------------ */
/* Unit table                                                          */
/* ------------------------------------------------------------------ */
const U = (d: UnitDef) => d;

export const UNITS: Record<string, UnitDef> = {
    /* ---------------- BASTION UNION ---------------- */
    pebble: U({
        id: 'pebble', name: '石垒步枪兵', faction: 'BU', kind: 'infantry',
        cost: 130, time: 4.5, hp: 120, armor: 'light', speed: 36, sight: 6, radius: 7,
        from: 'barracks', tech: 0,
        weapon: { dmg: 10, type: 'small', range: 118, cd: 0.75, proj: 'bullet' },
        desc: '廉价可靠的制式步兵，适合掩护与占点。',
    }),
    breaker: U({
        id: 'breaker', name: '破岩火箭兵', faction: 'BU', kind: 'infantry',
        cost: 320, time: 8, hp: 105, armor: 'light', speed: 31, sight: 7, radius: 7,
        from: 'barracks', tech: 1,
        weapon: { dmg: 34, type: 'ap', range: 148, cd: 2.1, proj: 'rocket', antiAir: true },
        desc: '穿甲火箭，专治重型装甲，也能打下低空目标。',
    }),
    sapper: U({
        id: 'sapper', name: '战地工兵', faction: 'BU', kind: 'infantry',
        cost: 480, time: 7.5, hp: 95, armor: 'light', speed: 40, sight: 6, radius: 7,
        from: 'barracks', tech: 0, engineer: true,
        desc: '潜入敌方建筑将其接管，用后即撤。对己方建筑使用可紧急抢修。',
    }),
    veil: U({
        id: 'veil', name: '帷幕潜行者', faction: 'BU', kind: 'infantry',
        cost: 420, time: 8, hp: 100, armor: 'light', speed: 40, sight: 6, radius: 7,
        from: 'barracks', tech: 2, cloak: true,
        weapon: { dmg: 24, type: 'small', range: 104, cd: 0.95, proj: 'bullet' },
        desc: '光学迷彩步兵，开火前几乎无法被发现。需要探测器或警戒塔才能反制。',
    }),
    anvil: U({
        id: 'anvil', name: '铁砧装甲车', faction: 'BU', kind: 'vehicle',
        cost: 480, time: 8.5, hp: 300, armor: 'light', speed: 62, sight: 9, radius: 11,
        from: 'foundry', tech: 1,
        weapon: { dmg: 13, type: 'small', range: 132, cd: 0.6, proj: 'bullet' },
        desc: '轮式速射装甲车，反步兵与侦察兼顾。',
    }),
    rampart: U({
        id: 'rampart', name: '城墙主战坦克', faction: 'BU', kind: 'vehicle',
        cost: 950, time: 15, hp: 700, armor: 'heavy', speed: 42, sight: 7, radius: 13,
        from: 'foundry', tech: 1, crush: true,
        weapon: { dmg: 52, type: 'ap', range: 168, cd: 1.9, proj: 'shell' },
        desc: '磐岩联合的战线基石。厚装甲 + 长身管主炮。',
    }),
    mortar: U({
        id: 'mortar', name: '雷钵自行炮', faction: 'BU', kind: 'vehicle',
        cost: 1100, time: 17, hp: 380, armor: 'light', speed: 32, sight: 7, radius: 13,
        from: 'foundry', tech: 2,
        weapon: { dmg: 78, type: 'explosive', range: 330, cd: 3.4, splash: 52, proj: 'shell', ballistic: true },
        desc: '超远射程曲射火力，拆建筑与清兵一流，但非常脆弱。',
    }),
    warden: U({
        id: 'warden', name: '天穹无人机', faction: 'BU', kind: 'air',
        cost: 700, time: 12, hp: 240, armor: 'air', speed: 92, sight: 10, radius: 12,
        from: 'airpad', tech: 2, altitude: 28,
        weapon: { dmg: 20, type: 'small', range: 155, cd: 1.0, proj: 'bullet', antiAir: true },
        desc: '空中侦察与对地骚扰，也能拦截敌方飞行器。',
    }),
    hammer: U({
        id: 'hammer', name: '重锤轰炸机', faction: 'BU', kind: 'air',
        cost: 1450, time: 21, hp: 340, armor: 'air', speed: 112, sight: 9, radius: 14,
        from: 'airpad', tech: 3, altitude: 34,
        weapon: { dmg: 96, type: 'explosive', range: 70, cd: 4.5, splash: 60, proj: 'bomb' },
        desc: '重载投弹，一次抹平一片步兵与建筑群。',
    }),
    hourglass: U({
        id: 'hourglass', name: '沙漏采集车', faction: 'BU', kind: 'harvester',
        cost: 520, time: 9, hp: 780, armor: 'heavy', speed: 48, sight: 6, radius: 14,
        from: 'foundry', tech: 0, cargo: 300, mineTime: HARVEST_TICK, crush: true,
        desc: '前往晶砂矿脉采集，送回淘洗站换取晶体。',
    }),
    rig: U({
        id: 'rig', name: '磐石基地车', faction: 'BU', kind: 'mcv',
        cost: 3000, time: 24, hp: 900, armor: 'heavy', speed: 36, sight: 8, radius: 15,
        from: 'foundry', tech: 1, mcv: true, crush: true,
        desc: '移动的指挥中枢。抵达新矿区后部署，建立前进基地。',
    }),

    /* ---------------- DUNE SYNDICATE ---------------- */
    sandfly: U({
        id: 'sandfly', name: '沙蝇兵', faction: 'DS', kind: 'infantry',
        cost: 105, time: 3.6, hp: 95, armor: 'light', speed: 42, sight: 6, radius: 7,
        from: 'tent', tech: 0,
        weapon: { dmg: 8, type: 'small', range: 108, cd: 0.6, proj: 'bullet' },
        desc: '便宜到可以当消耗品用的民兵，成群时非常难缠。',
    }),
    stinger: U({
        id: 'stinger', name: '刺针火箭兵', faction: 'DS', kind: 'infantry',
        cost: 280, time: 7, hp: 88, armor: 'light', speed: 37, sight: 7, radius: 7,
        from: 'tent', tech: 1,
        weapon: { dmg: 30, type: 'ap', range: 156, cd: 1.9, proj: 'rocket', antiAir: true },
        desc: '轻便的反装甲火力，也能对空射击。',
    }),
    wire: U({
        id: 'wire', name: '拆解师', faction: 'DS', kind: 'infantry',
        cost: 420, time: 6.5, hp: 85, armor: 'light', speed: 44, sight: 6, radius: 7,
        from: 'tent', tech: 0, engineer: true,
        desc: '擅长撬锁与接线，能把敌方建筑整套接管。',
    }),
    shade: U({
        id: 'shade', name: '沙影', faction: 'DS', kind: 'infantry',
        cost: 380, time: 7, hp: 85, armor: 'light', speed: 46, sight: 6, radius: 7,
        from: 'tent', tech: 2, cloak: true,
        weapon: { dmg: 20, type: 'small', range: 96, cd: 0.8, proj: 'bullet' },
        desc: '沙蜥的潜行刺客，靠斗篷贴近后排，开火后才会暴露。',
    }),
    dart: U({
        id: 'dart', name: '疾行悬浮摩托', faction: 'DS', kind: 'vehicle',
        cost: 400, time: 7, hp: 190, armor: 'light', speed: 86, sight: 10, radius: 9,
        from: 'workshop', tech: 1, hover: true,
        weapon: { dmg: 11, type: 'small', range: 122, cd: 0.5, proj: 'bullet' },
        desc: '最快的陆地单位，骚扰矿车与切后排的专业户。',
    }),
    lizard: U({
        id: 'lizard', name: '蜥蜴突击车', faction: 'DS', kind: 'vehicle',
        cost: 800, time: 13, hp: 480, armor: 'heavy', speed: 54, sight: 8, radius: 12,
        from: 'workshop', tech: 1, crush: true,
        weapon: { dmg: 40, type: 'ap', range: 152, cd: 1.5, proj: 'shell' },
        desc: '轻量化的突击平台，靠速度弥补装甲不足。',
    }),
    squall: U({
        id: 'squall', name: '沙暴火箭车', faction: 'DS', kind: 'vehicle',
        cost: 980, time: 16, hp: 300, armor: 'light', speed: 36, sight: 7, radius: 13,
        from: 'workshop', tech: 2,
        weapon: { dmg: 26, type: 'explosive', range: 340, cd: 3.2, splash: 58, proj: 'rocket', ballistic: true },
        desc: '多管齐射覆盖战场，对密集阵型极具威胁。',
    }),
    gnat: U({
        id: 'gnat', name: '蚊式侦察机', faction: 'DS', kind: 'air',
        cost: 620, time: 10, hp: 190, armor: 'air', speed: 104, sight: 11, radius: 11,
        from: 'strip', tech: 2, altitude: 26,
        weapon: { dmg: 16, type: 'small', range: 140, cd: 0.85, proj: 'bullet', antiAir: true },
        desc: '视野极佳的空中游击单位，也是最好的侦察手段。',
    }),
    shrike: U({
        id: 'shrike', name: '掠影攻击机', faction: 'DS', kind: 'air',
        cost: 1320, time: 19, hp: 290, armor: 'air', speed: 128, sight: 9, radius: 14,
        from: 'strip', tech: 3, altitude: 32,
        weapon: { dmg: 74, type: 'explosive', range: 66, cd: 3.8, splash: 48, proj: 'bomb' },
        desc: '低空突防的高速攻击机，打完就跑。',
    }),
    scav: U({
        id: 'scav', name: '拾荒采集车', faction: 'DS', kind: 'harvester',
        cost: 440, time: 7.5, hp: 640, armor: 'heavy', speed: 58, sight: 6, radius: 13,
        from: 'workshop', tech: 0, cargo: 260, mineTime: HARVEST_TICK * 0.9, crush: true,
        desc: '跑得更快的采集车，单趟收益略低但循环更快。',
    }),
    crawler: U({
        id: 'crawler', name: '迁徙基地车', faction: 'DS', kind: 'mcv',
        cost: 2800, time: 22, hp: 820, armor: 'heavy', speed: 42, sight: 8, radius: 14,
        from: 'workshop', tech: 1, mcv: true, crush: true,
        desc: '沙蜥的移动母巢。部署后在新据点展开整套指挥设施。',
    }),
};

/* ------------------------------------------------------------------ */
/* Building table                                                      */
/* ------------------------------------------------------------------ */
export const BUILDINGS: Record<string, BuildingDef> = {
    /* ---------------- BASTION UNION ---------------- */
    core: {
        id: 'core', name: '指挥核心', faction: 'BU', cost: 0, time: 0, hp: 3200, size: 4,
        sight: 9, power: 30, tech: 0, produces: ['hourglass'], isCore: true, factory: 'structure',
        desc: '磐岩联合的指挥中枢与建造中心。被摧毁即战败。',
    },
    furnace: {
        id: 'furnace', name: '熔炉电站', faction: 'BU', cost: 600, time: 11, hp: 820, size: 2,
        sight: 5, power: 70, tech: 0,
        desc: '为基地供能。断电会让生产停滞、雷达与超级武器离线。',
    },
    sluice: {
        id: 'sluice', name: '淘洗站', faction: 'BU', cost: 1750, time: 19, hp: 1050, size: 3,
        sight: 6, power: -12, tech: 0, dropoff: true,
        desc: '采集车卸货点，把晶砂淘洗成可用的晶体资源。',
    },
    barracks: {
        id: 'barracks', name: '兵营', faction: 'BU', cost: 500, time: 11, hp: 900, size: 2,
        sight: 6, power: -10, tech: 0, produces: ['pebble', 'breaker'], factory: 'infantry',
        desc: '训练步兵单位。',
    },
    foundry: {
        id: 'foundry', name: '战车库', faction: 'BU', cost: 1350, time: 20, hp: 1300, size: 3,
        sight: 6, power: -25, tech: 0, produces: ['anvil', 'rampart', 'mortar'], factory: 'vehicle',
        desc: '生产装甲车辆、采集车与基地车。',
    },
    airpad: {
        id: 'airpad', name: '塔台', faction: 'BU', cost: 1550, time: 21, hp: 1000, size: 3,
        sight: 7, power: -25, tech: 1, produces: ['warden', 'hammer'], factory: 'aircraft',
        desc: '起降空中单位。需要智库提供航电支持。',
    },
    turret: {
        id: 'turret', name: '棱堡炮塔', faction: 'BU', cost: 700, time: 13, hp: 950, size: 1,
        sight: 9, power: -15, tech: 1, detects: true,
        weapon: { dmg: 46, type: 'ap', range: 210, cd: 1.6, proj: 'shell', antiAir: true },
        desc: '固定防御炮塔，对地与对空兼备，同时能识破伪装。',
    },
    archive: {
        id: 'archive', name: '智库', faction: 'BU', cost: 1800, time: 24, hp: 1150, size: 3,
        sight: 8, power: -30, tech: 0, detects: true,
        desc: '解锁二级与三级科技（重炮、空军、高级装甲、超级武器）。',
    },
    orbital: {
        id: 'orbital', name: '天基阵列', faction: 'BU', cost: 2600, time: 26, hp: 1200, size: 3,
        sight: 6, power: -80, tech: 3, superWeapon: 'orbital',
        desc: '超级武器：轨道打击。充能完成后可对任意地点投射天基火力。',
    },
    aegis: {
        id: 'aegis', name: '力场锚', faction: 'BU', cost: 2000, time: 22, hp: 1000, size: 2,
        sight: 6, power: -55, tech: 3, superWeapon: 'aegis',
        desc: '超级武器：力场护盾。短时间内让范围内的己方单位免疫伤害。',
    },

    /* ---------------- DUNE SYNDICATE ---------------- */
    nest: {
        id: 'nest', name: '母巢', faction: 'DS', cost: 0, time: 0, hp: 2800, size: 4,
        sight: 9, power: 30, tech: 0, produces: ['scav'], isCore: true, factory: 'structure',
        desc: '沙蜥商团的指挥中枢与建造中心。被摧毁即战败。',
    },
    sunwell: {
        id: 'sunwell', name: '日光井', faction: 'DS', cost: 500, time: 9.5, hp: 700, size: 2,
        sight: 5, power: 65, tech: 0,
        desc: '廉价的太阳能阵列，供能效率略低但建造极快。',
    },
    market: {
        id: 'market', name: '黑市', faction: 'DS', cost: 1550, time: 17, hp: 930, size: 3,
        sight: 6, power: -12, tech: 0, dropoff: true,
        desc: '销赃与冶炼一体，采集车的卸货点。',
    },
    tent: {
        id: 'tent', name: '营帐', faction: 'DS', cost: 420, time: 9, hp: 820, size: 2,
        sight: 6, power: -10, tech: 0, produces: ['sandfly', 'stinger'], factory: 'infantry',
        desc: '训练民兵、火箭兵与拆解师。',
    },
    workshop: {
        id: 'workshop', name: '改装厂', faction: 'DS', cost: 1150, time: 18, hp: 1120, size: 3,
        sight: 6, power: -20, tech: 0, produces: ['dart', 'lizard', 'squall'], factory: 'vehicle',
        desc: '拼装各类沙海载具、采集车与基地车。',
    },
    strip: {
        id: 'strip', name: '起降坪', faction: 'DS', cost: 1450, time: 19, hp: 900, size: 3,
        sight: 7, power: -25, tech: 1, produces: ['gnat', 'shrike'], factory: 'aircraft',
        desc: '简易跑道，用于起降轻型飞行器。',
    },
    spike: {
        id: 'spike', name: '棘刺塔', faction: 'DS', cost: 600, time: 11, hp: 780, size: 1,
        sight: 9, power: -12, tech: 1, detects: true,
        weapon: { dmg: 22, type: 'small', range: 200, cd: 0.9, proj: 'bullet', antiAir: true },
        desc: '速射防御塔，反步兵与防空效率高，可识破伪装。',
    },
    vault: {
        id: 'vault', name: '密档室', faction: 'DS', cost: 1600, time: 22, hp: 1000, size: 3,
        sight: 8, power: -25, tech: 0, detects: true,
        desc: '解锁二级与三级科技（远程火力、空军、高级载具、超级武器）。',
    },
    storm: {
        id: 'storm', name: '风暴之眼', faction: 'DS', cost: 2500, time: 25, hp: 1150, size: 3,
        sight: 6, power: -80, tech: 3, superWeapon: 'sandstorm',
        desc: '超级武器：沙暴领域。在目标区域召唤持续风沙，持续杀伤并减速敌军。',
    },
    mirage: {
        id: 'mirage', name: '蜃楼塔', faction: 'DS', cost: 1900, time: 21, hp: 950, size: 2,
        sight: 6, power: -55, tech: 3, superWeapon: 'mirage',
        desc: '超级武器：蜃楼帷幕。短时间内让范围内己方部队全部隐身。',
    },
};

/* ------------------------------------------------------------------ */
/* Tech mapping: which building grants which tech level                */
/* ------------------------------------------------------------------ */
export const TECH_BUILDING: Record<Faction, string> = { BU: 'archive', DS: 'vault' };

/** build-order prerequisite chain (each entry needs the listed structure) */
export const BUILD_REQUIRES: Record<string, string> = {
    furnace: 'core', sluice: 'furnace', barracks: 'furnace', foundry: 'barracks',
    airpad: 'archive', turret: 'barracks', archive: 'foundry',
    orbital: 'archive', aegis: 'archive',
    sunwell: 'nest', market: 'sunwell', tent: 'sunwell', workshop: 'tent',
    strip: 'vault', spike: 'tent', vault: 'workshop',
    storm: 'vault', mirage: 'vault',
};

/* ------------------------------------------------------------------ */
/* Super weapon definitions                                            */
/* ------------------------------------------------------------------ */
export interface SuperWeaponDef {
    id: SuperWeaponId;
    name: string;
    short: string;
    faction: Faction;
    /** 'strike' hits a point, 'field' creates an area buff/debuff */
    kind: 'strike' | 'field';
    radius: number;
    charge: number;
    color: string;
    desc: string;
}

export const SUPER_WEAPONS: Record<SuperWeaponId, SuperWeaponDef> = {
    orbital: {
        id: 'orbital', name: '轨道打击', short: '轨道', faction: 'BU', kind: 'strike',
        radius: 118, charge: SW_CHARGE, color: PAL.cyan,
        desc: '1.4 秒后一束天基火力落下，对范围内所有目标造成巨额伤害。',
    },
    aegis: {
        id: 'aegis', name: '力场护盾', short: '力场', faction: 'BU', kind: 'field',
        radius: 150, charge: SW_CHARGE, color: PAL.amber,
        desc: '20 秒内范围内己方单位免疫一切伤害。',
    },
    sandstorm: {
        id: 'sandstorm', name: '沙暴领域', short: '沙暴', faction: 'DS', kind: 'field',
        radius: 160, charge: SW_CHARGE, color: PAL.violet,
        desc: '12 秒的风沙，持续杀伤并减速范围内的敌军。',
    },
    mirage: {
        id: 'mirage', name: '蜃楼帷幕', short: '蜃楼', faction: 'DS', kind: 'field',
        radius: 160, charge: SW_CHARGE, color: PAL.green,
        desc: '20 秒内范围内己方部队全部隐身，开火也不会暴露。',
    },
};

/* ------------------------------------------------------------------ */
/* Small math helpers                                                  */
/* ------------------------------------------------------------------ */
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist2 = (ax: number, ay: number, bx: number, by: number) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
};
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.sqrt(dist2(ax, ay, bx, by));

/** Deterministic small PRNG (mulberry32). */
export function makeRng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
};


/* ------------------------------------------------------------------ */
/* Physics traits derived from unit class                              */
/* ------------------------------------------------------------------ */
export const unitMass = (d: UnitDef) =>
    d.kind === 'infantry' ? 1 : d.kind === 'air' ? 3 : d.kind === 'harvester' ? 10
        : d.kind === 'mcv' ? 12 : d.armor === 'heavy' ? 8 : 5;

export const unitTurn = (d: UnitDef) =>
    d.kind === 'infantry' ? 10 : d.kind === 'air' ? 5 : d.kind === 'harvester' ? 3.4
        : d.kind === 'mcv' ? 3.0 : d.hover ? 7 : d.armor === 'heavy' ? 3.4 : 4.6;

export const unitAccel = (d: UnitDef) =>
    d.kind === 'infantry' ? 160 : d.kind === 'air' ? 90 : d.kind === 'harvester' ? 46
        : d.kind === 'mcv' ? 40 : d.hover ? 110 : 58;

/** does this unit run over enemy infantry? */
export const unitCrushes = (d: UnitDef) =>
    !!d.crush || d.kind === 'harvester' || d.kind === 'mcv' || (d.kind === 'vehicle' && d.armor === 'heavy');

/** projectile defaults per kind */
export const PROJ_PHYSICS: Record<ProjKind, { speed: number; ballistic: boolean; homing: boolean; turn: number; accel: number; gravity: number; radius: number; falloff: number }> = {
    bullet: { speed: 1050, ballistic: false, homing: false, turn: 0, accel: 0, gravity: 0, radius: 5, falloff: 0.25 },
    shell: { speed: 470, ballistic: true, homing: false, turn: 0, accel: 0, gravity: 520, radius: 9, falloff: 0.4 },
    rocket: { speed: 300, ballistic: false, homing: true, turn: 2.4, accel: 240, gravity: 0, radius: 9, falloff: 0.45 },
    bomb: { speed: 240, ballistic: true, homing: false, turn: 0, accel: 0, gravity: 620, radius: 14, falloff: 0.35 },
};


/* ------------------------------------------------------------------ */
/* Game speed                                                          */
/* ------------------------------------------------------------------ */
/**
 * Retail speed ladder. The simulation runs on ticks and 15 ticks/s is 1.0x, so
 * changing the slider changes construction, movement, rate of fire and every
 * animation at once (reference: redalert2/src/game/GameSpeed.ts:1-15).
 */
export const GAME_SPEED_MAX = 6;
export const GAME_SPEED_BASE_TICKS = 15;

export function gameSpeedTicks(speed: number): number {
    const s = Math.max(0, Math.min(GAME_SPEED_MAX, Math.floor(speed)));
    if (s === 6) return 60;
    if (s === 5) return 45;
    return 60 / (6 - s);
}

/** multiplier applied to simulation time; 1.0x at speed 2 */
export const gameSpeedMul = (speed: number) => gameSpeedTicks(speed) / GAME_SPEED_BASE_TICKS;
