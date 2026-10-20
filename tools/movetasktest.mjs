/**
 * B6b (movement subsystem) regression.
 *
 * B6b ports the reference's `MoveTrait` + the whole `task/move/` family + the two
 * aircraft locomotors. Almost none of it can be seen in a screenshot, and the
 * parts that *can* be seen (units stopping, queueing, sliding) show up only
 * after minutes of play. So the checks here are about the contracts:
 *
 *   A. MOVE TASK LIFECYCLE — the four-state machine, waypoint popping, and that
 *      `preventOpportunityFire` is false (the reference's one opt-out).
 *   B. CANCEL — `forceCancel` snapshots the velocity and leaves `lastMoveResult`
 *      as Cancel; `onEnd` clears the waypoint.
 *   C. CAN STOP AT TILE — three men per cell, never two on the same sub-cell,
 *      and a big unit refuses to sit under a high bridge.
 *   D. BASE SPEED — veteran, crate, half-health (except hover) and penalty
 *      multipliers, in that order.
 *   E. WATCHDOG — a unit still in `Moving` with no move task behind it is
 *      dropped to `Idle` and its velocity zeroed.
 *   F. TILE CHANGE — crush sets `InfDeathType.None` + `DeathType.Crush`,
 *      teleporting spares friendlies, a wall rocks the hull, and the bridge
 *      elevation delta is applied (not assigned).
 *   G. MOVE ASIDE — the 45° scan order (0° second pass only, 180° never) and the
 *      40-tick timeout.
 *   H. JUMPJET — the parked state machine climbs one step per tick and only
 *      lands once the height already matches.
 *   I. WINGED — parked aircraft face 270°, docked ones 0°.
 *   J. DOCKING — a free dock is reserved in `onStart`; `onEnd` releases it unless
 *      the unit actually docked.
 *   K. SCATTER — aircraft are exempt; ground units get a MoveTask child.
 *
 * usage: node tools/movetasktest.mjs [url]
 */
import { createRequire } from 'node:module';

const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html?auto=1';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0;
let fail = 0;
const check = (name, ok, note = '') => {
    if (ok) {
        pass++;
        console.log(`PASS  ${name}${note ? '  · ' + note : ''}`);
    } else {
        fail++;
        console.log(`FAIL  ${name}${note ? '  · ' + note : ''}`);
    }
};

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__riftsandGame != null', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
    window.__riftsandGame.aiEnabled = false;
});

const evalPage = (fn, ...args) => page.evaluate(fn, ...args);

/*
 * Shared stub kit, injected once. Everything lives on `window.__mt` so each
 * `evaluate` below stays short.
 */
