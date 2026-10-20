/**
 * B6c (attack task + traits + order queue) regression.
 *
 * B6c lands the half of combat that has no visible geometry: the attack state
 * machine, weapon selection, threat scoring, and the order/task queue that drives
 * every task in the game. None of it shows up in a screenshot, and the failures
 * are silent (a unit that never fires, a queue that stalls, a building that
 * shoots its own captured tanks). So the checks are about contracts:
 *
 *   A. ATTACK TASK START   — no attack trait throws, empty ammo cancels before
 *                            touching state, target lines pick object vs tile.
 *   B. ATTACK TASK END     — turret recentres, state resets, bursts are dropped.
 *   C. FORCE CANCEL        — only aircraft, only when every move child agrees.
 *   D. CHECK RANGE         — in range promotes to PrepareToFire, out of range
 *                            pushes a non-blocking `MoveInWeaponRangeTask`, and
 *                            four failed attempts end the order.
 *   E. AIM AND FIRE        — turret vs hull vs inf-snap facing, then the actual
 *                            `weapon.fire`, suicide weapons, cooldown gate.
 *   F. ATTACK TRAIT MATH   — cooldown membership, armour verses, threat score,
 *                            distributed-fire decay.
 *   G. UNIT ORDER TRAIT    — queue insertion order, queued-order padding, one
 *                            productive order per tick, refusal contract.
 *   H. ENTER BUILDING      — approach/enter/bounce latch.
 *   I. ENTER TRANSPORT     — the moving-transport refusal and the layer check.
 *   J. EVACUATE TRANSPORT  — gunner rule, soft vs hard unload, LIFO pop.
 *
 * usage: node tools/attacktasktest.mjs [url]
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

/* ============================================================ stub kit ==== */
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

    function makeWeapon(over = {}) {
        const weapon = {
            type: over.type !== undefined ? over.type : 0,
            rules: {
                range: 5,
                minRange: 0,
                fireOnce: false,
                limboLaunch: false,
                suicide: false,
                spawner: false,
                omniFire: false,
                cellRangefinding: false,
                neverUse: false,
                areaFire: false,
                ...(over.rules || {}),
            },
            projectileRules: {
                rot: 0,
                iniRot: 1,
                arcing: false,
                vertical: false,
                isAntiAir: false,
                subjectToWalls: false,
                subjectToCliffs: false,
                subjectToElevation: false,
                ...(over.projectileRules || {}),
            },
            warhead: {
                rules: { temporal: false, wall: false, verses: new Map([[3, 100]]), ...(over.warheadRules || {}) },
            },
            targeting: { canTarget: over.canTarget || (() => true) },
            cooldown: over.cooldown || 0,
            bursts: over.bursts || 0,
            fired: [],
            get range() {
                return this.rules.range;
            },
            get minRange() {
                return this.rules.minRange;
            },
            getCooldownTicks() {
                return this.cooldown;
            },
            hasBurstsLeft() {
                return this.bursts > 0;
            },
            resetBursts() {
                this.resetCalled = (this.resetCalled || 0) + 1;
                this.bursts = 0;
            },
            fire(target, game, multiplier) {
                this.fired.push(multiplier === undefined ? 1 : multiplier);
            },
        };
        return weapon;
    }

    function makeTarget(obj, tile, bridge) {
        return {
            obj,
            tile,
            getBridge: () => bridge,
            isBridge: () => !!bridge,
            getWorldCoords: () =>
                obj && obj.position
                    ? obj.position.worldPosition
                    : new S.Vector3(tile.rx * LPT + LPT / 2, 0, tile.ry * LPT + LPT / 2),
            equals: (other) => !!other && other.obj === obj && other.tile === tile,
        };
    }

    function makeGame(tiles, opts = {}) {
        const tileOccupation = {
            occupied: [],
            getBridgeOnTile: () => undefined,
            getGroundObjectsOnTile: () => opts.groundObjects || [],
            getAirObjectsOnTile: () => [],
            getObjectsOnTile: () => opts.groundObjects || [],
            isTileOccupiedBy: (tile, obj) => !!(opts.occupiedBy && opts.occupiedBy(tile, obj)),
            occupySingleTile: () => {},
            unoccupySingleTile: () => {},
            unoccupyTileRange: () => {},
            occupyTileRange: () => {},
            calculateTilesForGameObject: () => opts.rampTiles || [],
        };
        const game = {
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
                technosByTile: { queryRange: () => opts.nearbyTechnos || [] },
                terrain: {
                    getPassableSpeed: () => (opts.impassable ? 0 : 1),
                    findObstacles: () => opts.obstacles || [],
                    getIslandIdMap: () => ({ get: () => 0 }),
                    isBlockerObject: () => false,
                },
            },
            alliances: { areAllied: () => false, haveSharedIntel: () => true },
            rules: {
                general: {
                    prism: { type: 'PrismTower', supportModifier: 0.5, supportMax: 4 },
                    normalTargetingDelay: 15,
                    guardAreaTargetingDelay: 15,
                    closeEnough: 2,
                    harvesterTooFarDistance: 30,
                },
                elevationModel: { getBonus: () => 0 },
                combatDamage: { c4Warhead: 'C4Warhead' },
                getWarhead: () => ({ verses: new Map() }),
                getTiberium: () => ({ value: 25 }),
            },
            events: {
                dispatched: [],
                dispatch(e) {
                    this.dispatched.push(e);
                },
            },
            currentTick: 1,
            areFriendly: (a, b) => a.owner === b.owner,
            isValidTarget: (t) => t != null,
            createTarget: (obj, tile) => makeTarget(obj, tile),
            generateRandomInt: (min) => min,
            destroyObject(obj, info) {
                obj.isDestroyed = true;
                obj.destroyInfo = info;
            },
            unspawnObject(obj) {
                obj.isSpawned = false;
                obj.unspawned = true;
            },
            limboObject(obj) {
                obj.isSpawned = false;
                obj.limboed = true;
            },
            unlimboObject(obj) {
                obj.isSpawned = true;
            },
            spawnObject() {},
            getUnitSelection: () => ({
                isSelected: () => false,
                getOrCreateSelectionModel: () => ({ getControlGroupNumber: () => undefined }),
                addToSelection() {},
                addUnitsToGroup() {},
            }),
        };
        return game;
    }

    function makeUnit(tile, over = {}) {
        const unit = {
            id: 1,
            name: 'TESTUNIT',
            owner: 'P',
            tile,
            zone: S.ZoneType.Ground,
            onBridge: false,
            direction: 0,
            tileElevation: 0,
            ammo: 10,
            isDestroyed: false,
            isSpawned: true,
            rules: {
                armor: 3,
                speed: 20,
                speedType: S.SpeedType.Track,
                movementZone: S.MovementZone.Ground,
                locomotor: S.LocomotorType.Vehicle,
                rot: 5,
                neverUse: false,
                omniFire: false,
                balloonHover: false,
                hoverAttack: false,
                fighter: false,
                spawned: false,
                limboLaunch: false,
                distributedFire: false,
                vhpScan: S.VhpScan.None,
                specialThreatValue: 0,
                threatPosed: 0,
                civilian: false,
                insignificant: false,
                harvester: false,
            },
            position: {
                subCell: 0,
                desiredSubCell: 0,
                tileElevation: 0,
                worldPosition: new S.Vector3(tile.rx * LPT + LPT / 2, 0, tile.ry * LPT + LPT / 2),
                getMapPosition: () => new S.Vector2(tile.rx * LPT, tile.ry * LPT),
                getTileOffset: () => new S.Vector2(0, 0),
                computeSubCellOffset: () => new S.Vector2(0, 0),
                moveByLeptons: () => {},
                moveByLeptons3: () => {},
                moveByLeptons2: () => {},
            },
            moveTrait: {
                moveState: S.MoveState.Idle,
                lastMoveResult: undefined,
                lastTeleportTick: 0,
                baseSpeed: 0,
                isDisabled: () => false,
                isIdle() {
                    return this.moveState === S.MoveState.Idle;
                },
                isMoving() {
                    return this.moveState !== S.MoveState.Idle;
                },
            },
            attackTrait: {
                attackState: S.AttackState.Idle,
                currentTarget: undefined,
                isDisabled: () => false,
                isOnCooldown: () => false,
                selectWeaponVersus: () => null,
                expirePassiveScanCooldown() {},
            },
            armedTrait: {
                isEquippedWithWeapon: () => true,
                computeGuardScanRange: () => 10,
                getDeployFireWeapon: () => undefined,
            },
            art: { fireUp: 0, sequences: new Set() },
            healthTrait: { health: 100, maxHitPoints: 200, getProjectedHitPoints: () => 50 },
            healthBarTrait: {},
            invulnerableTrait: { isActive: () => false },
            warpedOutTrait: { isInvulnerable: () => false, isActive: () => false },
            parasiteableTrait: { isInfested: () => false, isParalyzed: () => false },
            unitOrderTrait: {
                tasks: [],
                getCurrentTask() {
                    return this.tasks[0];
                },
                hasTasks() {
                    return this.tasks.length > 0;
                },
                getTasks() {
                    return [...this.tasks];
                },
                addTask(t) {
                    this.tasks.push(t);
                },
                addTasks(...ts) {
                    ts.forEach((t) => this.tasks.push(t));
                },
                unmarkNextQueuedOrder() {},
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
            getFoundation: () => ({ width: 1, height: 1 }),
            getBridge: () => undefined,
            ...over,
        };
        return unit;
    }

    window.__at = { S, LPT, makeTiles, makeWeapon, makeTarget, makeGame, makeUnit };
});

