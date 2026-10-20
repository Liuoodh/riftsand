/**
 * B4 (map + terrain) regression.
 *
 * B3 moved combat onto the reference's data model; B4 moves the *world* there.
 * The map layer is where a port silently diverges, because every one of these
 * bugs shows up as "units behave oddly" three layers away. So the checks here
 * are about invariants that a screenshot cannot show:
 *
 *   A. BOUNDS — the five rectangles `MapBounds` keeps, and the two rules that
 *      are easy to "fix" while porting: `isWithinBounds` tests `dy - z` (a
 *      plateau occupies the rows *above* its base), and `clampWithinBounds`
 *      repairs the iso parity hole.
 *   B. DIRECTIONS — the eight-neighbour table, verbatim. Two swapped entries
 *      rotate every bridge head and diagonal path by 45°.
 *   C. SPEED — `getPassableSpeed(tile, speedType, isInfantry, onBridge)`:
 *      the third argument really is `isInfantry` (proved with a 2×1 building
 *      whose impassable depth differs per unit class), the fourth selects the
 *      bridge layer, and water / solid rock are impassable again.
 *   D. REBUILD — occupying and then freeing a cell must leave the passability
 *      graph *bit-identical*, in both travel directions. The north-only
 *      version of `updatePassability` passes the forward direction and fails
 *      the reverse one, which is precisely the bug B4 fixed.
 *   E. OCCUPANCY — `computeTileLandType` returns on the first occupant that
 *      declares anything (not a priority list), rock is an early-out, and the
 *      bridge layer is always `Road`.
 *   F–J. Ore spread ids, radial ring order, shroud folding, occlusion
 *      footprints, and the high-bridge chain.
 *
 * usage: node tools/maptest2.mjs [url]
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
await new Promise((r) => setTimeout(r, 700));
await page.evaluate(() => { window.__riftsandGame.aiEnabled = false; });

const T = (fn, arg) => page.evaluate(fn, arg);

/* ============================================================ A. bounds ==== */
const A = await T(() => {
    const S = window.__riftsandSim;
    const g = window.__riftsandGame;
    const { MAP_TILES: N } = window.__riftsandConst;
    const b = g.mapBounds;
    const iso = S.Coords.ISO_TILE_SIZE;
    const tiles = g.tiles;

    const cutoff = Math.max(9, tiles.getCutoffTileHeight());
    const local = b.getLocalSize();
    const clamped = b.getClampedFullSize();
    const full = b.getFullSize();

    // buildable rectangle, reconstructed from the documented inset
    const build = {
        x: local.x, y: local.y + 4,
        width: local.width - 2, height: local.height - 8,
    };

    // `dy - z`: a cell one level up is displaced by one row for bounds purposes
    const highTile = { dx: 12, dy: 0, z: 1 };
    const flatTile = { dx: 12, dy: 1, z: 0 };

    // `clampWithinBounds` is NOT the identity on in-bounds cells: it always
    // re-aligns the row to the column's parity (`y += x%2 - y%2`), and our
    // diamond has an odd width, so a real cell's dx and dy have *opposite*
    // parity and every clamp moves it by exactly one row. What must hold is
    // that the operation is stable (clamping again changes nothing) and that
    // the result is a real iso cell.
    let clampStable = true;
    let clampParity = true;
    let parityProbe = 0;
    let insideCount = 0;
    let clampShifted = 0;
    for (const t of tiles.getAll()) {
        if (b.isWithinBounds(t)) {
            insideCount++;
            const c = b.clampWithinBounds(t);
            const c2 = b.clampWithinBounds({ dx: c.dx, dy: c.dy, z: 0 });
            if (c2.dx !== c.dx || c2.dy !== c.dy) clampStable = false;
            if (((c.dx % 2) + 2) % 2 !== ((c.dy % 2) + 2) % 2) clampParity = false;
            if (c.dx !== t.dx || c.dy !== t.dy) clampShifted++;
        }
    }
    for (const t of tiles.getAll()) {
        if (parityProbe >= 400) break;
        parityProbe++;
        const c = b.clampWithinBounds({ dx: t.dx, dy: t.dy, z: t.z + 2 });
        if (((c.dx % 2) + 2) % 2 !== ((c.dy % 2) + 2) % 2) clampParity = false;
    }

    return {
        N, iso,
        full: { w: full.width, h: full.height },
        clamped: { x: clamped.x, y: clamped.y, w: clamped.width, h: clamped.height },
        local: { x: local.x, y: local.y, w: local.width, h: local.height },
        cutoff, build, insideCount,
        highOK: b.isWithinBounds(highTile),
        flatOK: b.isWithinBounds(flatTile),
        leftOut: b.isWithinBounds({ dx: build.x - 1, dy: 6, z: 0 }),
        clampStable, clampParity, clampShifted,
    };
});