await evalPage(() => {
    const S = window.__riftsandSim;
    const LPT = S.Coords.LEPTONS_PER_TILE;

    function makeTiles(w = 10, h = 10) {
        const list = [];
        const byKey = new Map();
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const tile = {
                    rx: x,
                    ry: y,
                    z: 0,
                    landType: S.LandType.Clear,
                    onBridgeLandType: undefined,
                    terrainType: 0,
                    rampType: 0,
                    id: `${x},${y}`,
                    occluded: false,
                    isHighBridge: () => false,
                };
                list.push(tile);
                byKey.set(`${x},${y}`, tile);
            }
        }
        return {
            list,
            getByMapCoords: (x, y) => byKey.get(`${x},${y}`),
            getPlaceholderTile: (x, y) => ({ ...list[0], rx: x, ry: y }),
        };
    }

    /** game whose terrain always returns the supplied path */
    function makeGame(tiles, opts = {}) {
        const tileOccupation = {
            occupied: [],
            getBridgeOnTile: () => undefined,
            getGroundObjectsOnTile: () => opts.groundObjects || [],
            getAirObjectsOnTile: () => [],
            getObjectsOnTile: () => opts.groundObjects || [],
            isTileOccupiedBy: () => false,
            occupySingleTile: (tile, obj) => tileOccupation.occupied.push({ tile, obj }),
            unoccupySingleTile: () => {},
            unoccupyTileRange: () => {},
            occupyTileRange: () => {},
            calculateTilesForGameObject: () => [],
        };
        return {
            map: {
                tiles,
                mapBounds: {
                    isWithinBounds: (tile) => !!tile && tile.rx >= 0 && tile.ry >= 0 && tile.rx < 10 && tile.ry < 10,
                },
                isWithinBounds: (tile) => !!tile && tile.rx >= 0 && tile.ry >= 0 && tile.rx < 10 && tile.ry < 10,
                clampWithinBounds: (tile) => tile,
                getTileZone: () => S.ZoneType.Ground,
                tileOccupation,
                getObjectsOnTile: () => opts.groundObjects || [],
                getGroundObjectsOnTile: () => opts.groundObjects || [],
                getTheaterType: () => 0,
                terrain: {
                    path: opts.path || [],
                    computePath: () => (opts.path || []).slice(),
                    getPassableSpeed: () => (opts.impassable ? 0 : 1),
                    findObstacles: () => opts.obstacles || [],
                    getIslandIdMap: () => ({ get: () => 0 }),
                },
            },
            alliances: { haveSharedIntel: () => true },
            rules: {
                general: { flightLevel: 0 },
                getLandRules: () => ({ getSpeedModifier: () => 1 }),
            },
            events: { dispatched: [], dispatch(e) { this.dispatched.push(e); } },
            traits: [],
            crateGeneratorTrait: {
                peekInsideCrate: () => -1,
                pickupCrate: () => {},
            },
            currentTick: 0,
            areFriendly: (a, b) => a.owner === b.owner,
            generateRandomInt: (min) => min,
            destroyObject(obj) { obj.isDestroyed = true; },
        };
    }

    function makeUnit(tile, over = {}) {
        return {
            id: 1,
            owner: 'P',
            tile,
            zone: S.ZoneType.Ground,
            onBridge: false,
            direction: 0,
            tileElevation: 0,
            isDestroyed: false,
            isSpawned: true,
            rules: {
                speed: 20,
                speedType: S.SpeedType.Track,
                movementZone: S.MovementZone.Ground,
                locomotor: S.LocomotorType.Vehicle,
                tooBigToFitUnderBridge: false,
                crushable: false,
                spawned: false,
                dock: [],
                rot: 5,
                pitchAngle: 3,
                landable: false,
                balloonHover: false,
                hoverAttack: false,
            },
            position: {
                subCell: 0,
                desiredSubCell: 0,
                tileElevation: 0,
                worldPosition: new S.Vector3(0, 0, 0),
                getMapPosition: () => new S.Vector2(tile.rx * LPT, tile.ry * LPT),
                getTileOffset: () => new S.Vector2(0, 0),
                computeSubCellOffset: () => new S.Vector2(0, 0),
                moveByLeptons: () => {},
                moveByLeptons3: () => {},
                moveByLeptons2: () => {},
            },
            moveTrait: {
                velocity: new S.Vector3(),
                currentWaypoint: undefined,
                moveState: S.MoveState.Idle,
                collisionState: S.CollisionState.Resolved,
                locomotor: undefined,
                reservedPathNodes: [],
                lastTargetOffset: undefined,
                lastVelocity: undefined,
                lastMoveResult: undefined,
                unreservePathNodes() { this.reservedPathNodes.length = 0; },
                isDisabled: () => false,
                handleTileChange: () => {},
                handleElevationChange: () => {},
                isIdle() { return this.moveState === S.MoveState.Idle; },
            },
            attackTrait: undefined,
            unitOrderTrait: {
                tasks: [],
                getCurrentTask() { return this.tasks[0]; },
                hasTasks() { return this.tasks.length > 0; },
                addTask(t) { this.tasks.push(t); },
            },
            traits: new S.Traits(),
            isInfantry: () => false,
            isVehicle: () => true,
            isAircraft: () => false,
            isUnit: () => true,
            isBuilding: () => false,
            isTechno: () => true,
            isTerrain: () => false,
            isOverlay: () => false,
            ...over,
        };
    }

    window.__mt = { S, LPT, makeTiles, makeGame, makeUnit };
});