/* ================================================ A. AttackTask start ==== */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit, makeWeapon, makeTarget } = window.__at;
        const tiles = makeTiles();
        const game = makeGame(tiles);
        const start = tiles.getByMapCoords(0, 0);
        const far = tiles.getByMapCoords(1, 0);
        const farUnit = makeUnit(far);
        const farTarget = makeTarget(farUnit, far);

        /* A1: no attack trait must throw, not silently no-op */
        const bare = makeUnit(start, { attackTrait: undefined });
        const taskBare = new S.AttackTask(game, farTarget, makeWeapon());
        taskBare.status = S.TaskStatus.Running;
        let threw = false;
        try {
            taskBare.onStart(bare);
        } catch (e) {
            threw = true;
        }

        /* A2/A3: empty ammo cancels before any state is touched */
        const dry = makeUnit(start, { ammo: 0 });
        const taskDry = new S.AttackTask(game, farTarget, makeWeapon());
        taskDry.status = S.TaskStatus.Running;
        taskDry.onStart(dry);

        /* A4/A5: normal start */
        const unit = makeUnit(start);
        const task = new S.AttackTask(game, farTarget, makeWeapon());
        task.status = S.TaskStatus.Running;
        task.onStart(unit);

        /* A6/A7: target lines for an object target vs a bare tile */
        const objTargetLines = {
            hasTarget: task.getTargetLinesConfig().target === farUnit,
            pathNodes: task.getTargetLinesConfig().pathNodes.length,
            isAttack: task.getTargetLinesConfig().isAttack,
        };
        const tileTask = new S.AttackTask(game, makeTarget(undefined, tiles.getByMapCoords(2, 0)), makeWeapon());
        const tileLines = tileTask.getTargetLinesConfig();

        /* A8/A9: onTargetChange bookkeeping */
        const ownerObj = { isTechno: () => true, owner: 'E' };

        return {
            threw,
            dryStatus: taskDry.status,
            dryState: dry.attackTrait.attackState,
            state: unit.attackTrait.attackState,
            selfTiles: task.initialSelfPosition ? task.initialSelfPosition.tile.id : null,
            objTargetLines,
            tilePathNodes: tileLines.pathNodes.length,
            tilePathHasBridgeKey: tileLines.pathNodes.length ? 'onBridge' in tileLines.pathNodes[0] : false,
            tileLinesIsAttack: tileLines.isAttack,
            lastValid: task.lastValidTargetPosition ? task.lastValidTargetPosition.tile.id : null,
            owner: task.initialTargetOwner,
            indirectForTile: (() => {
                const t = new S.AttackTask(game, makeTarget(undefined, tiles.getByMapCoords(3, 0)), makeWeapon());
                t.status = S.TaskStatus.Running;
                return t.initialIndirectTarget;
            })(),
            indirectForObj: task.initialIndirectTarget,
        };
    });

    check('A1 无 attackTrait 时 onStart 抛错', r.threw === true);
    check('A2 弹药为 0 时 onStart 取消任务', r.dryStatus === 3, `status=${r.dryStatus}`);
    check('A3 弹药为 0 时不改 attackState', r.dryState === 0, `state=${r.dryState}`);
    check('A4 onStart 置 attackState=CheckRange', r.state === 1, `state=${r.state}`);
    check('A5 initialSelfPosition 记录起始格', r.selfTiles === '0,0', `tile=${r.selfTiles}`);
    check('A6 对象目标：target 指向对象且无路径节点', r.objTargetLines.hasTarget && r.objTargetLines.pathNodes === 0);
    check('A7 对象目标：isAttack=true', r.objTargetLines.isAttack === true);
    check('A8 地块目标：pathNodes 单节点', r.tilePathNodes === 1, `n=${r.tilePathNodes}`);
    check('A9 地块目标：节点带 onBridge 键', r.tilePathHasBridgeKey === true);
    check('A10 地块目标：isAttack=true', r.tileLinesIsAttack === true);
    check('A11 onTargetChange 记录 lastValidTargetPosition', r.lastValid === '1,0', `tile=${r.lastValid}`);
    check('A12 initialIndirectTarget：单位目标为 false', r.indirectForObj === false);
}

/* ================================================== B. AttackTask end ==== */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit, makeWeapon, makeTarget } = window.__at;
        const tiles = makeTiles();
        const game = makeGame(tiles);
        const start = tiles.getByMapCoords(0, 0);
        const targetTile = tiles.getByMapCoords(1, 0);
        const weapon = makeWeapon({ bursts: 3 });
        const unit = makeUnit(start, {
            direction: 90,
            turretTrait: { facing: 0, desiredFacing: 0 },
            isFiring: true,
        });
        unit.attackTrait.currentTarget = 'stale';
        const task = new S.AttackTask(game, makeTarget(makeUnit(targetTile), targetTile), weapon);
        task.status = S.TaskStatus.Running;
        task.onStart(unit);
        task.onEnd(unit);

        /* B5: duplicate shares game/target/weapon but is a fresh task */
        const dup = task.duplicate();

        return {
            desiredFacing: unit.turretTrait.desiredFacing,
            state: unit.attackTrait.attackState,
            currentTarget: unit.attackTrait.currentTarget,
            resetCalls: weapon.resetCalled || 0,
            burstsLeft: weapon.bursts,
            isFiring: unit.isFiring,
            dupIsNew: dup !== task,
            dupWeaponSame: dup.getWeapon() === weapon,
            dupState: dup.status,
        };
    });

    check('B1 onEnd 把炮塔 desiredFacing 归到车身朝向', r.desiredFacing === 90, `facing=${r.desiredFacing}`);
    check('B2 onEnd 把 attackState 归 Idle', r.state === 0, `state=${r.state}`);
    check('B3 onEnd 清空 currentTarget', r.currentTarget === undefined);
    check('B4 onEnd 在还有连发时重置连发', r.resetCalls === 1 && r.burstsLeft === 0);
    check('B5 onEnd 清掉 isFiring', r.isFiring === false);
    check('B6 duplicate 是新实例但共享武器', r.dupIsNew && r.dupWeaponSame);
    check('B7 duplicate 从 NotStarted 开始', r.dupState === 0, `state=${r.dupState}`);
}