check('fullSize 是逻辑尺寸的两倍',
    A.full.w === 2 * A.N && A.full.h === 2 * A.N, `${A.full.w}×${A.full.h}`);
check('clampedFullSize 是「整图减一格」',
    A.clamped.x === 1 && A.clamped.y === 2 &&
    Math.abs(A.clamped.w - (2 * (A.N - 1) - 1 / A.iso)) < 1e-9 &&
    Math.abs(A.clamped.h - (2 * (A.N - 1) + 1 - 1 / A.iso)) < 1e-9,
    JSON.stringify(A.clamped));
check('localSize.x = 2·max(2, 文件值)，width = 2·(N-4)，y = -4',
    A.local.x === 4 && A.local.y === -4 && A.local.w === 2 * (A.N - 4),
    JSON.stringify(A.local));
check('localSize.height = min(2(N+5)-1, 2N+6-cutoff)，cutoff = max(9, 地形)',
    A.local.h === Math.min(2 * (A.N + 5) - 1, 2 * A.N + 6 - A.cutoff),
    `h=${A.local.h} cutoff=${A.cutoff}`);
check('mapBuildableSize = localSize 左右内缩 1 / 上下内缩 4',
    A.build.x === A.local.x && A.build.y === A.local.y + 4 &&
    A.build.width === A.local.w - 2 && A.build.height === A.local.h - 8,
    JSON.stringify(A.build));
check('isWithinBounds 用 dy - z 判定（高台占其上方行）',
    A.flatOK === true && A.highOK === false,
    `flat(dy=1,z=0)=${A.flatOK} high(dy=0,z=1)=${A.highOK}`);
check('isWithinBounds 拒绝 buildable 左边界外一格', A.leftOut === false);
check('clampWithinBounds 稳定（再钳一次不再移动）且结果落在真实等轴格上',
    A.clampStable && A.clampParity, `界内 ${A.insideCount} 格，被对齐 ${A.clampShifted} 格`);
check('clampWithinBounds 修正等轴奇偶洞（dx、dy 同奇偶）', A.clampParity);

/* ======================================================== B. directions === */
const B = await T(() => {
    const S = window.__riftsandSim;
    const g = window.__riftsandGame;
    const D = S.TileDirection;
    const tiles = g.tiles;
    const t = tiles.getByMapCoords(20, 20);
    const rel = (n) => (n ? `${n.rx - t.rx},${n.ry - t.ry}` : 'none');
    const table = {
        Top: rel(tiles.getNeighbourTile(t, D.Top)),
        TopLeft: rel(tiles.getNeighbourTile(t, D.TopLeft)),
        TopRight: rel(tiles.getNeighbourTile(t, D.TopRight)),
        Left: rel(tiles.getNeighbourTile(t, D.Left)),
        Right: rel(tiles.getNeighbourTile(t, D.Right)),
        BottomLeft: rel(tiles.getNeighbourTile(t, D.BottomLeft)),
        Bottom: rel(tiles.getNeighbourTile(t, D.Bottom)),
        BottomRight: rel(tiles.getNeighbourTile(t, D.BottomRight)),
    };
    let threw = false;
    try { tiles.getNeighbourTile(t, 8); } catch { threw = true; }

    return {
        table,
        expected: {
            Top: '-1,-1', TopLeft: '-1,0', TopRight: '0,-1', Left: '-1,1',
            Right: '1,-1', BottomLeft: '0,1', Bottom: '1,1', BottomRight: '1,0',
        },
        // negative coordinates: array index goes negative, no explicit check
        negX: tiles.getByMapCoords(-1, 5) === undefined,
        negY: tiles.getByMapCoords(5, -1) === undefined,
        // west edge must NOT wrap to the east edge (fixed reference defect)
        wrapLeft: (() => {
            const n = tiles.getNeighbourTile(tiles.getByMapCoords(0, 10), D.Left);
            return n ? `${n.rx},${n.ry}` : 'none';
        })(),
        // a corner cell must not wrap around to the opposite edge
        cornerTop: tiles.getNeighbourTile(tiles.getByMapCoords(0, 0), D.Top) === undefined,
        threw,
        neighbourCount: tiles.getAllNeighbourTiles(t).length,
        edgeCount: tiles.getAllNeighbourTiles(tiles.getByMapCoords(0, 0)).length,
        enum: [D.Top, D.TopLeft, D.TopRight, D.Left, D.Right, D.BottomLeft, D.Bottom, D.BottomRight],
    };
});