/* ============================================ A. MoveTask lifecycle ========= */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit, LPT } = window.__mt;
        const tiles = makeTiles();
        const goal = tiles.getByMapCoords(4, 0);
        const mid = tiles.getByMapCoords(2, 0);
        const start = tiles.getByMapCoords(0, 0);
        const game = makeGame(tiles, { path: [{ tile: goal }, { tile: mid }, { tile: start }] });
        const unit = makeUnit(start);

        let onNewWaypointArgs = null;
        let pendingDone = false;
        const locomotor = {
            ticks: 0,
            selectNextWaypoint: (u, path) => path[path.length - 1],
            onNewWaypoint: (u, target, dest) => {
                onNewWaypointArgs = { target: { x: target.x, y: target.y }, dest: { x: dest.x, y: dest.y } };
                return undefined;
            },
            tick: () => {
                locomotor.ticks++;
                const done = pendingDone;
                pendingDone = false;
                return { distance: new S.Vector3(), done };
            },
        };
        unit.moveTrait.locomotor = locomotor;

        const task = new S.MoveTask(game, goal, false);
        task.status = S.TaskStatus.Running;
        task.onStart(unit);

        const afterStart = {
            state: unit.moveTrait.moveState,
            pathLen: task.path ? task.path.length : -1,
            destX: task.destinationLeptons.x,
            destY: task.destinationLeptons.y,
            preventOpportunityFire: task.preventOpportunityFire,
        };

        /* tick 1: drops the cell we are standing on, plans, starts driving */
        const firstTick = task.onTick(unit);
        const step1 = {
            state: unit.moveTrait.moveState,
            waypointTile: unit.moveTrait.currentWaypoint ? unit.moveTrait.currentWaypoint.tile.id : null,
            pathLen: task.path.length,
            onNewWaypointArgs,
        };

        /* tick 2: "arrived at the waypoint" once */
        pendingDone = true;
        const secondTick = task.onTick(unit);
        const step2 = {
            state: unit.moveTrait.moveState,
            waypointTile: unit.moveTrait.currentWaypoint ? unit.moveTrait.currentWaypoint.tile.id : null,
            pathLen: task.path.length,
        };

        /* tick 3: arrive at the goal */
        pendingDone = true;
        const thirdTick = task.onTick(unit);

        return {
            afterStart,
            firstTick,
            step1,
            secondTick,
            step2,
            thirdTick,
            finalResult: unit.moveTrait.lastMoveResult,
            locoTicks: locomotor.ticks,
            pathLenFinal: task.path.length,
            expectedDestX: goal.rx * LPT,
            expectedDestY: goal.ry * LPT,
        };
    });

    check('A1 onStart 之后进入 ReachedNextWaypoint', r.afterStart.state === 1, `state=${r.afterStart.state}`);
    check('A2 onStart 时路径已算好（3 节点）', r.afterStart.pathLen === 3, `len=${r.afterStart.pathLen}`);
    check(
        'A3 destinationLeptons 指向 path[0]（终点，不是起点）',
        r.afterStart.destX === r.expectedDestX && r.afterStart.destY === r.expectedDestY,
        `${r.afterStart.destX},${r.afterStart.destY}`,
    );
    check('A4 preventOpportunityFire = false（MoveTask 唯一主动放开顺带开火）', r.afterStart.preventOpportunityFire === false);
    check('A5 首帧先丢掉「脚下的格」，再进入 Moving', r.step1.state === 3, `state=${r.step1.state}`);
    check('A6 首帧路点 = 路径倒数第一（最近的下一格）', r.step1.waypointTile === '2,0', String(r.step1.waypointTile));
    check('A7 首帧后路径剩 2 个节点', r.step1.pathLen === 2, `len=${r.step1.pathLen}`);
    check(
        'A8 onNewWaypoint 收到路点坐标（格 × LPT）',
        r.step1.onNewWaypointArgs && r.step1.onNewWaypointArgs.target.x === 2 * 256,
        JSON.stringify(r.step1.onNewWaypointArgs),
    );
    check(
        'A9 到达路点后路点前进到终点',
        r.step2.waypointTile === '4,0' && r.step2.pathLen === 1,
        `${r.step2.waypointTile} len=${r.step2.pathLen}`,
    );
    check('A10 到达终点返回 true', r.thirdTick === true);
    check('A11 lastMoveResult = Success(0)', r.finalResult === 0, `result=${r.finalResult}`);
    check('A12 路径被清空', r.pathLenFinal === 0, `len=${r.pathLenFinal}`);
    check('A13 locomotor.tick 每帧都被调用（含递归重入共 4 次）', r.locoTicks === 4, `ticks=${r.locoTicks}`);
}

/* ================================================== B. cancel ============== */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit } = window.__mt;
        const tiles = makeTiles();
        const goal = tiles.getByMapCoords(4, 0);
        const start = tiles.getByMapCoords(0, 0);
        const game = makeGame(tiles, { path: [{ tile: goal }, { tile: start }] });
        const unit = makeUnit(start);
        unit.moveTrait.locomotor = {
            selectNextWaypoint: (u, p) => p[p.length - 1],
            onNewWaypoint: () => undefined,
            tick: () => ({ distance: new S.Vector3(), done: false }),
        };

        const task = new S.MoveTask(game, goal, false);
        task.status = S.TaskStatus.Running;
        task.onStart(unit);
        task.onTick(unit);
        unit.moveTrait.velocity.set(3, 0, 4);

        const ok = task.forceCancel(unit);
        return {
            ok,
            status: task.status,
            result: unit.moveTrait.lastMoveResult,
            waypoint: unit.moveTrait.currentWaypoint,
            lastVelocity: unit.moveTrait.lastVelocity ? unit.moveTrait.lastVelocity.length() : -1,
            lastTargetOffset: unit.moveTrait.lastTargetOffset,
        };
    });

    check('B1 forceCancel 返回 true', r.ok === true);
    check('B2 状态直接置为 Cancelled(4)', r.status === 4, `status=${r.status}`);
    check('B3 lastMoveResult = Cancel(1)', r.result === 1, `result=${r.result}`);
    check('B4 onEnd 清掉 currentWaypoint', r.waypoint === undefined);
    check('B5 速度被快照下来（3-4-5 → 5）', Math.abs(r.lastVelocity - 5) < 1e-6, `len=${r.lastVelocity}`);
    check('B6 lastTargetOffset 被写回（供下一段移动续接）', r.lastTargetOffset !== undefined);
}