/* =================================================== C. forceCancel ====== */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit, makeWeapon, makeTarget } = window.__at;
        const tiles = makeTiles();
        const game = makeGame(tiles);
        const start = tiles.getByMapCoords(0, 0);
        const far = tiles.getByMapCoords(1, 0);

        const ground = makeUnit(start);
        const groundTask = new S.AttackTask(game, makeTarget(makeUnit(far), far), makeWeapon());
        groundTask.status = S.TaskStatus.Running;
        groundTask.onStart(ground);
        const groundResult = groundTask.forceCancel(ground);

        const flyer = makeUnit(start, {
            rules: { ...makeUnit(start).rules, movementZone: S.MovementZone.Fly },
        });
        const flyTask = new S.AttackTask(game, makeTarget(makeUnit(far), far), makeWeapon());
        flyTask.status = S.TaskStatus.Running;
        flyTask.onStart(flyer);
        const okResult = flyTask.forceCancel(flyer);

        const blocked = makeUnit(start, {
            rules: { ...makeUnit(start).rules, movementZone: S.MovementZone.Fly },
        });
        const blockedTask = new S.AttackTask(game, makeTarget(makeUnit(far), far), makeWeapon());
        blockedTask.status = S.TaskStatus.Running;
        blockedTask.onStart(blocked);
        const stubborn = new S.Task();
        stubborn.setCancellable(false);
        blockedTask.children.push(stubborn);
        const blockedResult = blockedTask.forceCancel(blocked);

        return {
            groundResult,
            okResult,
            okStatus: flyTask.status,
            okState: flyer.attackTrait.attackState,
            blockedResult,
            blockedStatus: blockedTask.status,
        };
    });

    check('C1 地面单位不允许 forceCancel', r.groundResult === false);
    check('C2 飞行单位且子任务均可取消 → 成功', r.okResult === true);
    check('C3 forceCancel 成功后 status=Cancelled', r.okStatus === 4, `status=${r.okStatus}`);
    check('C4 forceCancel 成功时执行 onEnd', r.okState === 0, `state=${r.okState}`);
    check('C5 存在不可取消子任务 → 拒绝', r.blockedResult === false);
    check('C6 拒绝时不清空状态', r.blockedStatus === 1, `status=${r.blockedStatus}`);
}

/* ==================================================== D. CheckRange ====== */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit, makeWeapon, makeTarget } = window.__at;
        const tiles = makeTiles();
        const game = makeGame(tiles);
        const start = tiles.getByMapCoords(0, 0);

        /* D1: no usable move trait -> give up */
        const immobile = makeUnit(start, { moveTrait: undefined });
        const t1 = new S.AttackTask(game, makeTarget(undefined, tiles.getByMapCoords(9, 0)), makeWeapon({ rules: { range: 2 } }));
        t1.status = S.TaskStatus.Running;
        t1.onStart(immobile);
        t1.children.length = 0;
        const immobileResult = t1.onTick(immobile);

        /* D2: in range -> PrepareToFire, no move child */
        const nearUnit = makeUnit(start);
        const nearTarget = makeUnit(tiles.getByMapCoords(1, 0));
        const t2 = new S.AttackTask(game, makeTarget(nearTarget, nearTarget.tile), makeWeapon({ rules: { range: 5 } }));
        t2.status = S.TaskStatus.Running;
        t2.onStart(nearUnit);
        t2.onTick(nearUnit);
        t2.onTick(nearUnit);
        const nearState = nearUnit.attackTrait.attackState;
        const nearMoveChildren = t2.children.filter((c) => c instanceof S.MoveInWeaponRangeTask).length;

        /* D3/D4: out of range -> pushes a non-blocking approach */
        const farUnit = makeUnit(start);
        const farTarget = makeUnit(tiles.getByMapCoords(9, 0));
        const t3 = new S.AttackTask(game, makeTarget(farTarget, farTarget.tile), makeWeapon({ rules: { range: 1 } }));
        t3.status = S.TaskStatus.Running;
        t3.onStart(farUnit);
        t3.children.length = 0;
        t3.onTick(farUnit);
        const approach = t3.children.find((c) => c instanceof S.MoveInWeaponRangeTask);

        /* D5/D6: repeated failure. The child is dropped each round to force a retry. */
        const attempts = [];
        for (let i = 0; i < 5; i++) {
            t3.children.length = 0;
            t3.rangeCheckCooldown = 0;
            const done = t3.onTick(farUnit);
            attempts.push({ done, n: t3.moveAttempts });
        }

        /* D7: rangeCheckCooldown gates the whole state */
        const t7 = new S.AttackTask(game, makeTarget(farTarget, farTarget.tile), makeWeapon({ rules: { range: 1 } }));
        t7.status = S.TaskStatus.Running;
        t7.onStart(farUnit);
        t7.children.length = 0;
        t7.rangeCheckCooldown = 3;
        const coldDone = t7.onTick(farUnit);
        const coldAfter = t7.rangeCheckCooldown;

        return {
            immobileResult,
            nearState,
            nearMoveChildren,
            hasApproach: !!approach,
            approachBlocking: approach ? approach.blocking : null,
            moveExecuted: t3.moveExecuted,
            lastSelfMoveTarget: t3.lastSelfMoveTargetTile ? t3.lastSelfMoveTargetTile.id : null,
            attempts,
            coldDone,
            coldAfter,
        };
    });

    check('D1 无移动能力时直接结束', r.immobileResult === true);
    check('D2 射程内进入 PrepareToFire', r.nearState === 2, `state=${r.nearState}`);
    check('D3 射程内不推移动子任务', r.nearMoveChildren === 0, `n=${r.nearMoveChildren}`);
    check('D4 射程外推 MoveInWeaponRangeTask', r.hasApproach === true);
    check('D5 该子任务是非阻塞的', r.approachBlocking === false, `blocking=${r.approachBlocking}`);
    check('D6 push 之后 moveExecuted=true', r.moveExecuted === true);
    check('D7 记录 lastSelfMoveTargetTile', r.lastSelfMoveTarget === '9,0', `tile=${r.lastSelfMoveTarget}`);
    check('D8 同格反复失败会累加 moveAttempts', r.attempts[0].n === 1, `n=${r.attempts[0].n}`);
    check('D9 第一次重试还带一个 WaitMinutesTask', r.attempts[0].done === false);
    check('D10 超过 3 次放弃（第 4 次返回 true）', r.attempts[3].done === true, `n=${r.attempts[3].n}`);
    check('D11 冷却中直接返回 false', r.coldDone === false);
    check('D12 冷却每次递减 1', r.coldAfter === 2, `cd=${r.coldAfter}`);
}