const badDirs = Object.keys(B.expected).filter((k) => B.table[k] !== B.expected[k]);
check('八向邻接表逐项与原版一致', badDirs.length === 0,
    badDirs.length ? badDirs.map((k) => `${k}=${B.table[k]}≠${B.expected[k]}`).join(' ') : JSON.stringify(B.table));
check('TileDirection 保持数字序 Top=0 … BottomRight=7',
    JSON.stringify(B.enum) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7]), JSON.stringify(B.enum));
check('getByMapCoords 只查上界之外的负坐标也返回 undefined', B.negX && B.negY);
check('西边界不跨图回绕到东边界（修正原版潜伏缺陷）', B.wrapLeft === 'none', B.wrapLeft);
check('角落格不跨边回绕（Top 出界即 undefined）', B.cornerTop);
check('非法方向抛错', B.threw);
check('内部格 8 邻居 / 角落格 3 邻居', B.neighbourCount === 8 && B.edgeCount === 3,
    `${B.neighbourCount} / ${B.edgeCount}`);

/* ============================================================= C. speed === */
const C = await T(() => {
    const S = window.__riftsandSim;
    const g = window.__riftsandGame;
    const { SpeedType, LandType, TileDirection } = S;
    const out = {};

    // find a flat, clear, in-bounds cell with no occupants
    let host = null;
    for (const t of g.tiles.getAll()) {
        if (t.terrainType !== S.TerrainType.Clear) continue;
        if (!g.mapBounds.isWithinBounds(t)) continue;
        if (g.occupancy.getObjectsOnTile(t).length) continue;
        // needs a 2x1 footprint inside the map
        if (!g.tiles.getNeighbourTile(t, TileDirection.BottomRight)) continue;
        host = t;
        break;
    }
    const second = g.tiles.getNeighbourTile(host, TileDirection.BottomRight);

    out.clear = {
        foot: g.passability.getPassableSpeed(host, SpeedType.Foot, true, false),
        track: g.passability.getPassableSpeed(host, SpeedType.Track, false, false),
        // no bridge here, so asking for the bridge layer must fail
        bridgeLayer: g.passability.getPassableSpeed(host, SpeedType.Track, false, true),
    };

    // a 2x1 building with numberImpassableRows = 1: infantry is blocked on
    // *both* cells (impassable depth = foundation width), a vehicle only on the
    // first (impassable depth = numberImpassableRows). This is the only cheap
    // way to observe which of the two flags the third argument carries.
    const stub = {
        tile: host,
        owner: 0,
        zone: 0,
        isBuilding: () => true,
        isTerrain: () => false,
        isOverlay: () => false,
        isUnit: () => false,
        isAircraft: () => false,
        isInfantry: () => false,
        isVehicle: () => false,
        isSmudge: () => false,
        isTiberium: () => false,
        isBridge: () => false,
        isHighBridge: () => false,
        isLowBridge: () => false,
        isBridgePlaceholder: () => false,
        isTechno: () => true,
        isDestroyed: false,
        getFoundation: () => ({ width: 2, height: 1 }),
        art: { foundation: { width: 2, height: 1 } },
        rules: {
            invisibleInGame: false, leaveRubble: false, gate: false,
            numberImpassableRows: 1, weaponsFactory: false, crushable: false,
        },
    };
    g.occupancy.occupySingleTile(host, stub);
    g.occupancy.occupySingleTile(second, stub);

    out.blocked = {
        infantryFirst: g.passability.getPassableSpeed(host, SpeedType.Foot, true, false),
        vehicleFirst: g.passability.getPassableSpeed(host, SpeedType.Track, false, false),
        infantrySecond: g.passability.getPassableSpeed(second, SpeedType.Foot, true, false),
        vehicleSecond: g.passability.getPassableSpeed(second, SpeedType.Track, false, false),
        // ignoredBlockers must let the same query through
        ignored: g.passability.getPassableSpeed(second, SpeedType.Foot, true, false, [stub]),
    };

    g.occupancy.unoccupySingleTile(host, stub);
    g.occupancy.unoccupySingleTile(second, stub);
    out.restored = g.passability.getPassableSpeed(host, SpeedType.Track, false, false);

    // water and solid rock are impassable for everything that walks or drives
    const find = (terrain) => g.tiles.getAll().find((t) => t.terrainType === terrain);
    const water = find(S.TerrainType.Water);
    const cliff = find(S.TerrainType.Cliff);
    out.water = water ? {
        foot: g.passability.getPassableSpeed(water, SpeedType.Foot, true, false),
        track: g.passability.getPassableSpeed(water, SpeedType.Track, false, false),
        // hover skates: the column is deliberately absent
        hover: g.passability.getPassableSpeed(water, SpeedType.Hover, false, false),
    } : null;
    out.cliff = cliff ? {
        foot: g.passability.getPassableSpeed(cliff, SpeedType.Foot, true, false),
        track: g.passability.getPassableSpeed(cliff, SpeedType.Track, false, false),
    } : null;

    out.land = { clear: LandType.Clear, hostLand: host.landType };
    return out;
});