/* ======================================= C. canStopAtTile (infantry) ======= */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit } = window.__mt;
        const tiles = makeTiles();
        const tile = tiles.getByMapCoords(0, 0);
        const mk = (subCell) => ({
            isInfantry: () => true,
            isUnit: () => true,
            tile,
            onBridge: false,
            position: { subCell },
            moveTrait: { moveState: S.MoveState.Idle },
        });

        const run = (others, mySubCell) => {
            const game = makeGame(tiles, { groundObjects: others });
            const unit = makeUnit(tile, {
                isInfantry: () => true,
                isVehicle: () => false,
                position: { subCell: mySubCell, desiredSubCell: mySubCell, getTileOffset: () => new S.Vector2() },
            });
            const task = new S.MoveTask(game, tile, false);
            return task.canStopAtTile(unit, tile, false);
        };

        return {
            empty: run([], 2),
            two: run([mk(4), mk(3)], 2),
            three: run([mk(4), mk(3), mk(2)], 2),
            sameSubCell: run([mk(2)], 2),
            differentSubCell: run([mk(4)], 2),
        };
    });

    check('C1 空格可停', r.empty === true);
    check('C2 格内已有 2 人仍可停（上限 3）', r.two === true);
    check('C3 格内已有 3 人不可停', r.three === false);
    check('C4 同一 subCell 已被占 → 不可停', r.sameSubCell === false);
    check('C5 不同 subCell → 可停', r.differentSubCell === true);
}

/* ================================================= D. baseSpeed ============ */
{
    const r = await evalPage(() => {
        const { S } = window.__mt;
        const make = (over = {}) => {
            const obj = {
                rules: { speed: 20, locomotor: S.LocomotorType.Vehicle },
                isVehicle: () => true,
                veteranTrait: undefined,
                crateBonuses: { speed: 1 },
                healthTrait: { health: 100 },
                ...over,
            };
            return new S.GameObjectMoveTrait(obj, {}).baseSpeed;
        };
        return {
            base: make(),
            veteran: make({ veteranTrait: { getVeteranSpeedMultiplier: () => 1.25 } }),
            crate: make({ crateBonuses: { speed: 1.5 } }),
            damaged: make({ healthTrait: { health: 50 } }),
            damagedHover: make({ healthTrait: { health: 50 }, rules: { speed: 20, locomotor: S.LocomotorType.Hover } }),
            infantryDamaged: make({ isVehicle: () => false, healthTrait: { health: 10 } }),
        };
    });

    check('D1 基准速度 = rules.speed', r.base === 20, `${r.base}`);
    check('D2 老兵 ×1.25', Math.abs(r.veteran - 25) < 1e-6, `${r.veteran}`);
    check('D3 箱子 ×1.5', Math.abs(r.crate - 30) < 1e-6, `${r.crate}`);
    check('D4 载具半血 ×0.75', Math.abs(r.damaged - 15) < 1e-6, `${r.damaged}`);
    check('D5 悬浮载具半血不减速', Math.abs(r.damagedHover - 20) < 1e-6, `${r.damagedHover}`);
    check('D6 步兵半血不减速', Math.abs(r.infantryDamaged - 20) < 1e-6, `${r.infantryDamaged}`);
}