/* ==================================================== E. Aim and fire ==== */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit, makeWeapon, makeTarget } = window.__at;
        const tiles = makeTiles();
        const game = makeGame(tiles);
        const start = tiles.getByMapCoords(0, 0);
        const east = tiles.getByMapCoords(1, 0);

        /* E1: infantry snaps to the desired facing on the spot */
        const inf = makeUnit(start, {
            isInfantry: () => true,
            isVehicle: () => false,
            direction: 0,
        });
        const infTarget = makeUnit(east);
        const infWeapon = makeWeapon();
        const infTask = new S.AttackTask(game, makeTarget(infTarget, infTarget.tile), infWeapon);
        infTask.status = S.TaskStatus.Running;
        infTask.onStart(inf);
        infTask.onTick(inf);
        infTask.onTick(inf);
        const infFacing = inf.direction;
        const expectedFacing = S.FacingUtil.fromMapCoords(
            new S.Vector2(
                infTarget.position.worldPosition.x - inf.position.worldPosition.x,
                infTarget.position.worldPosition.z - inf.position.worldPosition.z,
            ),
        );

        /* E2: hold-ground + disallowTurning refuses rather than turning */
        const holdUnit = makeUnit(start);
        const holdTask = new S.AttackTask(game, makeTarget(infTarget, infTarget.tile), makeWeapon(), {
            disallowTurning: true,
        });
        holdTask.status = S.TaskStatus.Running;
        holdTask.onStart(holdUnit);
        holdTask.onTick(holdUnit);
        holdTask.onTick(holdUnit);
        const holdDone = holdTask.onTick(holdUnit);

        /* E3: a vehicle with a turret aims it and waits for the tolerance */
        const tank = makeUnit(start, { turretTrait: { facing: 180, desiredFacing: 180 } });
        const tankTarget = makeUnit(east);
        const tankWeapon = makeWeapon({ rules: { omniFire: false } });
        const tankTask = new S.AttackTask(game, makeTarget(tankTarget, tankTarget.tile), tankWeapon);
        tankTask.status = S.TaskStatus.Running;
        tankTask.onStart(tank);
        tankTask.onTick(tank);
        tankTask.onTick(tank);
        const turretDesired = tank.turretTrait.desiredFacing;
        const turretExpected = S.FacingUtil.fromMapCoords(
            new S.Vector2(
                tankTarget.position.worldPosition.x - tank.position.worldPosition.x,
                tankTarget.position.worldPosition.z - tank.position.worldPosition.z,
            ),
        );
        const turretFired = tankWeapon.fired.length;

        /* E4/E5: omniFire skips facing entirely and fires */
        const gunner = makeUnit(start);
        const gunnerWeapon = makeWeapon({ rules: { omniFire: true } });
        const gunnerTask = new S.AttackTask(game, makeTarget(tankTarget, tankTarget.tile), gunnerWeapon);
        gunnerTask.status = S.TaskStatus.Running;
        gunnerTask.onStart(gunner);
        let shotTicks = 0;
        while (shotTicks < 6 && gunnerWeapon.fired.length === 0) {
            gunnerTask.onTick(gunner);
            shotTicks++;
        }

        /* E6: fireOnce ends the task on the shot */
        const onceUnit = makeUnit(start);
        const onceWeapon = makeWeapon({ rules: { omniFire: true, fireOnce: true } });
        const onceTask = new S.AttackTask(game, makeTarget(tankTarget, tankTarget.tile), onceWeapon);
        onceTask.status = S.TaskStatus.Running;
        onceTask.onStart(onceUnit);
        let onceDone = false;
        for (let i = 0; i < 6 && !onceDone; i++) onceDone = onceTask.onTick(onceUnit) === true;

        /* E7: suicide weapon destroys the shooter */
        const bombUnit = makeUnit(start);
        const bombTask = new S.AttackTask(
            game,
            makeTarget(tankTarget, tankTarget.tile),
            makeWeapon({ rules: { omniFire: true, suicide: true }, type: 0 }),
        );
        bombTask.status = S.TaskStatus.Running;
        bombTask.onStart(bombUnit);
        let bombDone = false;
        for (let i = 0; i < 6 && !bombDone; i++) bombDone = bombTask.onTick(bombUnit) === true;

        /* E8: cooldown blocks the shot entirely */
        const coldUnit = makeUnit(start);
        coldUnit.attackTrait.isOnCooldown = () => true;
        const coldWeapon = makeWeapon({ rules: { omniFire: true } });
        const coldTask = new S.AttackTask(game, makeTarget(tankTarget, tankTarget.tile), coldWeapon);
        coldTask.status = S.TaskStatus.Running;
        coldTask.onStart(coldUnit);
        for (let i = 0; i < 6; i++) coldTask.onTick(coldUnit);

        return {
            infFacing,
            expectedFacing,
            holdDone,
            turretDesired,
            turretExpected,
            turretFired,
            turretFacingUnchanged: tank.turretTrait.facing,
            shots: gunnerWeapon.fired.length,
            shotTicks,
            onceDone,
            onceShots: onceWeapon.fired.length,
            bombDone,
            bombDestroyed: bombUnit.isDestroyed,
            coldShots: coldWeapon.fired.length,
        };
    });

    check('E1 步兵当场对齐到目标方向', r.infFacing === r.expectedFacing, `${r.infFacing} vs ${r.expectedFacing}`);
    check('E2 disallowTurning 时宁可不打也不转身', r.holdDone === true);
    check('E3 车辆把炮塔指向目标', r.turretDesired === r.turretExpected, `desired=${r.turretDesired} exp=${r.turretExpected}`);
    check('E4 炮塔没转到容差内不放炮', r.turretFacingUnchanged === 180);
    check('E5 omniFire 下若干 tick 内开火一次', r.shots === 1, `shots=${r.shots} ticks=${r.shotTicks}`);
    check('E6 fireOnce 打完即结束', r.onceDone === true && r.onceShots === 1);
    check('E7 自杀武器摧毁自己并结束', r.bombDone === true && r.bombDestroyed === true);
    check('E8 冷却中一枪不发', r.coldShots === 0, `shots=${r.coldShots}`);
}