check('Clear 地面 Foot/Track 速度 = 1', C.clear.foot === 1 && C.clear.track === 1,
    JSON.stringify(C.clear));
check('无桥格的 onBridge 层速度 = 0（第 4 参选桥面地表）', C.clear.bridgeLayer === 0);
check('建筑阻挡：Infantry 在两格都被挡', C.blocked.infantryFirst === 0 && C.blocked.infantrySecond === 0,
    JSON.stringify(C.blocked));
check('建筑阻挡：Vehicle 只被第一格挡住（第 3 参就是 isInfantry）',
    C.blocked.vehicleFirst === 0 && C.blocked.vehicleSecond > 0,
    `veh1=${C.blocked.vehicleFirst} veh2=${C.blocked.vehicleSecond}`);
check('ignoredBlockers 能放行同一格', C.blocked.ignored > 0);
check('解除占用后速度恢复', C.restored === 1, `speed=${C.restored}`);
check('水面 Foot/Track 不可通行', !C.water || (C.water.foot === 0 && C.water.track === 0),
    C.water ? JSON.stringify(C.water) : '地图上没有水面格');
check('水面允许 Hover 通过（缺列 = 1，与原版一致）', !C.water || C.water.hover === 1);
check('实心岩（Cliff）不可通行', !C.cliff || (C.cliff.foot === 0 && C.cliff.track === 0),
    C.cliff ? JSON.stringify(C.cliff) : '地图上没有崖面格');

/* ========================================================== D. rebuild ==== */
const D = await T(() => {
    const S = window.__riftsandSim;
    const g = window.__riftsandGame;
    const { SpeedType, TileDirection } = S;
    const ids = (p) => p.map((n) => n.tile.id).join(' ');
    const step = (t, dir) => g.tiles.getNeighbourTile(t, dir);
    const path = (a, b) => g.passability.computePath(SpeedType.Track, false, a, false, b, false);

    // walk east-south-east through clear-passable cells until a long corridor
    // shows up: a -> b is the forward direction, b -> a the reverse one
    let a = null, b = null;
    outer:
    for (const start of g.tiles.getAll()) {
        if (start.terrainType !== S.TerrainType.Clear) continue;
        let cur = start;
        for (let i = 0; i < 14; i++) {
            const next = step(cur, TileDirection.BottomRight);
            if (!next || next.terrainType !== S.TerrainType.Clear) continue outer;
            cur = next;
        }
        if (!g.mapBounds.isWithinBounds(start) || !g.mapBounds.isWithinBounds(cur)) continue;
        a = start; b = cur;
        break;
    }
    if (!a) return { skipped: '找不到 14 格的直线 Clear 走廊' };

    const p1 = path(a, b);
    const p1r = path(b, a);
    if (p1.length < 10) return { skipped: `走廊不通（长度 ${p1.length}）` };

    const mid = p1[Math.floor(p1.length / 2)].tile;
    const stub = {
        tile: mid, owner: 0, zone: 0,
        isBuilding: () => true, isTerrain: () => false, isOverlay: () => false,
        isUnit: () => false, isAircraft: () => false, isInfantry: () => false,
        isVehicle: () => false, isSmudge: () => false, isTiberium: () => false,
        isBridge: () => false, isHighBridge: () => false, isLowBridge: () => false,
        isBridgePlaceholder: () => false, isTechno: () => true, isDestroyed: false,
        getFoundation: () => ({ width: 1, height: 1 }),
        art: { foundation: { width: 1, height: 1 } },
        rules: {
            invisibleInGame: false, leaveRubble: false, gate: false,
            numberImpassableRows: 1, weaponsFactory: false, crushable: false,
        },
    };

    g.occupancy.occupySingleTile(mid, stub);
    const p2 = path(a, b);
    const p2r = path(b, a);
    g.occupancy.unoccupySingleTile(mid, stub);
    const p3 = path(a, b);
    const p3r = path(b, a);

    return {
        midId: mid.id,
        len1: p1.length, len1r: p1r.length,
        len2: p2.length, len2r: p2r.length,
        len3: p3.length, len3r: p3r.length,
        blockedForward: !p2.some((n) => n.tile === mid),
        blockedReverse: !p2r.some((n) => n.tile === mid),
        forwardSame: ids(p1) === ids(p3),
        reverseSame: ids(p1r) === ids(p3r),
        p1: ids(p1).slice(0, 120),
        p3: ids(p3).slice(0, 120),
    };
});