/* ================================================= E. watchdog ============ */
{
    const r = await evalPage(() => {
        const { S } = window.__mt;
        const obj = {
            rules: { speed: 10, locomotor: S.LocomotorType.Vehicle },
            isVehicle: () => true,
            veteranTrait: undefined,
            crateBonuses: { speed: 1 },
            healthTrait: { health: 100 },
            direction: 90,
            turretTrait: { desiredFacing: 0 },
            attackTrait: undefined,
            unitOrderTrait: { getCurrentTask: () => undefined },
            isAircraft: () => false,
        };
        const trait = new S.GameObjectMoveTrait(obj, {});
        trait.moveState = S.MoveState.Moving;
        trait.velocity.set(5, 0, 0);
        trait[Symbol.for('x')] = 0; // no-op, keeps shape stable
        trait[S.NotifyTick.onTick](obj, { map: {}, rules: {}, traits: [], events: { dispatch() {} } });

        const withTask = {
            ...obj,
            unitOrderTrait: {
                getCurrentTask: () => {
                    const t = new S.Task();
                    t.children = [new S.MoveTask({}, {}, false)];
                    return t;
                },
            },
        };
        const trait2 = new S.GameObjectMoveTrait(withTask, {});
        trait2.moveState = S.MoveState.Moving;
        trait2.velocity.set(5, 0, 0);
        trait2[S.NotifyTick.onTick](withTask, { map: {}, rules: {}, traits: [], events: { dispatch() {} } });

        return {
            idleState: trait.moveState,
            speed: trait.velocity.length(),
            locomotor: trait.locomotor,
            turret: obj.turretTrait.desiredFacing,
            nestedState: trait2.moveState,
            nestedSpeed: trait2.velocity.length(),
        };
    });

    check('E1 没有 MoveTask 时状态回落到 Idle(0)', r.idleState === 0, `state=${r.idleState}`);
    check('E2 并清空速度', r.speed === 0, `len=${r.speed}`);
    check('E3 并释放 locomotor', r.locomotor === undefined);
    check('E4 炮塔归位到车体朝向', r.turret === 90, `facing=${r.turret}`);
    check('E5 嵌套在子任务里的 MoveTask 仍算「在移动」', r.nestedState === 3, `state=${r.nestedState}`);
    check('E6 因此速度不被清空', r.nestedSpeed > 0, `len=${r.nestedSpeed}`);
}

/* ============================================== F. handleTileChange ======== */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeUnit } = window.__mt;
        const tiles = makeTiles();
        const from = tiles.getByMapCoords(0, 0);
        const to = tiles.getByMapCoords(1, 0);

        const events = [];
        const game = {
            currentTick: 7,
            map: {
                tileOccupation: {
                    unoccupyTileRange: () => {},
                    occupyTileRange: () => {},
                    getBridgeOnTile: () => undefined,
                    getGroundObjectsOnTile: () => [],
                },
                technosByTile: { updateObject: () => {} },
                getGroundObjectsOnTile: () => [],
                getObjectsOnTile: () => [],
            },
            rules: { getLandRules: () => ({ getSpeedModifier: () => 1 }) },
            events: { dispatch: (e) => events.push(e.constructor.name) },
            traits: new S.Traits(),
            areFriendly: (a, b) => a.owner === b.owner,
            destroyObject: (obj) => {
                obj.isDestroyed = true;
                obj.destroyed = true;
            },
        };

        const mkCrushable = (owner, kind) => ({
            owner,
            onBridge: false,
            isDestroyed: false,
            rules: { crushable: true, wall: kind === 'wall' },
            stance: 0,
            kind,
            isUnit: () => kind === 'unit',
            isInfantry: () => kind === 'infantry',
            isOverlay: () => kind === 'wall',
            isTechno: () => kind !== 'wall',
            position: {},
        });

        const crushed = [];
        const rockings = [];
        game.destroyObject = (obj) => {
            obj.isDestroyed = true;
            crushed.push(obj.kind);
        };
        game.map.getGroundObjectsOnTile = () => crushed_objects;

        let crushed_objects = [];
        const run = (targets, opts = {}) => {
            crushed.length = 0;
            rockings.length = 0;
            crushed_objects = targets;

            const unit = makeUnit(from, {
                owner: 'P',
                crusher: opts.crusher !== false,
                onBridge: false,
                zone: S.ZoneType.Ground,
                applyRocking: (x, y) => rockings.push([x, y]),
                position: { tileElevation: 0, tile: to, subCell: 0, desiredSubCell: 0 },
            });
            const trait = new S.GameObjectMoveTrait(unit, { unoccupySingleTile: () => {} });
            unit.moveTrait = trait;
            trait.handleTileChange(from, undefined, opts.teleporting === true, game, opts.isTeleport === true);
            return { crushed: crushed.slice(), rocking: rockings.slice() };
        };

        const enemyInf = () => mkCrushable('E', 'infantry');
        const friendlyUnit = () => mkCrushable('P', 'unit');
        const wall = () => mkCrushable('E', 'wall');

        const normalEnemy = run([enemyInf()]);
        const normalFriendly = run([friendlyUnit()]);
        const teleportFriendly = run([friendlyUnit()], { teleporting: true });
        const teleportEnemy = run([enemyInf()], { teleporting: true });
        const wallHit = run([wall()]);
        const noCrusher = run([enemyInf()], { crusher: false });

        return {
            normalEnemy: normalEnemy.crushed,
            normalFriendly: normalFriendly.crushed,
            teleportFriendly: teleportFriendly.crushed,
            teleportEnemy: teleportEnemy.crushed,
            wallHit: wallHit.crushed,
            wallRockings: wallHit.rocking,
            noCrusher: noCrusher.crushed,
            events: events.slice(),
        };
    });

    check('F1 碾压敌人', r.normalEnemy.join() === 'infantry', r.normalEnemy.join());
    check('F2 正常行驶不碾友军', r.normalFriendly.length === 0, r.normalFriendly.join());
    check('F3 传送落地会碾掉脚下的友军（占领该格）', r.teleportFriendly.join() === 'unit', r.teleportFriendly.join());
    check('F4 传送时仍碾敌人', r.teleportEnemy.join() === 'infantry', r.teleportEnemy.join());
    check('F5 碾压墙', r.wallHit.join() === 'wall', r.wallHit.join());
    check(
        'F6 撞墙时车体摇晃 (0, 0.5)',
        r.wallRockings.length === 1 && r.wallRockings[0][1] === 0.5,
        JSON.stringify(r.wallRockings),
    );
    check('F7 没有 crusher 就不碾', r.noCrusher.length === 0, r.noCrusher.join());
    check('F8 换格派发 EnterTileEvent', r.events.includes('EnterTileEvent'), r.events.join());
}