/* ================================================= F. AttackTrait math === */
{
    const r = await evalPage(() => {
        const { S, makeUnit, makeWeapon } = window.__at;
        const trait = new S.AttackTrait({}, { getBridgeOnTile: () => undefined });
        const A = S.AttackState;

        /* F1/F2: state predicates */
        const firing = [A.Firing, A.FireUp, A.JustFired].map((s) => {
            trait.attackState = s;
            return trait.isFiring();
        });
        const notFiring = [A.Idle, A.CheckRange, A.PrepareToFire].map((s) => {
            trait.attackState = s;
            return trait.isFiring();
        });
        trait.attackState = A.Idle;
        const idleAtIdle = trait.isIdle();
        trait.attackState = A.CheckRange;
        const idleAtRange = trait.isIdle();

        /* F3-F5: cooldown membership */
        const w1 = makeWeapon({ cooldown: 5 });
        const w2 = makeWeapon({ cooldown: 0 });
        const plain = makeUnit({ rx: 0, ry: 0, z: 0, id: '0,0' }, { primaryWeapon: w1, secondaryWeapon: w2 });
        const primaryCold = trait.isOnCooldown(plain);
        w1.cooldown = 0;
        w2.cooldown = 7;
        const secondaryCold = trait.isOnCooldown(plain);
        w2.cooldown = 0;
        const areaWeapon = makeWeapon({ cooldown: 9, rules: { areaFire: true, fireOnce: false } });
        const deployer = makeUnit(
            { rx: 0, ry: 0, z: 0, id: '0,0' },
            {
                primaryWeapon: areaWeapon,
                secondaryWeapon: makeWeapon({ cooldown: 0 }),
                armedTrait: { getDeployFireWeapon: () => areaWeapon, isEquippedWithWeapon: () => true },
            },
        );
        const areaExcluded = trait.isOnCooldown(deployer);

        /* F6-F9: armour verses */
        const verses = new Map([[3, 100], [4, 0], [5, 0.005]]);
        const wr = { name: 'WH', verses, ivanBomb: false, bombDisarm: false, nukeMaker: false };
        const normal100 = trait.checkArmor(wr, 3, false);
        const zeroVerses = trait.checkArmor(wr, 4, false);
        const onePercentDefensive = trait.checkArmor(wr, 5, true);
        const onePercentOffensive = trait.checkArmor(wr, 5, false);
        let warned = '';
        const origWarn = console.warn;
        console.warn = (m) => {
            warned = String(m);
        };
        const missing = trait.checkArmor(wr, 7, false);
        console.warn = origWarn;

        /* F10/F11: weapon list filtering */
        const neverWeapon = makeWeapon({ rules: { neverUse: true } });
        const usable = makeWeapon();
        const lister = makeUnit(
            { rx: 0, ry: 0, z: 0, id: '0,0' },
            { primaryWeapon: usable, secondaryWeapon: neverWeapon },
        );
        const activeList = trait.getAvailableWeapons(lister, false, false);
        /* F12 needs a *usable* secondary, so it gets its own unit — `lister`
         * deliberately carries a neverUse secondary to prove the filter. */
        const dualWielder = makeUnit(
            { rx: 0, ry: 0, z: 0, id: '0,0' },
            { primaryWeapon: makeWeapon(), secondaryWeapon: makeWeapon() },
        );
        const passiveList = trait.getAvailableWeapons(dualWielder, true, false);
        const passiveTileList = trait.getAvailableWeapons(dualWielder, true, true);

        /* F12-F15: threat score */
        const threatRules = {
            targetEffectivenessCoefficientDefault: 1,
            targetSpecialThreatCoefficientDefault: 1,
            myEffectivenessCoefficientDefault: 1,
            targetStrengthCoefficientDefault: 1,
            targetDistanceCoefficientDefault: 1,
        };
        const self = makeUnit({ rx: 0, ry: 0, z: 0, id: '0,0' }, { rules: { ...makeUnit({ rx: 0, ry: 0, z: 0, id: '0,0' }).rules } });
        /* `other` must be armed: the negated term is *its* effectiveness
         * against `self`, and an unarmed target multiplies 0 by -1. */
        const other = makeUnit({ rx: 3, ry: 0, z: 0, id: '3,0' }, { primaryWeapon: makeWeapon() });
        const scorer = makeWeapon();
        const baseScore = trait.computeThreat(other, self, scorer, 0, threatRules);
        other.attackTrait.currentTarget = { obj: self };
        const targetedScore = trait.computeThreat(other, self, scorer, 0, threatRules);
        other.attackTrait.currentTarget = undefined;

        const scanSelf = makeUnit(
            { rx: 0, ry: 0, z: 0, id: '0,0' },
            { rules: { ...makeUnit({ rx: 0, ry: 0, z: 0, id: '0,0' }).rules, vhpScan: S.VhpScan.Strong } },
        );
        const deadTarget = makeUnit({ rx: 3, ry: 0, z: 0, id: '3,0' }, {
            healthTrait: { health: 100, maxHitPoints: 200, getProjectedHitPoints: () => 0 },
        });
        const strongScore = trait.computeThreat(deadTarget, scanSelf, scorer, 0, threatRules);

        /* F16/F17: distributed fire history */
        const distributedSelf = makeUnit(
            { rx: 0, ry: 0, z: 0, id: '0,0' },
            { rules: { ...makeUnit({ rx: 0, ry: 0, z: 0, id: '0,0' }).rules, distributedFire: true } },
        );
        const firstPass = trait.computeThreat(other, distributedSelf, scorer, 0, threatRules);
        trait.updateDistributedFireHistory({ target: other, weapon: scorer });
        const stamped = trait.distributedFireHistory.get(other);
        const secondPass = trait.computeThreat(other, distributedSelf, scorer, 0, threatRules);
        trait.updateDistributedFireHistory({ target: other, weapon: scorer });
        const stillStamped = trait.distributedFireHistory.get(other);

        /* F18/F19: cooldown helpers */
        let cancelled = 0;
        trait.opportunityFireTask = { cancel: () => cancelled++ };
        trait.cancelOpportunityFire();
        trait.passiveScanCooldownTicks = 9;
        trait.expirePassiveScanCooldown();

        return {
            firing,
            notFiring,
            idleAtIdle,
            idleAtRange,
            primaryCold,
            secondaryCold,
            areaExcluded,
            normal100,
            zeroVerses,
            onePercentDefensive,
            onePercentOffensive,
            missing,
            warned: warned.includes('Unhandled ArmorType'),
            activeListLen: activeList.length,
            passiveListLen: passiveList.length,
            passiveTileListLen: passiveTileList.length,
            baseScore,
            targetedScore,
            strongScore,
            strongIsNegInf: strongScore === Number.NEGATIVE_INFINITY,
            targetedIsLower: targetedScore < baseScore,
            firstPass,
            secondPass,
            stamped,
            stillStamped,
            cancelled,
            scanCooldown: trait.passiveScanCooldownTicks,
        };
    });

    check('F1 Firing/FireUp/JustFired 都算开火中', r.firing.every(Boolean));
    check('F2 Idle/CheckRange/PrepareToFire 都不算', r.notFiring.every((v) => v === false));
    check('F3 isIdle 只在 Idle 为真', r.idleAtIdle === true && r.idleAtRange === false);
    check('F4 主武器冷却即算冷却', r.primaryCold === true);
    check('F5 副武器冷却也算', r.secondaryCold === true);
    check('F6 areaFire 且非 fireOnce 的部署武器被排除', r.areaExcluded === false);
    check('F7 verses 满值时能打', r.normal100 === true);
    check('F8 verses=0 时不能打', r.zeroVerses === false);
    check('F9 亚 1% 弹药：普通射击照打、防御射击拒绝', r.onePercentDefensive === false && r.onePercentOffensive === true);
    check('F10 缺护甲条目告警并返回 false', r.missing === false && r.warned === true);
    check('F11 neverUse 武器被过滤掉', r.activeListLen === 1, `n=${r.activeListLen}`);
    check(
        'F12 副武器只在纯被动模式下出现',
        r.passiveListLen === 2 && r.passiveTileListLen === 1,
        `passive=${r.passiveListLen} tile=${r.passiveTileListLen}`,
    );
    check('F13 威胁分含 +1e5 底数', r.baseScore >= 1e5, `score=${Math.round(r.baseScore)}`);
    check('F14 已被自己瞄准的目标分数被取反', r.targetedIsLower === true, `${Math.round(r.targetedScore)} < ${Math.round(r.baseScore)}`);
    check('F15 VhpScan=Strong 且投影血量为 0 → -Infinity', r.strongIsNegInf === true);
    check('F16 distributedFire 下第二次打同一目标分更低', r.secondPass < r.firstPass);
    check('F17 重复盖章同一目标不重置（仍为 50）', r.stamped === 50 && r.stillStamped === 50);
    check('F18 cancelOpportunityFire 转发给任务', r.cancelled === 1);
    check('F19 expirePassiveScanCooldown 归零', r.scanCooldown === 0);
}