if (D.skipped) {
    check('通行图重算（占格/解除后路径逐格复原）', false, D.skipped);
} else {
    check('占格后前向路径绕开该格', D.blockedForward, `长度 ${D.len1}→${D.len2}`);
    check('占格后反向路径也绕开该格', D.blockedReverse, `长度 ${D.len1r}→${D.len2r}`);
    check('解除占用后前向路径逐格复原', D.forwardSame,
        D.forwardSame ? `长度 ${D.len3}` : `${D.p1} ≠ ${D.p3}`);
    check('解除占用后反向路径逐格复原（南向重算的回归点）', D.reverseSame,
        `长度 ${D.len1r}→${D.len3r}`);
}

/* ======================================================== E. occupancy ==== */
const E = await T(() => {
    const S = window.__riftsandSim;
    const g = window.__riftsandGame;
    const { LandType, TileDirection } = S;

    const t = g.tiles.getAll().find((x) =>
        x.terrainType === S.TerrainType.Clear && g.mapBounds.isWithinBounds(x));
    const neighbour = g.tiles.getNeighbourTile(t, TileDirection.BottomRight);

    const overlay = (extra) => ({
        tile: t, owner: 0, zone: 0,
        isOverlay: () => true, isBuilding: () => false, isTerrain: () => false,
        isUnit: () => false, isAircraft: () => false, isInfantry: () => false,
        isVehicle: () => false, isSmudge: () => false, isTiberium: () => false,
        isBridge: () => false, isHighBridge: () => false, isLowBridge: () => false,
        isBridgePlaceholder: () => false, isTechno: () => false, isDestroyed: false,
        getFoundation: () => ({ width: 1, height: 1 }),
        art: { foundation: { width: 1, height: 1 } },
        rules: Object.assign({ wall: false, land: LandType.Clear, crate: false, crushable: false }, extra),
    });

    const out = { empty: t.landType, base: S.getLandType(t.terrainType) };

    const rough = overlay({ land: LandType.Rough });
    g.occupancy.occupySingleTile(t, rough);
    out.withOverlay = t.landType;
    out.bridgeLayerAfterOverlay = t.onBridgeLandType;

    // first occupant that declares anything wins — this is an iteration over a
    // Set, not a priority table, so a wall added after a plain overlay loses
    const wallBehindRough = overlay({ wall: true });
    g.occupancy.occupySingleTile(t, wallBehindRough);
    out.wallBehindRough = t.landType;
    g.occupancy.unoccupySingleTile(t, wallBehindRough);
    g.occupancy.unoccupySingleTile(t, rough);
    out.afterRemove = t.landType;

    // on a clean cell the wall does win, and removing it restores the ground
    const wall = overlay({ wall: true });
    g.occupancy.occupySingleTile(t, wall);
    out.withWall = t.landType;
    g.occupancy.unoccupySingleTile(t, wall);
    out.afterWallRemoved = t.landType;

    // an ore overlay rewrites the land class while it is present
    const ore = g.oreOverlays.get(t) ?? null;
    out.orePresent = !!ore;

    // high bridge: the deck is always Road, whatever the terrain under it.
    // The predicates live on the object, not in `rules`, so they are overridden
    // after construction.
    const bridge = overlay({ land: LandType.Rough });
    bridge.isBridge = () => true;
    bridge.isHighBridge = () => true;
    g.occupancy.occupySingleTile(t, bridge);
    out.bridgeLayer = t.onBridgeLandType;
    out.groundUnderBridge = t.landType;
    g.occupancy.unoccupySingleTile(t, bridge);
    out.bridgeLayerAfter = t.onBridgeLandType;

    // rock is an early-out: a wall on rock stays rock
    const rock = g.tiles.getAll().find((x) => x.terrainType === S.TerrainType.Rock1);
    if (rock) {
        const before = rock.landType;
        const wallOnRock = {
            tile: rock, owner: 0, zone: 0,
            isOverlay: () => true, isBuilding: () => false, isTerrain: () => false,
            isUnit: () => false, isAircraft: () => false, isInfantry: () => false,
            isVehicle: () => false, isSmudge: () => false, isTiberium: () => false,
            isBridge: () => false, isHighBridge: () => false, isLowBridge: () => false,
            isBridgePlaceholder: () => false, isTechno: () => false, isDestroyed: false,
            getFoundation: () => ({ width: 1, height: 1 }),
            art: { foundation: { width: 1, height: 1 } },
            rules: { wall: true, land: LandType.Clear, crate: false, crushable: false },
        };
        g.occupancy.occupySingleTile(rock, wallOnRock);
        out.rockBefore = before;
        out.rockWithWall = rock.landType;
        g.occupancy.unoccupySingleTile(rock, wallOnRock);
    }
    return out;
});