/* ================================================ G. MoveAsideTask ======== */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit } = window.__mt;
        const tiles = makeTiles();
        const here = tiles.getByMapCoords(5, 5);
        const game = makeGame(tiles, {});
        const unit = makeUnit(here);

        /* every neighbour is free → picks a cell immediately */
        const t1 = new S.MoveAsideTask(game, new S.Vector2(0, 1));
        t1.status = S.TaskStatus.Running;
        const first = t1.onTick(unit);
        const child = t1.children[0];
        const chosen = child ? { rx: child.targetTile.rx, ry: child.targetTile.ry } : null;

        /* timeout: an isolated unit with every neighbour blocked */
        game.map.terrain.findObstacles = () => [{ obj: { rules: { crushable: false }, isTerrain: () => false, isTechno: () => true, isUnit: () => false, isBuilding: () => false }, static: true }];
        const unit2 = makeUnit(here);
        const t2 = new S.MoveAsideTask(game, new S.Vector2(0, 1));
        t2.status = S.TaskStatus.Running;
        let doneAt = -1;
        for (let i = 1; i <= 60; i++) {
            if (t2.onTick(unit2)) {
                doneAt = i;
                break;
            }
        }

        return { first, chosen, doneAt };
    });

    check('G1 有空位时返回 false（等子任务）', r.first === false);
    check('G2 立刻派发 MoveTask', r.chosen !== null, JSON.stringify(r.chosen));
    check(
        'G3 首轮不会选 0°（正后方）也不会选 180°（正前方）',
        r.chosen !== null && !(r.chosen.rx === 5 && r.chosen.ry === 6) && !(r.chosen.rx === 5 && r.chosen.ry === 4),
        JSON.stringify(r.chosen),
    );
    check('G4 40 tick 后放弃', r.doneAt > 40 && r.doneAt <= 42, `tick=${r.doneAt}`);
}

/* ================================================ H. Jumpjet ============== */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit, LPT } = window.__mt;
        const tiles = makeTiles();
        const tile = tiles.getByMapCoords(2, 2);
        const game = makeGame(tiles);
        game.map.getTileZone = () => S.ZoneType.Ground;
        game.rules.general.flightLevel = 1000;

        const heights = [];
        const unit = makeUnit(tile, {
            zone: S.ZoneType.Air,
            isAircraft: () => false,
            rules: {
                speed: 10,
                speedType: S.SpeedType.Winged,
                movementZone: S.MovementZone.Fly,
                locomotor: S.LocomotorType.Jumpjet,
                jumpjetHeight: 0,
                jumpjetClimb: 10,
                jumpjetCrash: 3,
                jumpjetSpeed: 10,
                jumpjetTurnRate: 5,
                balloonHover: false,
                hoverAttack: false,
            },
        });
        unit.position.worldPosition = new S.Vector3(0, 0, 0);
        unit.moveTrait.handleElevationChange = () => {};

        /* climb toward ground (target height 0 → already there => lands at once) */
        unit.position.worldPosition.y = 0;
        S.JumpjetLocomotor.tickStationary(unit, game);
        const landedImmediately = unit.zone;

        /* now from 30: must climb down in steps of jumpjetClimb (10) */
        unit.zone = S.ZoneType.Air;
        unit.position.worldPosition.y = 30;
        unit.position.moveByLeptons3 = (v) => {
            unit.position.worldPosition.y += v.y;
            heights.push(unit.position.worldPosition.y);
        };
        S.JumpjetLocomotor.tickStationary(unit, game);
        const afterOne = unit.position.worldPosition.y;
        const zoneAfterOne = unit.zone;
        S.JumpjetLocomotor.tickStationary(unit, game);
        S.JumpjetLocomotor.tickStationary(unit, game);
        const zoneAfterThree = unit.zone;
        S.JumpjetLocomotor.tickStationary(unit, game);
        const zoneAfterFour = unit.zone;

        const crashV = S.JumpjetLocomotor.tickCrash({ rules: { jumpjetCrash: 3 }, direction: 0 }, game, {});

        return {
            landedImmediately,
            afterOne,
            zoneAfterOne,
            zoneAfterThree,
            zoneAfterFour,
            heights,
            crashY: crashV.y,
            crashFacing: unit.direction,
        };
    });

    check('H1 高度已到位且可降落 → 立刻落地', r.landedImmediately === 0, `zone=${r.landedImmediately}`);
    check('H2 从 30 下降一帧只走 climb=10', r.afterOne === 20, `y=${r.afterOne}`);
    check('H3 下降途中仍是空中', r.zoneAfterOne === 1, `zone=${r.zoneAfterOne}`);
    check('H4 高度归零的那一帧还不算落地', r.zoneAfterThree === 1, `zone=${r.zoneAfterThree}`);
    check('H5 再下一帧才落地（降落是动画，不是瞬移）', r.zoneAfterFour === 0, `zone=${r.zoneAfterFour}`);
    check('H6 只有真正位移的帧才派发 elevation 变化（30→10 共 3 次）', r.heights.length === 3, `n=${r.heights.length}`);
    check('H7 tickCrash 下落 = -2 × jumpjetCrash', r.crashY === -6, `y=${r.crashY}`);
}