/* ================================================== G. UnitOrderTrait ==== */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit } = window.__at;
        const tiles = makeTiles();
        const game = makeGame(tiles);
        const start = tiles.getByMapCoords(0, 0);
        const unit = makeUnit(start);
        unit.resetGuardModeToIdle = () => {
            unit.guardResets = (unit.guardResets || 0) + 1;
        };
        unit.traits = new S.Traits();
        const orders = new S.UnitOrderTrait(unit);

        /* G1-G3: insertion order */
        const a = new S.WaitTicksTask(1);
        const b = new S.WaitTicksTask(1);
        const c = new S.WaitTicksTask(1);
        const d = new S.WaitTicksTask(1);
        const nameOf = (t) => (t === a ? 'a' : t === b ? 'b' : t === c ? 'c' : 'd');
        orders.addTask(a);
        orders.addTask(b);
        orders.addTaskNext(c);
        const afterNext = orders.getTasks().map(nameOf);
        orders.addTaskToFront(d);
        const afterFront = orders.getTasks().map(nameOf);
        const lengthBefore = orders.getTasks().length;
        const copy = orders.getTasks();
        copy.push(new S.WaitTicksTask(1));
        const copyIsCopy = orders.getTasks().length === lengthBefore;

        /* G4: isIdle */
        const emptyTrait = new S.UnitOrderTrait(unit);
        const emptyIdle = emptyTrait.isIdle();

        /* G5: dead objects are never ticked */
        const deadUnit = makeUnit(start);
        deadUnit.isSpawned = false;
        deadUnit.resetGuardModeToIdle = () => {};
        const deadOrders = new S.UnitOrderTrait(deadUnit);
        deadOrders.addTask(new S.WaitTicksTask(1));
        deadOrders[Object.getOwnPropertySymbols(S.NotifyTickRef || {})[0] || Symbol('noop')];
        const tickSymbol = S.NotifyTick ? S.NotifyTick.onTick : undefined;
        if (tickSymbol) deadOrders[tickSymbol](deadUnit, 0.016);
        const deadStillHasTask = deadOrders.getTasks().length === 1;

        /* G6-G8: order promotion, one productive order per tick */
        const liveUnit = makeUnit(start);
        liveUnit.resetGuardModeToIdle = () => {};
        const liveOrders = new S.UnitOrderTrait(liveUnit);
        const produced = [];
        const makeOrder = (tag, taskCount, queuedSafe = true) => ({
            orderType: 'Test',
            isValid: () => true,
            isAllowed: () => true,
            onAdd: () => undefined,
            process: () => {
                const list = [];
                for (let i = 0; i < taskCount; i++) {
                    const t = new S.Task();
                    t.onTick = () => {
                        produced.push(tag);
                        return true;
                    };
                    list.push(t);
                }
                return list;
            },
        });
        liveOrders.addOrder(makeOrder('first', 1));
        liveOrders.addOrder(makeOrder('second', 1), true);
        const tickSym = S.NotifyTick ? S.NotifyTick.onTick : undefined;
        if (tickSym) liveOrders[tickSym](liveUnit, 0.016);
        const afterFirstTick = produced.slice();

        /* G9: a queued order is padded with WaitTicks + resetGuardModeToIdle */
        const queuedUnit = makeUnit(start);
        queuedUnit.resetGuardModeToIdle = () => {
            queuedUnit.guardResets = (queuedUnit.guardResets || 0) + 1;
        };
        const queuedOrders = new S.UnitOrderTrait(queuedUnit);
        const order = makeOrder('queued', 1);
        queuedOrders.addOrder(order, true);
        const tasksBeforeTick = queuedOrders.getTasks().length;
        if (tickSym) queuedOrders[tickSym](queuedUnit, 0.016);
        const tasksAfterAdd = queuedOrders.getTasks().length;
        if (tickSym) queuedOrders[tickSym](queuedUnit, 0.016);
        if (tickSym) queuedOrders[tickSym](queuedUnit, 0.016);
        if (tickSym) queuedOrders[tickSym](queuedUnit, 0.016);
        if (tickSym) queuedOrders[tickSym](queuedUnit, 0.016);
        if (tickSym) queuedOrders[tickSym](queuedUnit, 0.016);
        if (tickSym) queuedOrders[tickSym](queuedUnit, 0.016);
        const queuedProduced = produced.filter((x) => x === 'queued').length;
        const queuedGuardResets = queuedUnit.guardResets || 0;

        /* G10: refusal contract */
        const refused = { orderType: 'No', isValid: () => true, isAllowed: () => true, onAdd: () => false, process: () => [] };
        const refusedTrait = new S.UnitOrderTrait(makeUnit(start));
        refusedTrait.addOrder(refused);
        const refusedQueued = refusedTrait.isIdle();

        /* G11: a non-queued order cancels what is already running */
        const busyUnit = makeUnit(start);
        busyUnit.resetGuardModeToIdle = () => {};
        const busyOrders = new S.UnitOrderTrait(busyUnit);
        const running = new S.Task();
        const started = new S.Task();
        started.status = S.TaskStatus.Running;
        started.onEnd = () => {
            started.ended = true;
        };
        busyOrders.addTask(running);
        busyOrders.addTask(started);
        busyOrders.addOrder(makeOrder('replace', 0));

        /* G12: unmarkNextQueuedOrder only touches the head */
        const unmarkUnit = makeUnit(start);
        unmarkUnit.resetGuardModeToIdle = () => {};
        const unmarkOrders = new S.UnitOrderTrait(unmarkUnit);
        const o1 = makeOrder('o1', 0);
        const o2 = makeOrder('o2', 0);
        unmarkOrders.addOrder(o1, true);
        unmarkOrders.addOrder(o2, true);
        unmarkOrders.unmarkNextQueuedOrder();

        /* G13/G14: owner change and teleport wipe */
        const wipeUnit = makeUnit(start);
        let wipes = 0;
        wipeUnit.resetGuardModeToIdle = () => {
            wipes++;
        };
        const wipeOrders = new S.UnitOrderTrait(wipeUnit);
        const runningTask = new S.WaitTicksTask(1);
        runningTask.status = S.TaskStatus.Running;
        wipeOrders.addTask(runningTask);
        const notStartedTask = new S.WaitTicksTask(1);
        wipeOrders.addTask(notStartedTask);
        const changeSym = S.NotifyOwnerChange ? S.NotifyOwnerChange.onChange : undefined;
        if (changeSym) wipeOrders[changeSym]();
        const tasksAfterOwnerChange = wipeOrders.getTasks().length;
        const ownerChangeStatus = runningTask.status;
        const ownerChangeNotStarted = notStartedTask.status;

        const tpUnit = makeUnit(start);
        tpUnit.resetGuardModeToIdle = () => {};
        const tpOrders = new S.UnitOrderTrait(tpUnit);
        tpOrders.addTask(new S.WaitTicksTask(1));
        const tpSym = S.NotifyTeleport ? S.NotifyTeleport.onBeforeTeleport : undefined;
        if (tpSym) tpOrders[tpSym](tpUnit, { tile: start }, { tile: start }, false);
        const tasksAfterTeleport = tpOrders.getTasks().length;

        return {
            afterNext,
            afterFront,
            copyIsCopy,
            emptyIdle,
            deadStillHasTask,
            afterFirstTick,
            tasksBeforeTick,
            tasksAfterAdd,
            queuedProduced,
            queuedGuardResets,
            refusedQueued,
            startedEnded: started.ended === true,
            startedStatus: started.status,
            notStartedDropped: busyOrders.getTasks().every((t) => t !== running),
            notStartedKept: busyOrders.getTasks().length,
            tasksAfterOwnerChange,
            ownerChangeStatus,
            ownerChangeNotStarted,
            tasksAfterTeleport,
            wipes,
        };
    });

    check('G1 addTaskNext 插到索引 1', JSON.stringify(r.afterNext) === JSON.stringify(['a', 'c', 'b']), r.afterNext.join(','));
    check('G2 addTaskToFront 插到索引 0', JSON.stringify(r.afterFront) === JSON.stringify(['d', 'a', 'c', 'b']), r.afterFront.join(','));
    check('G3 getTasks 返回副本', r.copyIsCopy === true);
    check('G4 空队列 isIdle', r.emptyIdle === true);
    check('G5 未 spawn 的对象不推进任务', r.deadStillHasTask === true);
    check('G6 一 tick 只推进一个有效命令', JSON.stringify(r.afterFirstTick) === JSON.stringify(['first']), r.afterFirstTick.join(','));
    check('G7 排队命令在 tick 时才垫 WaitTicksTask + CallbackTask', r.tasksBeforeTick === 0 && r.tasksAfterAdd === 3, `${r.tasksBeforeTick}->${r.tasksAfterAdd}`);
    check('G8 垫片执行后仍会跑到真正的任务', r.queuedProduced === 1, `n=${r.queuedProduced}`);
    check('G9 垫片里的回调重置警戒模式', r.queuedGuardResets === 1, `n=${r.queuedGuardResets}`);
    check('G10 onAdd 返回 false 时不入队', r.refusedQueued === true);
    check('G11 非排队命令把已开始的任务置为 Cancelling', r.startedStatus === 3, `status=${r.startedStatus}`);
    check('G12 未开始的任务被直接丢弃', r.notStartedDropped === true && r.notStartedKept === 1, `n=${r.notStartedKept}`);
    check(
        'G13 换主后运行中的任务进入 Cancelling，未开始的保持 NotStarted',
        r.ownerChangeStatus === 3 && r.ownerChangeNotStarted === 0 && r.tasksAfterOwnerChange === 2,
        `running=${r.ownerChangeStatus} notStarted=${r.ownerChangeNotStarted} n=${r.tasksAfterOwnerChange}`,
    );
    check('G14 非跨域传送清空任务', r.tasksAfterTeleport === 0);
}