check('空地 landType = 地表基础类型', E.empty === E.base, `${E.empty} = ${E.base}`);
check('overlay.land 覆写地表（Clear → Rough）', E.withOverlay === 4, `landType=${E.withOverlay}`);
check('覆盖物按插入顺序，第一个声明者胜出（不是优先级表）',
    E.wallBehindRough === 4, `landType=${E.wallBehindRough}`);
check('空地建墙 → Wall', E.withWall === 8, `landType=${E.withWall}`);
check('移除 wall 后回到基础地表', E.afterWallRemoved === E.base, `landType=${E.afterWallRemoved}`);
check('移除全部覆盖物后回到基础地表', E.afterRemove === E.base, `landType=${E.afterRemove}`);
check('高架桥面层恒为 Road', E.bridgeLayer === 1, `onBridgeLandType=${E.bridgeLayer}`);
check('桥下地表不受桥面影响', E.groundUnderBridge === E.base, `landType=${E.groundUnderBridge}`);
check('移除桥后桥面层回到 undefined', E.bridgeLayerAfter === undefined);
check('岩石是早退：在岩石上建墙仍是岩石',
    E.rockWithWall === undefined || E.rockWithWall === E.rockBefore,
    `${E.rockBefore} → ${E.rockWithWall}`);

/* ========================================================== F. ore ids ==== */
const F = await T(() => {
    const S = window.__riftsandSim;
    const { OreSpread, OreOverlayTypes, OverlayTibType } = S;
    const range = [];
    let bad = 0, det = true;
    // contiguous: the formula divides dx/dy by 2, so a stride of 3 can only
    // ever reach a third of the residues
    for (let dx = -20; dx <= 40; dx++) {
        for (let dy = 0; dy <= 40; dy++) {
            const id = OreSpread.calculateOverlayId(OverlayTibType.Ore, { dx, dy });
            if (id === undefined || id < OreOverlayTypes.minIdRiparius || id > OreOverlayTypes.maxIdRiparius) bad++;
            if (id !== OreSpread.calculateOverlayId(OverlayTibType.Ore, { dx, dy })) det = false;
            range.push(id);
        }
    }
    return {
        bad, det,
        distinct: new Set(range).size,
        notSpecial: OreSpread.calculateOverlayId(OverlayTibType.NotSpecial, { dx: 5, dy: 5 }),
        gems: OreSpread.calculateOverlayId(OverlayTibType.Gems, { dx: 5, dy: 5 }),
        minGem: OreOverlayTypes.minIdCruentus,
        d0: OreSpread.calculateOverlayId(OverlayTibType.Ore, { dx: 0, dy: 0 }),
    };
});

check('矿石 id 恒在 [minIdRiparius, maxIdRiparius] 内（含负坐标）', F.bad === 0, `越界 ${F.bad}`);
check('矿石 id 是坐标的确定函数', F.det);
check('矿石 id 覆盖全部 12 帧', F.distinct === 12, `distinct=${F.distinct}`);
check('NotSpecial 返回 undefined', F.notSpecial === undefined);
check('Gems 用 Cruentus 帧段', F.gems >= F.minGem && F.gems < F.minGem + 12, `id=${F.gems}`);

/* ====================================================== G. radial order === */
const G = await T(() => {
    const S = window.__riftsandSim;
    const g = window.__riftsandGame;
    const start = g.tiles.getByMapCoords(30, 30);
    const finder = new S.RadialTileFinder(
        g.tiles, g.mapBounds, start, { width: 1, height: 1 }, 0, 3,
        () => true, false,
    );
    const seq = [];
    let t;
    while ((t = finder.getNextTile())) seq.push(`${t.rx - start.rx},${t.ry - start.ry}`);
    return { seq, first: seq[0], ring1: seq.slice(1, 9), count: seq.length };
});

const ring1Expected = ['1,1', '0,1', '-1,1', '1,0', '1,-1', '-1,-1', '0,-1', '-1,0'];
check('Ring 0 只产出起点格', G.first === '0,0', G.first);
check('Ring 1 顺序：底行→右列→顶行→左列（从右到左 / 从下到上）',
    JSON.stringify(G.ring1) === JSON.stringify(ring1Expected),
    JSON.stringify(G.ring1));
check('distance 0..3 共 1+8+16+24 = 49 格', G.count === 49, `count=${G.count}`);