/* ================================================ I. Winged =============== */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit } = window.__mt;
        const tiles = makeTiles();
        const tile = tiles.getByMapCoords(1, 1);
        const game = makeGame(tiles);
        game.rules.general.flightLevel = 1000;

        const mk = (over) =>
            makeUnit(tile, {
                zone: S.ZoneType.Air,
                isAircraft: () => true,
                rules: {
                    speed: 10,
                    speedType: S.SpeedType.Winged,
                    movementZone: S.MovementZone.Fly,
                    locomotor: S.LocomotorType.Aircraft,
                    landable: true,
                    rot: 5,
                    pitchAngle: 0,
                    flightLevel: 0,
                    ...over,
                },
                unitOrderTrait: { getCurrentTask: () => ({ preventLanding: false }), hasTasks: () => false, addTask: () => {} },
            });

        /* parked over land → walks the facing round to 270, one rot step at a time */
        const u1 = mk({});
        u1.direction = 0;
        u1.position.worldPosition = new S.Vector3(0, 0, 0);
        let turns = 0;
        while (u1.direction !== 270 && turns < 400) {
            S.WingedLocomotor.tickStationary(u1, game);
            turns++;
        }
        const parkedFacing = u1.direction;

        /* docked → 0 */
        const u2 = mk({});
        u2.direction = 90;
        u2.airportBoundTrait = {
            preferredAirport: { dockTrait: { isDocked: () => true, hasReservedDockForUnit: () => false } },
        };
        u2.position.worldPosition = new S.Vector3(0, 0, 0);
        let turns2 = 0;
        while (u2.direction !== 0 && turns2 < 400) {
            S.WingedLocomotor.tickStationary(u2, game);
            turns2++;
        }
        const dockedFacing = u2.direction;

        /* tickCrash randomises once and reuses the deltas */
        const state = {};
        const u3 = { roll: 0, pitch: 0, direction: 0, rules: {}, moveTrait: { velocity: new S.Vector3() } };
        const v1 = S.WingedLocomotor.tickCrash(u3, game, state);
        const rollAfterFirst = state.rollDelta;
        S.WingedLocomotor.tickCrash(u3, game, state);
        const reused = state.rollDelta === rollAfterFirst;

        return { parkedFacing, dockedFacing, turns, turns2, crashX: v1.x, crashY: v1.y, reused };
    });

    check('I1 停泊的飞机用 rot 逐步转向 270°', r.parkedFacing === 270, `dir=${r.parkedFacing} turns=${r.turns}`);
    check('I2 不是瞬转（>1 帧）', r.turns > 1, `turns=${r.turns}`);
    check('I3 已入座的飞机转向 0°', r.dockedFacing === 0, `dir=${r.dockedFacing}`);
    check('I4 tickCrash 垂直速度恒为 -30', r.crashY === -30, `y=${r.crashY}`);
    check('I5 tickCrash 的 rollDelta 只生成一次', r.reused === true);
}