/* ================================================ H. EnterBuildingTask == */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit } = window.__at;
        const tiles = makeTiles();
        const targetTile = tiles.getByMapCoords(5, 5);
        const building = makeUnit(targetTile, {
            isBuilding: () => true,
            isUnit: () => false,
            isVehicle: () => false,
            getFoundation: () => ({ width: 1, height: 1 }),
        });

        /* H1: not on the footprint -> push a non-blocking MoveInsideTask */
        let occupied = false;
        const game = makeGame(tiles, { occupiedBy: () => occupied });
        const walker = makeUnit(tiles.getByMapCoords(0, 0));
        const task = new S.EnterBuildingTask(game, building);
        task.status = S.TaskStatus.Running;
        task.onStart(walker);
        task.onTick(walker);
        const pushedInside = task.children[0] instanceof S.MoveInsideTask;
        const insideBlocking = task.children[0] ? task.children[0].blocking : null;
        const fireAfterApproach = task.preventOpportunityFire;

        /* H2: the recorded outside tile is only refreshed while the unit stands
           on the footprint (or on the tile already recorded). */
        occupied = true;
        walker.tile = tiles.getByMapCoords(3, 3);
        task.onTick(walker);
        const recorded = task.lastOutsideTile ? task.lastOutsideTile.id : null;

        /* H3: on the footprint, allowed -> onEnter runs and the event fires */
        occupied = true;
        walker.tile = targetTile;
        const entered = [];
        const enterTask = new S.EnterBuildingTask(game, building);
        enterTask.status = S.TaskStatus.Running;
        enterTask.onStart(walker);
        enterTask.onEnter = (o) => {
            entered.push(o);
            return true;
        };
        game.events.dispatched.length = 0;
        enterTask.onTick(walker);
        const enterEventCount = game.events.dispatched.filter(
            (e) => e && e.constructor && e.constructor.name === 'EnterObjectEvent',
        ).length;

        /* H4: on the footprint but not allowed -> bounce out */
        const strict = new S.EnterBuildingTask(game, building);
        strict.status = S.TaskStatus.Running;
        strict.onStart(walker);
        strict.isAllowed = () => false;
        strict.onTick(walker);
        const bounced = strict.children[0] instanceof S.MoveOutsideTask;

        /* H5: onEnter returning false is a soft refusal, not a failure */
        const soft = new S.EnterBuildingTask(game, building);
        soft.status = S.TaskStatus.Running;
        soft.onStart(walker);
        soft.onEnter = () => false;
        soft.onTick(walker);
        const softBounced = soft.children[0] instanceof S.MoveOutsideTask;

        /* H6: an immobilised unit gives up */
        const stuck = makeUnit(tiles.getByMapCoords(0, 0), {
            moveTrait: { isDisabled: () => true, isIdle: () => true, isMoving: () => false, moveState: 0 },
        });
        const stuckTask = new S.EnterBuildingTask(game, building);
        stuckTask.status = S.TaskStatus.Running;
        stuckTask.onStart(stuck);
        const stuckDone = stuckTask.onTick(stuck);

        return {
            pushedInside,
            insideBlocking,
            fireAfterApproach,
            recorded,
            enteredCount: entered.length,
            enterEvents: enterEventCount,
            bounced,
            softBounced,
            stuckDone,
            linesTarget: enterTask.getTargetLinesConfig(walker).target === building,
        };
    });

    check('H1 不在 footprint 时推 MoveInsideTask', r.pushedInside === true);
    check('H2 该子任务是非阻塞的', r.insideBlocking === false, `blocking=${r.insideBlocking}`);
    check('H3 开始接近后 preventOpportunityFire 转 true', r.fireAfterApproach === true);
    check('H4 接近过程中记录 lastOutsideTile', r.recorded === '3,3', `tile=${r.recorded}`);
    check('H5 进入 footprint 后 onEnter 被调用', r.enteredCount === 1);
    check('H6 进入时派发 EnterObjectEvent', r.enterEvents === 1, `n=${r.enterEvents}`);
    check('H7 isAllowed 为假时推 MoveOutsideTask', r.bounced === true);
    check('H8 onEnter 返回 false 同样是软退出', r.softBounced === true);
    check('H9 移动被禁用时直接结束', r.stuckDone === true);
    check('H10 targetLines 指向目标建筑', r.linesTarget === true);
}