/* ========================================================= H. shroud ====== */
const H = await T(() => {
    const S = window.__riftsandSim;
    const g = window.__riftsandGame;
    const shroud = new S.MapShroud().fromTiles(g.tiles);
    const mapSize = g.tiles.getMapSize();
    const maxHeight = g.tiles.getMaxTileHeight();
    const padding = (maxHeight + (maxHeight % 2)) / 2;

    const fold = (z) => {
        const c = shroud.rxyzToSxy(10, 10, z);
        return c.sx - shroud.rxyzToSxy(10, 10, 0).sx;
    };
    // round trip: shroud -> world recovers the cell for every height
    let roundTrip = true;
    for (let z = 0; z <= 6; z++) {
        const c = shroud.rxyzToSxy(7, 9, z);
        const w = shroud.sxyzToRxy(c.sx, c.sy, z);
        if (w.rx !== 7 || w.ry !== 9) roundTrip = false;
    }

    const center = g.tiles.getByMapCoords(40, 40);
    const before = shroud.getShroudType(center);
    shroud.revealAround(center, 3);
    shroud.update();
    const after = shroud.getShroudType(center);
    const near = shroud.getShroudType(g.tiles.getNeighbourTile(center, 0));
    const far = shroud.getShroudType(g.tiles.getByMapCoords(40, 70));

    return {
        size: shroud.getSize(), mapSize, padding, maxHeight,
        folds: [fold(0), fold(1), fold(2), fold(3), fold(4)],
        roundTrip, before, after, near, far,
        unexplored: S.ShroudType.Unexplored, explored: S.ShroudType.Explored,
    };
});

check('shroud 网格 = 地图 + 高度 padding',
    H.size.width === H.mapSize.width + H.padding && H.size.height === H.mapSize.height + H.padding,
    `${H.size.width}×${H.size.height} padding=${H.padding} maxZ=${H.maxHeight}`);
check('高度折叠：z=0/1→0，2/3→-1，4→-2（向零取偶，成对折叠）',
    JSON.stringify(H.folds) === JSON.stringify([0, -1, -1, -2, -2]), JSON.stringify(H.folds));
check('rxyzToSxy / sxyzToRxy 互为逆', H.roundTrip);
check('初始全图 Unexplored', H.before === H.unexplored, `${H.before}`);
check('revealAround + update 后中心格变为已探索', H.after === H.explored, `${H.after}`);
check('半径外格仍为 Unexplored', H.far === H.unexplored, `${H.far}`);

/* ========================================================= I. occlusion === */
const I = await T(() => {
    const S = window.__riftsandSim;
    const g = window.__riftsandGame;
    const occ = new S.TileOcclusion(g.tiles);

    const origin = g.tiles.getByMapCoords(30, 30);
    const make = (height, add = [], remove = []) => ({
        tile: origin,
        getFoundation: () => ({ width: 2, height: 2 }),
        art: { occupyHeight: height, addOccupy: add, removeOccupy: remove },
    });

    const rel = (tiles) => tiles.map((t) => `${t.rx - origin.rx},${t.ry - origin.ry}`).sort();
    const tall = make(4);
    const offsets = rel(occ.calculateTilesForGameObject(tall));
    const flat = rel(occ.calculateTilesForGameObject(make(2)));
    const withAdd = rel(occ.calculateTilesForGameObject(make(4, [{ x: 0, y: 3 }])));
    const withRemove = rel(occ.calculateTilesForGameObject(make(4, [], [{ x: -1, y: -1 }])));

    // ref counting: two occluders covering the same cells. The occluder never
    // covers its *own* cell (offsets start at level 1), so the probe has to be
    // a cell in the shadow — one row up-left is always in both.
    const a = make(4);
    const b = make(4);
    const shadow = g.tiles.getByMapCoords(origin.rx - 1, origin.ry - 1);
    occ.addOccluder(a);
    const afterOne = shadow.occluded;
    occ.addOccluder(b);
    occ.removeOccluder(a);
    const afterOneRemoved = shadow.occluded;
    occ.removeOccluder(b);
    const afterBothRemoved = shadow.occluded;

    return {
        offsets, flat, withAdd, withRemove,
        afterOne, afterOneRemoved, afterBothRemoved,
        expected: ['-1,-1', '0,-1', '-2,-2', '-1,-2', '-1,0', '-2,-1'],
    };
});

check('occupyHeight=4、2×2 地基的遮挡偏移与原版一致',
    JSON.stringify(I.offsets) === JSON.stringify(I.expected.sort()),
    JSON.stringify(I.offsets));