/* ================================================ J. docking ============== */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit } = window.__mt;
        const tiles = makeTiles();
        const field = tiles.getByMapCoords(3, 3);
        const game = makeGame(tiles);

        const mkDock = (over = {}) => {
            const log = [];
            return {
                log,
                hasReservedDockForUnit: () => over.reserved === true,
                getFirstAvailableDockNumber: () => (over.full ? undefined : 0),
                reserveDockAt: (u, n) => log.push(['reserve', n]),
                unreserveDockForUnit: () => log.push(['unreserve']),
                undockUnit: () => log.push(['undock']),
                dockUnitAt: () => log.push(['dock']),
                getReservedDockForUnit: () => 0,
                getDockTile: () => field,
                getDockOffset: () => new S.Vector3(0, 0, 0),
            };
        };

        const mkTarget = (dockTrait, over = {}) => ({
            name: 'REF',
            tile: field,
            isSpawned: true,
            dockTrait,
            helipadTrait: over.helipadTrait,
            getFoundation: () => ({ width: 3, height: 3 }),
            position: { getMapPosition: () => new S.Vector2(0, 0) },
        });

        const unit = makeUnit(field, { owner: 'P' });

        /* free dock → reserved immediately */
        const dock1 = mkDock();
        const t1 = new S.MoveToDockTask(game, mkTarget(dock1));
        t1.status = S.TaskStatus.Running;
        t1.onStart(unit);

        /* all docks busy, not a helipad → queueing */
        const dock2 = mkDock({ full: true });
        const t2 = new S.MoveToDockTask(game, mkTarget(dock2));
        t2.status = S.TaskStatus.Running;
        t2.onStart(unit);

        /* all docks busy, helipad → cancel */
        const dock3 = mkDock({ full: true });
        const t3 = new S.MoveToDockTask(game, mkTarget(dock3, { helipadTrait: {} }));
        t3.status = S.TaskStatus.Running;
        t3.onStart(unit);

        const status1 = t1.dockingStatus;

        /* onEnd releases unless docked */
        t1.onEnd(unit);
        const releasedOnCancel = dock1.log.slice();

        return {
            reserveLog: dock1.log.slice(),
            status1,
            status2: t2.dockingStatus,
            status3: t3.status,
            cancelled: t3.isCancelling(),
            releasedOnCancel,
        };
    });

    check('J1 有空码头 → 立刻 reserve', r.reserveLog[0] && r.reserveLog[0][0] === 'reserve', JSON.stringify(r.reserveLog));
    check('J2 状态直接进入 MoveToDock(3)', r.status1 === 3, `s=${r.status1}`);
    check('J3 码头全忙且不是停机坪 → 去排队(1)', r.status2 === 1, `s=${r.status2}`);
    check('J4 停机坪全忙 → 立刻取消（Cancelling）', r.cancelled === true, `status=${r.status3}`);
    check('J5 onEnd 释放未入座的预订', r.releasedOnCancel.some((e) => e[0] === 'unreserve'), JSON.stringify(r.releasedOnCancel));
}

/* ================================================ K. scatter ============== */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit } = window.__mt;
        const tiles = makeTiles();
        const here = tiles.getByMapCoords(4, 4);
        const game = makeGame(tiles);

        const flyer = makeUnit(here, {
            rules: { ...makeUnit(here).rules, movementZone: S.MovementZone.Fly },
        });
        const t1 = new S.ScatterTask(game, undefined, undefined);
        t1.status = S.TaskStatus.Running;
        t1.onStart(flyer);

        const walker = makeUnit(here, {
            rules: { ...makeUnit(here).rules, movementZone: S.MovementZone.Ground },
            moveTrait: {
                ...makeUnit(here).moveTrait,
                isDisabled: () => false,
            },
        });
        const target = tiles.getByMapCoords(5, 4);
        const t2 = new S.ScatterTask(game, { tile: target, onBridge: false }, undefined);
        t2.status = S.TaskStatus.Running;
        t2.onStart(walker);

        return {
            flyerChildren: t1.children.length,
            walkerChildren: t2.children.length,
            childTarget: t2.children[0] ? t2.children[0].targetTile.id : null,
            onTickTrue: t2.onTick(walker),
        };
    });

    check('K1 飞行单位不散开', r.flyerChildren === 0, `n=${r.flyerChildren}`);
    check('K2 地面单位散开', r.walkerChildren === 1, `n=${r.walkerChildren}`);
    check('K3 散开目标就是给定格', r.childTarget === '5,4', String(r.childTarget));
    check('K4 onTick 立刻返回 true（只负责派发子任务）', r.onTickTrue === true);
}

/* ================================================ page errors ============ */
const fatal = errors.filter((e) => !/ResizeObserver|WebGL|GPU stall|deprecated/i.test(e));
check('Z1 页面无运行时异常', fatal.length === 0, fatal.slice(0, 3).join(' | '));

await browser.close();

console.log('');
console.log(`RESULT  pass=${pass}  fail=${fail}`);
process.exit(fail ? 1 : 0);