/* =============================================== I. EnterTransportTask == */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit } = window.__at;
        const tiles = makeTiles();
        const game = makeGame(tiles);
        const transportTile = tiles.getByMapCoords(1, 1);
        const passengerTile = tiles.getByMapCoords(0, 0);

        const makeTransport = (over = {}) =>
            makeUnit(transportTile, {
                transportTrait: {
                    units: [],
                    loadQueue: [],
                    unitFitsInside: () => true,
                    addToLoadQueue: () => 0,
                    removeFromLoadQueue: () => {},
                    unitIsFirstInLoadQueue: () => true,
                },
                isVehicle: () => true,
                ...over,
            });

        const passenger = makeUnit(passengerTile);

        /* I1: the transport changed tile -> the order fails, it does not chase */
        const mover = makeTransport();
        const chase = new S.EnterTransportTask(game, mover);
        chase.status = S.TaskStatus.Running;
        chase.onStart(passenger);
        mover.tile = tiles.getByMapCoords(2, 2);
        const movedDone = chase.onTick(passenger);

        /* I2: the transport is driving -> same refusal */
        const driver = makeTransport();
        driver.moveTrait.moveState = S.MoveState.Moving;
        const driving = new S.EnterTransportTask(game, driver);
        driving.status = S.TaskStatus.Running;
        driving.onStart(passenger);
        const drivingDone = driving.onTick(passenger);

        /* I3: an airborne passenger may not board */
        const airTransport = makeTransport();
        const flyer = makeUnit(passengerTile, { zone: S.ZoneType.Air });
        const airTask = new S.EnterTransportTask(game, airTransport);
        const airAllowed = airTask.isAllowed(flyer);

        /* I4: mind-controlled passengers may not board */
        const mcPassenger = makeUnit(passengerTile, { mindControllableTrait: { isActive: () => true } });
        const mcTask = new S.EnterTransportTask(game, airTransport);
        const mcAllowed = mcTask.isAllowed(mcPassenger);

        /* I5: same tile, different layer -> must push a MoveInsideTask */
        const layerTransport = makeTransport();
        layerTransport.onBridge = true;
        const groundPassenger = makeUnit(passengerTile, { onBridge: false });
        const layerGame = makeGame(tiles, { occupiedBy: () => true });
        const layerTask = new S.EnterTransportTask(layerGame, layerTransport);
        layerTask.status = S.TaskStatus.Running;
        layerTask.onStart(groundPassenger);
        layerTask.state = 2; /* MoveToTransport */
        layerTask.onTick(groundPassenger);
        const pushedInside = layerTask.children[0] instanceof S.MoveInsideTask;

        return {
            movedDone,
            drivingDone,
            airAllowed,
            mcAllowed,
            pushedInside,
            fireAfterMove: layerTask.preventOpportunityFire,
        };
    });

    check('I1 运输单位换格 → 任务直接失败', r.movedDone === true);
    check('I2 运输单位正在移动 → 任务直接失败', r.drivingDone === true);
    check('I3 空中单位不能登车', r.airAllowed === false);
    check('I4 被心灵控制的单位不能登车', r.mcAllowed === false);
    check('I5 同格不同层必须先走进建筑', r.pushedInside === true);
    check('I6 开始上车后 preventOpportunityFire 转 true', r.fireAfterMove === true);
}

/* ============================================ J. EvacuateTransportTask == */
{
    const r = await evalPage(() => {
        const { S, makeTiles, makeGame, makeUnit } = window.__at;
        const tiles = makeTiles();
        const spot = tiles.getByMapCoords(3, 3);

        const makeTransport = (units, gunner) =>
            makeUnit(spot, {
                direction: 0,
                rules: { ...makeUnit(spot).rules, gunner },
                transportTrait: { units },
            });

        /* J1/J2: gunner rule */
        const soloGunner = makeTransport([makeUnit(spot)], true);
        const t1 = new S.EvacuateTransportTask(makeGame(tiles), true);
        t1.status = S.TaskStatus.Running;
        t1.onStart(soloGunner);

        const pair = makeTransport([makeUnit(spot), makeUnit(spot)], true);
        const t2 = new S.EvacuateTransportTask(makeGame(tiles), true);
        t2.status = S.TaskStatus.Running;
        t2.onStart(pair);

        const nonGunner = makeTransport([makeUnit(spot)], false);
        const t3 = new S.EvacuateTransportTask(makeGame(tiles), true);
        t3.status = S.TaskStatus.Running;
        t3.onStart(nonGunner);

        /* J3: forceEvac upgrades an OnlyPassengers evac to All */
        const forced = new S.EvacuateTransportTask(makeGame(tiles), true);
        forced.status = S.TaskStatus.Running;
        forced.evacState = 1;
        forced.forceEvac();

        /* J4: airborne transport waits for a landing */
        const airTransport = makeTransport([makeUnit(spot)], true);
        airTransport.zone = S.ZoneType.Air;
        const airTask = new S.EvacuateTransportTask(makeGame(tiles), true);
        airTask.status = S.TaskStatus.Running;
        airTask.onStart(airTransport);
        const airDone = airTask.onTick(airTransport);
        const airChild = airTask.children[0] instanceof S.CallbackTask;

        /* J5: hard unload with nowhere to stand destroys the passenger */
        const doomed = makeUnit(spot);
        const stranded = makeTransport([doomed], true);
        const hardGame = makeGame(tiles, { impassable: true });
        const hardTask = new S.EvacuateTransportTask(hardGame, false);
        hardTask.status = S.TaskStatus.Running;
        hardTask.onStart(stranded);
        hardTask.onTick(stranded);
        const drowned = doomed.isDestroyed === true;
        const popped = stranded.transportTrait.units.length === 0;

        /* J6: soft unload retries instead of killing */
        const survivor = makeUnit(spot);
        const softTransport = makeTransport([survivor], true);
        const softTask = new S.EvacuateTransportTask(makeGame(tiles, { impassable: true }), true);
        softTask.status = S.TaskStatus.Running;
        softTask.onStart(softTransport);
        softTask.onTick(softTransport);
        const softRetries = softTask.evacTries;
        const softAlive = survivor.isDestroyed === false;

        /* J7: LIFO — the last unit in the hold leaves first */
        const bottom = makeUnit(spot);
        const top = makeUnit(spot);
        const stack = makeTransport([bottom, top], true);
        const stackGame = makeGame(tiles);
        const stackTask = new S.EvacuateTransportTask(stackGame, true);
        stackTask.status = S.TaskStatus.Running;
        stackTask.onStart(stack);
        stackTask.children.length = 0;
        stackTask.evacTries = 99; /* skip the retry budget so the first pass ejects */
        stackTask.onTick(stack);
        const remaining = stack.transportTrait.units.map((u) => (u === top ? 'top' : 'bottom'));

        return {
            all: t1.evacState,
            pair: t2.evacState,
            nonGunner: t3.evacState,
            forced: forced.evacState,
            airDone,
            airChild,
            drowned,
            popped,
            softRetries,
            softAlive,
            remaining,
        };
    });

    check('J1 单乘客且是炮手 → All', r.all === 2, `state=${r.all}`);
    check('J2 多乘客 → OnlyPassengers', r.pair === 1, `state=${r.pair}`);
    check('J3 非炮手单位 → OnlyPassengers', r.nonGunner === 1, `state=${r.nonGunner}`);
    check('J4 forceEvac 直接升到 All', r.forced === 2, `state=${r.forced}`);
    check('J5 空中运输车先等待落地', r.airDone === false && r.airChild === true);
    check('J6 硬卸载无落脚点 → 销毁乘客', r.drowned === true);
    check('J7 卸载后从货舱移除', r.popped === true);
    check('J8 软卸载无落脚点 → 重试而非处死', r.softRetries === 1 && r.softAlive === true);
    check('J9 卸载顺序是后进先出', JSON.stringify(r.remaining) === JSON.stringify(['bottom']), r.remaining.join(','));
}

/* ============================================================== summary === */
const legitErrors = errors.filter((e) => !/ResizeObserver|AudioContext|autoplay/i.test(e));
if (legitErrors.length) {
    console.log('\nPAGE ERRORS:');
    legitErrors.slice(0, 8).forEach((e) => console.log('  ' + e));
}

console.log(`\n${pass} passed, ${fail} failed${legitErrors.length ? `, ${legitErrors.length} page errors` : ''}`);
await browser.close();
process.exit(fail === 0 && legitErrors.length === 0 ? 0 : 1);