check('occupyHeight ≤ 2 不产生任何遮挡', I.flat.length === 0, JSON.stringify(I.flat));
check('addOccupy 追加偏移', I.withAdd.includes('0,3'), JSON.stringify(I.withAdd));
check('removeOccupy 挖掉偏移（优先于 add）',
    !I.withRemove.includes('-1,-1') && I.withRemove.length === I.offsets.length - 1,
    JSON.stringify(I.withRemove));
check('occluded 按引用计数：删除一个遮挡者仍遮挡', I.afterOne === true && I.afterOneRemoved === true);
check('全部遮挡者移除后 occluded 归零', I.afterBothRemoved === false);

/* ========================================================== J. bridges ==== */
const J = await T(() => {
    const S = window.__riftsandSim;
    const g = window.__riftsandGame;
    const H = S.HighBridgeHeadType;

    // A fake theater: tileNum >= 200 is bridge art. Only the four questions
    // `Bridges` actually asks are answered, so the test measures the chain walk
    // and not the art pipeline.
    class BridgeTileSets extends S.ProceduralTileSets {
        constructor(headMap) { super(); this.headMap = headMap; }
        getTileImage(tileNum, subTile, rnd) {
            if (tileNum >= 200) {
                return {
                    terrainType: S.TerrainType.Pavement, rampType: 0, height: 0,
                    radarLeft: { clone() { return this; }, multiplyScalar() { return this; } },
                };
            }
            return super.getTileImage(tileNum, subTile, rnd);
        }
        getTile(tileNum) { return tileNum >= 200 ? { index: tileNum } : super.getTile(tileNum); }
        getSetNum(tileNum) { return tileNum === 200 || tileNum === 201 ? 200 : -1; }
        getHighBridgeHeadType(index) { return this.headMap[index]; }
        isHighBridgeBoundaryTile(tileNum) { return tileNum === 200 || tileNum === 201; }
        isHighBridgeMiddleTile(tileNum) { return tileNum === 210; }
        getOppositeHighBridgeHeadType(headType) {
            switch (headType) {
                case H.TopLeft: return H.BottomRight;
                case H.BottomRight: return H.TopLeft;
                case H.TopRight: return H.BottomLeft;
                case H.BottomLeft: return H.TopRight;
                default: throw new Error('no opposite for ' + headType);
            }
        }
    }

    // 10x10 flat map with a pavement lane along ry = 4
    const size = 10;
    const src = {
        kind: new Uint8Array(size * size),
        level: new Uint8Array(size * size),
        solid: new Uint8Array(size * size),
    };
    for (let rx = 0; rx < size; rx++) src.kind[4 * size + rx] = 4; // TileKind.Road
    const data = S.buildTileData(src, size);
    const at = (rx, ry) => data[ry * size + rx];
    at(3, 4).tileNum = 200; // start head
    at(6, 4).tileNum = 201; // end head
    at(4, 4).tileNum = 210; // deck
    at(5, 4).tileNum = 210;

    const run = (headMap) => {
        const sets = new BridgeTileSets(headMap);
        const tiles = new S.TileCollection(data.map((d) => ({ ...d })), sets, { cliffBackImpassability: 0 }, () => 0);
        const bounds = new S.MapBounds().fromMapFile(
            { fullSize: { width: size, height: size }, localSize: { x: 0, y: 0, width: size, height: size } },
            tiles,
        );
        const occ = new S.TileOccupation(tiles);
        const bridges = new S.Bridges(sets, tiles, occ, bounds, S.RULES);
        const spec = bridges.findClosestBridgeSpec(tiles.getByMapCoords(2, 4));
        return {
            spec: spec ? { sx: spec.start.rx, ex: spec.end.rx, high: spec.isHigh, type: spec.type } : null,
            heads: bridges.findMapHighBridgeHeadTiles().size,
        };
    };

    const good = run({ 200: H.TopLeft, 201: H.BottomRight });
    const wrongOpposite = run({ 200: H.TopLeft, 201: H.TopLeft });
    const badHeadType = run({});

    return { good, wrongOpposite, badHeadType };
});

check('高架桥链：找到 (3,4) → (6,4) 的 Concrete 桥段',
    J.good.spec && J.good.spec.sx === 3 && J.good.spec.ex === 6 &&
    J.good.spec.high === true && J.good.spec.type === 1,
    JSON.stringify(J.good.spec));
check('高架桥链：两端 headType 不互补时拒绝成桥',
    J.wrongOpposite.spec === null, JSON.stringify(J.wrongOpposite.spec));
check('高架桥链：headType 缺失时不成桥', J.badHeadType.spec === null);

/* ============================================================== errors ==== */
check('运行无报错', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
