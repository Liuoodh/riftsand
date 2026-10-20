/**
 * Port of redalert2/src/game/gameobject/task/AttackTask.ts (682 lines).
 *
 * The attack order. One task, one target, one weapon — and a five-state machine
 * (`AttackState` lives in `AttackTrait`, which is where the *ambient* half of
 * combat lives) that runs until the target dies, the unit dies, or the player
 * issues something else:
 *
 *     Idle → CheckRange → PrepareToFire → FireUp? → Firing → JustFired → …
 *
 * Read the tick in this order, because the state tests are sequential and
 * several of them recurse:
 *
 * **A. Cancel.** A cancelling task with `attackState !== FireUp` drops its move
 * child and finishes immediately. `FireUp` is the exception: the unit is already
 * committed to the launch animation and must be allowed to finish it, otherwise
 * a retreating aircraft fires nothing and still plays the sound.
 *
 * **B. FireUp → Firing.** `JustFired` and `FireUp` are one-tick ping-pong states
 * whose only purpose is to give the renderer a frame between "animation started"
 * and "weapon went off". `justFiredUp` exists so that the *first* Firing tick
 * re-validates everything: a target that walked behind a cliff during the
 * animation must not still be shot.
 *
 * **C. Firing.** Every veto in this block is a real retail rule: an indirect
 * target whose tree was cut down, a limbo-launched unit that is already full or
 * airborne, a high-bridge height mismatch, the Prism Tower's support-beam damage
 * multiplier, a paralysed spawner, empty ammo, and the limbo "forced move" that
 * has to cancel the approach child before the shot. Only then `weapon.fire()`.
 *
 * **D. Target upkeep.** `needsTargetUpdate` (an explicit switch from
 * `AttackMoveTargetTask`), `replacedBy` (a target that deployed or unpacked),
 * then `isValidTarget`/`shouldDropTarget` and a weapon re-selection if the
 * current one can no longer hit. `lastTargetTpCheck` invalidates the target when
 * it *teleported* since our last check — that is how a chrono miner avoids being
 * tracked across the map.
 *
 * **E. CheckRange.** The pathing heart. If we cannot shoot from here, either
 * retarget the approach child or push a new `MoveInWeaponRangeTask`. Three
 * details:
 *   - `moveAttempts` counts *failed* moves, and `> MAX_MOVE_ATTEMPTS` (3) means
 *     four failures, not three. It is reset whenever the unit actually changed
 *     tile, so a slow-but-progressing approach is never aborted.
 *   - the `ticksToWait` estimate is `ceil((distance - (range + 1)) / (mySpeed +
 *     theirSpeed))` and is clamped to one second. This is what stops a unit from
 *     re-planning a path every single tick while a target runs away.
 *   - `leashTiles` is the guard-area leash: exceeding it cancels the approach
 *     and ends the task, which is how a defending unit returns home instead of
 *     chasing a jeep across the map.
 *
 * **F. PrepareToFire.** Facing. Turrets aim independently of the hull
 * (`desiredFacing`), aircraft rotate in place, and infantry simply snap. The
 * tolerance is 11.25° normally and 45° (`4 × 11.25`) for projectile weapons,
 * because a projectile leaves at an angle and a hitscan does not.
 *
 * The final block fires the weapon (or, for suicide weapons, kills the unit).
 * `obj.art.fireUp` inserts a one-shot `WaitTicksTask` so the muzzle flash has
 * time to play; everything else goes straight to `Firing` by recursion.
 *
 * `IS_ATTACK_TASK` is a `Symbol.for` marker rather than `instanceof` because
 * production builds mangle class names and several systems only need "is this an
 * attack order". `instanceof AttackTask` is still used *inside* the class where
 * the real type is available.
 */
import { Task } from './system/Task';
import { RangeHelper } from '../unit/RangeHelper';
import { WaitMinutesTask } from './system/WaitMinutesTask';
import { WeaponType } from '../../type/WeaponType';
import { MoveInWeaponRangeTask } from './move/MoveInWeaponRangeTask';
import { FacingUtil } from '../unit/FacingUtil';
import { TurnTask } from './TurnTask';
import { WaitTicksTask } from './system/WaitTicksTask';
import { AttackState } from '../trait/AttackTrait';
import { GameObject } from '../GameObject';
import { LosHelper } from '../unit/LosHelper';
import { MoveResult } from '../trait/MoveTrait';
import { GameSpeed } from '../../GameSpeed';
import { Coords } from '../../Coords';
import { ObjectType } from '../../type/ObjectType';
import { RadialTileFinder } from '../../map/tileFinder/RadialTileFinder';
import { MovePositionHelper } from '../unit/MovePositionHelper';
import { ZoneType } from '../unit/ZoneType';
import { MovementZone } from '../../type/MovementZone';
import { TaskStatus } from './system/TaskStatus';
import { MoveTask } from './move/MoveTask';
import { Vector3 } from '../../math/Vector3';
import { Vector2 } from '../../math/Vector2';

const MAX_MOVE_ATTEMPTS = 3;
const FACING_TOLERANCE = 11.25;
const FACING_TOLERANCE_PROJECTILE = 4 * FACING_TOLERANCE;

interface AttackOptions {
    force?: boolean;
    passive?: boolean;
    holdGround?: boolean;
    leashTiles?: number;
    disallowTurning?: boolean;
}

interface TargetLinesConfig {
    target?: GameObject;
    pathNodes: Array<{ tile: any; onBridge?: any }>;
    isAttack?: boolean;
}

interface Position {
    tile: any;
    onBridge?: any;
}

// Class names are mangled by esbuild in production builds, so anything that
// wants to recognise an attack task must not rely on constructor.name.
export const IS_ATTACK_TASK = Symbol.for('ra2.isAttackTask');

export class AttackTask extends Task {
    [IS_ATTACK_TASK] = true;
    public game: any;
    private target: any;
    private weapon: any;
    public options: AttackOptions;
    private moveExecuted: boolean = false;
    private moveAttempts: number = 0;
    private rangeCheckCooldown: number = 0;
    private lastInRangeTargetPosition: Vector3 = new Vector3();
    private lastInRangeSelfPosition: Vector3 = new Vector3();
    private initialIndirectTarget: boolean = false;
    private forceDropTarget: boolean = false;
    private rangeHelper: RangeHelper;
    private losHelper: LosHelper;
    private targetLinesConfig: TargetLinesConfig;
    private needsTargetUpdate?: any;
    private lastValidTargetPosition?: Position;
    private initialTargetOwner?: any;
    private initialSelfPosition?: Position;
    private lastTargetTpCheck?: number;
    private lastSelfTileBeforeMove?: any;
    private lastSelfMoveTargetTile?: any;

    constructor(game: any, target: any, weapon: any, options: AttackOptions = {}) {
        super();
        this.game = game;
        this.target = target;
        this.weapon = weapon;
        this.options = options;
        this.rangeHelper = new RangeHelper(game.map.tileOccupation);
        this.losHelper = new LosHelper(game.map.tiles, game.map.tileOccupation);
        this.targetLinesConfig = { pathNodes: [] };
        this.updateTargetLines(this.target, true);
    }

    duplicate(): AttackTask {
        return new AttackTask(this.game, this.target, this.weapon, this.options);
    }

    getWeapon(): any {
        return this.weapon;
    }

    setWeapon(weapon: any): void {
        this.weapon = weapon;
    }

    setForceAttack(force: boolean): void {
        this.options.force = force;
    }

    requestTargetUpdate(target: any): void {
        if (!this.target.equals(target)) {
            this.needsTargetUpdate = target;
        }
    }

    /**
     * Called both from `onStart` and whenever the target is swapped. It records
     * the *last known good* position, which the CheckRange state falls back to
     * when the live target becomes invalid — that is why a unit keeps shelling
     * the spot where a cloaked tank disappeared instead of forgetting it.
     *
     * `initialIndirectTarget` distinguishes "attacking a thing" from "attacking
     * a piece of scenery" (a tree, an ore patch). The latter is allowed to
     * vanish, and when it does the whole task cancels rather than re-targeting.
     */
    public onTargetChange(obj: any): void {
        const attackTrait = obj.attackTrait;
        const target = this.target;
        attackTrait.currentTarget = target;
        this.lastValidTargetPosition = target.obj ? { tile: target.tile, onBridge: target.getBridge() } : undefined;
        this.initialTargetOwner = target.obj?.isTechno() ? target.obj.owner : undefined;
        this.initialIndirectTarget =
            !target.obj &&
            this.game.map.tileOccupation
                .getObjectsOnTile(target.tile)
                .some((e: any) => (e.isOverlay() && !e.isBridgePlaceholder()) || e.isTerrain());
        this.updateTargetLines(target, true);
    }

    private updateTargetLines(target: any, isAttack: boolean): void {
        this.targetLinesConfig.target = target.obj;
        this.targetLinesConfig.pathNodes = target.obj
            ? []
            : [{ tile: target.tile, onBridge: target.getBridge() }];
        this.targetLinesConfig.isAttack = isAttack;
    }

    onStart(obj: any): void {
        if (!obj.attackTrait) {
            throw new Error(`Object ${obj.name} has no attack trait`);
        }
        if (obj.ammo === 0) {
            this.cancel();
            return;
        }
        const tileOccupation = this.game.map.tileOccupation;
        obj.attackTrait.attackState = AttackState.CheckRange;
        this.onTargetChange(obj);
        this.initialSelfPosition = {
            tile: obj.tile,
            onBridge: obj.isUnit() && obj.onBridge ? tileOccupation.getBridgeOnTile(obj.tile) : undefined,
        };
        // Limbo launch = the unit leaves the map to attack (Tanya, the Dolphin).
        // Attacking bare ground with it is meaningless, so the target is dropped
        // and the fallback melee position is remembered for the walk-back.
        if (this.weapon.rules.limboLaunch && obj.isUnit() && !this.target.obj) {
            this.forceDropTarget = true;
            const { reachable, fallback } = this.findReachableMeleePosition(
                this.target.tile,
                !!this.target.getBridge(),
                { width: 1, height: 1 },
                obj,
            );
            if (!reachable && fallback) {
                this.lastValidTargetPosition = fallback;
                this.updateTargetLines(this.game.createTarget(fallback.onBridge, fallback.tile), false);
            }
        }
        if (
            this.weapon.rules.limboLaunch &&
            this.target.obj?.isTechno() &&
            obj.isUnit() &&
            !this.rangeHelper.isInWeaponRange(obj, this.target.obj, this.weapon, this.game.rules)
        ) {
            const { reachable, fallback } = this.findReachableMeleePosition(
                this.target.obj.tile,
                this.target.obj.isUnit() && this.target.obj.onBridge,
                this.target.obj.getFoundation(),
                obj,
            );
            if (!reachable) {
                // A unit with a waypoint path is *travelling*; the limbo attack
                // must not hijack the move. Otherwise the order is converted to
                // an attack-move to the last reachable melee spot.
                if ((obj.unitOrderTrait.waypointPath?.waypoints?.length ?? 0) > 1) {
                    this.cancel();
                } else {
                    this.forceDropTarget = true;
                    if (fallback) {
                        this.lastValidTargetPosition = fallback;
                        this.updateTargetLines(this.game.createTarget(fallback.onBridge, fallback.tile), false);
                    }
                }
            }
        }
        // A flying unit that can hover and is already in range lands first: an
        // aircraft cannot shoot ground targets from the air with a ground weapon,
        // and `MoveTask` to its own tile is the "descend here" idiom.
        if (
            this.rangeHelper.isInWeaponRange(obj, this.target.obj ?? this.target.tile, this.weapon, this.game.rules) &&
            obj.isUnit() &&
            obj.rules.movementZone === MovementZone.Fly &&
            obj.zone !== ZoneType.Air &&
            (obj.rules.hoverAttack || obj.isAircraft())
        ) {
            this.children.push(new MoveTask(this.game, obj.tile, false).setCancellable(false));
        }
    }

    /**
     * Ring search for a spot from which `obj` could melee the target. Returns the
     * first *reachable* tile that is inside weapon range, plus a `fallback` — any
     * reachable tile that is not in range — so the caller can at least walk in
     * the right direction when the target is completely walled off.
     *
     * Note both the ground layer and (when the tile has a bridge) the bridge
     * layer are probed, and that `fallback` keeps the *first* hit rather than the
     * closest: it is a direction hint, not a destination.
     */
    private findReachableMeleePosition(
        targetTile: any,
        onBridge: boolean,
        foundation: any,
        obj: any,
    ): { reachable: any; fallback?: Position } {
        const map = this.game.map;
        const tileOccupation = map.tileOccupation;
        const targetBridge = onBridge ? tileOccupation.getBridgeOnTile(targetTile) : undefined;
        const movePositionHelper = new MovePositionHelper(map);
        const isFlying = obj.rules.movementZone === MovementZone.Fly;
        const isPassable = (tile: any, bridge?: any): boolean =>
            isFlying ||
            (map.terrain.getPassableSpeed(tile, obj.rules.speedType, obj.isInfantry(), !!bridge) > 0 &&
                movePositionHelper.isEligibleTile(tile, bridge, targetBridge, targetTile) &&
                !map.terrain.findObstacles({ tile, onBridge: bridge }, obj).length);
        let fallback: Position | undefined;
        const tileFinder = new RadialTileFinder(
            map.tiles,
            map.mapBounds,
            targetTile,
            foundation,
            1,
            Math.ceil(this.weapon.rules.range),
            (tile: any) => {
                let found = false;
                if (isPassable(tile, undefined)) {
                    fallback = fallback ?? { tile, onBridge: undefined };
                    found = true;
                }
                if (tile.onBridgeLandType !== undefined) {
                    const bridge = tileOccupation.getBridgeOnTile(tile);
                    if (isPassable(tile, bridge)) {
                        fallback = fallback ?? { tile, onBridge: bridge };
                        found = true;
                    }
                }
                return !!found && this.rangeHelper.isInWeaponRange(obj, targetTile, this.weapon, this.game.rules, tile);
            },
        );
        return { reachable: tileFinder.getNextTile(), fallback };
    }

    onEnd(obj: any): void {
        if (obj.isVehicle() && obj.turretTrait) {
            obj.turretTrait.desiredFacing = obj.direction;
        }
        obj.attackTrait.attackState = AttackState.Idle;
        obj.attackTrait.currentTarget = undefined;
        const prismType = this.game.rules.general.prism.type;
        if (obj.isBuilding() && obj.name === prismType && this.weapon.type !== WeaponType.Secondary) {
            this.countSupportBeamsAndFireDownTowers(obj, prismType);
        }
        if (this.weapon.rules.limboLaunch) {
            obj.attackTrait.expirePassiveScanCooldown();
        }
        if (obj.isInfantry() || obj.isVehicle()) {
            obj.isFiring = false;
        }
        if (this.weapon.hasBurstsLeft()) {
            this.weapon.resetBursts();
        }
    }

    /**
     * Only aircraft may force-cancel an attack, and only when their move child
     * agrees — a bomber committed to a bombing run cannot be yanked out of it
     * mid-pass, because that would leave the plane pointed at nothing with its
     * bombs already released (`MoveInWeaponRangeTask.forceCancel` explains the
     * bomber-specific half of this contract).
     */
    forceCancel(obj: any): boolean {
        if (obj.rules.movementZone !== MovementZone.Fly) {
            return false;
        }
        if (!this.cancellable || this.children.some((task) => !task.cancellable)) {
            return false;
        }
        if (this.status === TaskStatus.Running || this.status === TaskStatus.Cancelling) {
            const moveTasks = this.children.filter((task) => task instanceof MoveTask);
            if (moveTasks.some((task) => !(task as MoveTask).forceCancel(obj))) {
                return false;
            }
            this.onEnd(obj);
            if (obj.isInfantry() || obj.isVehicle()) {
                obj.isFiring = false;
            }
        }
        this.status = TaskStatus.Cancelled;
        return true;
    }

    onTick(obj: any): boolean {
        const attackTrait = obj.attackTrait;
        if ((obj.isInfantry() || obj.isVehicle()) && attackTrait.attackState !== AttackState.Firing) {
            obj.isFiring = false;
        }
        let targetObj = this.target.obj;
        const moveTask = this.children.find((task) => task instanceof MoveInWeaponRangeTask) as
            | MoveInWeaponRangeTask
            | undefined;
        if (this.isCancelling() && attackTrait.attackState !== AttackState.FireUp) {
            if (!obj.airSpawnTrait?.isLaunchingMissiles()) {
                moveTask?.cancel();
            }
            return true;
        }
        let justFiredUp = false;
        if (attackTrait.attackState === AttackState.FireUp) {
            if (attackTrait.isDisabled()) {
                return true;
            }
            attackTrait.attackState = AttackState.Firing;
            justFiredUp = true;
        }
        if (attackTrait.attackState === AttackState.Firing) {
            // An indirect target (a tree, an ore patch) that no longer exists at
            // the remembered tile: the whole order is pointless now.
            if (
                this.initialIndirectTarget &&
                !this.game.map
                    .getObjectsOnTile(this.target.tile)
                    .find((e: any) => (e.isOverlay() && !e.isBridgePlaceholder()) || e.isTerrain())
            ) {
                this.cancel();
                return this.onTick(obj);
            }
            if (justFiredUp) {
                const targetOrTile = this.target.obj || this.target.tile;
                if (
                    !this.game.isValidTarget(this.target.obj) ||
                    this.shouldDropTarget(this.target.obj) ||
                    !this.weapon.targeting.canTarget(
                        this.target.obj,
                        this.target.tile,
                        this.game,
                        !!this.options.force,
                        !!this.options.passive,
                    ) ||
                    !this.rangeHelper.isInWeaponRange(obj, targetOrTile, this.weapon, this.game.rules) ||
                    !this.losHelper.hasLineOfSight(obj, targetOrTile, this.weapon)
                ) {
                    attackTrait.attackState = AttackState.CheckRange;
                    return this.onTick(obj);
                }
            }
            if (this.weapon.rules.limboLaunch) {
                // A limbo attacker cannot hit a unit it is *inside* of, nor one
                // in the air when it is a ground unit.
                if (
                    (targetObj?.isVehicle() || targetObj?.isAircraft()) &&
                    targetObj.parasiteableTrait?.isInfested()
                ) {
                    return true;
                }
                if (obj.rules.movementZone !== MovementZone.Fly && targetObj?.isUnit() && targetObj.zone === ZoneType.Air) {
                    return true;
                }
            }
            // High bridges are their own layer: a unit on the deck cannot shoot a
            // unit under it, even though both stand on the same (rx, ry).
            if (
                this.target.tile.onBridgeLandType &&
                obj.tile.onBridgeLandType &&
                obj.isUnit() &&
                (this.game.map.tileOccupation.getBridgeOnTile(this.target.tile)?.isHighBridge() ||
                    this.game.map.tileOccupation.getBridgeOnTile(obj.tile)?.isHighBridge())
            ) {
                const targetOnBridge = targetObj
                    ? targetObj.isUnit() && (targetObj.zone === ZoneType.Air || targetObj.onBridge)
                    : this.target.isBridge();
                const selfOnBridge = obj.zone === ZoneType.Air || obj.onBridge;
                if (targetOnBridge !== selfOnBridge) {
                    return true;
                }
            }
            let damageMultiplier = 1;
            const prismType = this.game.rules.general.prism.type;
            if (obj.isBuilding() && obj.name === prismType && this.weapon.type !== WeaponType.Secondary) {
                const supportCount = this.countSupportBeamsAndFireDownTowers(obj, prismType);
                damageMultiplier = 1 + supportCount * this.game.rules.general.prism.supportModifier;
            }
            if (
                this.weapon.rules.spawner &&
                (obj.isVehicle() || obj.isAircraft()) &&
                obj.parasiteableTrait?.isParalyzed()
            ) {
                return true;
            }
            if (obj.ammo === 0) {
                if (obj.isAircraft() && (obj.rules.fighter || obj.rules.spawned)) {
                    moveTask?.cancel();
                }
                return true;
            }
            let forcedMove = false;
            if (this.weapon.rules.limboLaunch && moveTask) {
                if (!moveTask.forceCancel(obj)) return false;
                obj.moveTrait.lastTargetOffset = undefined;
                obj.moveTrait.lastVelocity = undefined;
                forcedMove = true;
            }
            this.weapon.fire(this.target, this.game, damageMultiplier);
            if (forcedMove) {
                return true;
            }
            if (this.weapon.rules.fireOnce) {
                return true;
            }
            if (this.options.passive && obj.rules.distributedFire) {
                return true;
            }
            attackTrait.attackState = AttackState.JustFired;
            return false;
        }
        if (attackTrait.attackState === AttackState.JustFired) {
            attackTrait.attackState = AttackState.PrepareToFire;
            return this.onTick(obj);
        }
        if (this.needsTargetUpdate) {
            this.target = this.needsTargetUpdate;
            targetObj = this.target.obj;
            this.needsTargetUpdate = undefined;
            this.onTargetChange(obj);
            if (!targetObj) {
                moveTask?.retarget(this.target.tile, !!this.target.getBridge());
            }
        }
        if (targetObj?.isTechno() && targetObj.replacedBy) {
            const newTarget = this.game.createTarget(targetObj.replacedBy, targetObj.replacedBy.tile);
            this.target = newTarget;
            targetObj = targetObj.replacedBy;
            this.onTargetChange(obj);
        }
        let isValidTarget = this.game.isValidTarget(targetObj) && !this.shouldDropTarget(targetObj);
        if (isValidTarget) {
            let canTarget = this.weapon.targeting.canTarget(
                targetObj,
                this.target.tile,
                this.game,
                !!this.options.force,
                !!this.options.passive,
            );
            if (!canTarget || !obj.armedTrait.isEquippedWithWeapon(this.weapon)) {
                const newWeapon = attackTrait.selectWeaponVersus(
                    obj,
                    this.target,
                    this.game,
                    this.options.force,
                    this.options.passive,
                );
                if (newWeapon) {
                    this.setWeapon(newWeapon);
                    if (attackTrait.attackState !== AttackState.CheckRange) {
                        attackTrait.attackState = AttackState.CheckRange;
                        return this.onTick(obj);
                    }
                    canTarget = true;
                } else {
                    canTarget = false;
                }
            }
            isValidTarget = canTarget;
        }
        if (isValidTarget) {
            // A target that teleported since the last check is not the same
            // target: drop it and re-range rather than tracking an afterimage.
            const lastCheck = this.lastTargetTpCheck;
            if (targetObj?.isUnit() && lastCheck && targetObj.moveTrait.lastTeleportTick >= lastCheck) {
                isValidTarget = false;
                this.rangeCheckCooldown = 0;
            } else {
                this.lastTargetTpCheck = this.game.currentTick;
            }
        }
        if (isValidTarget && targetObj) {
            this.lastValidTargetPosition = { tile: targetObj.tile, onBridge: this.target.getBridge() };
        }
        if (!isValidTarget) {
            this.targetLinesConfig.isAttack = false;
        }
        if (attackTrait.attackState === AttackState.CheckRange) {
            if (this.rangeCheckCooldown > 0) {
                this.rangeCheckCooldown--;
                return false;
            }
            // Buildings are ranged against their centre tile, everything else
            // against its own tile. When the target went invalid, the last known
            // good position is used instead — so the unit still closes in.
            const effectiveTarget = this.target.obj
                ? isValidTarget
                    ? this.target.obj
                    : this.lastValidTargetPosition!.tile
                : this.target.tile;
            const targetTile = this.target.obj
                ? isValidTarget
                    ? this.target.obj.isBuilding()
                        ? this.target.obj.centerTile
                        : this.target.obj.tile
                    : this.lastValidTargetPosition!.tile
                : this.target.tile;
            const needsMove =
                !this.rangeHelper.isInWeaponRange(obj, effectiveTarget, this.weapon, this.game.rules) ||
                !this.losHelper.hasLineOfSight(obj, effectiveTarget, this.weapon) ||
                (obj.isUnit() &&
                    obj.rules.balloonHover &&
                    !obj.rules.hoverAttack &&
                    !moveTask &&
                    obj.tile !== targetTile &&
                    !this.options.holdGround) ||
                (obj.isAircraft() && this.weapon.projectileRules.iniRot <= 1 && !moveTask);
            if (needsMove) {
                if (obj.isUnit() && !this.options.holdGround && this.game.map.isWithinBounds(targetTile)) {
                    if (moveTask) {
                        if (moveTask.target !== this.target.obj || isValidTarget) {
                            if (
                                isValidTarget &&
                                this.target.obj &&
                                this.rangeHelper.tileDistance(this.target.obj, this.lastSelfMoveTargetTile) >
                                    this.weapon.range
                            ) {
                                moveTask.retarget(this.target.obj, !!this.target.getBridge());
                                this.lastSelfTileBeforeMove = obj.tile;
                                this.lastSelfMoveTargetTile = this.target.obj?.tile ?? this.target.tile;
                            } else {
                                if (
                                    this.options.leashTiles !== undefined &&
                                    this.rangeHelper.tileDistance(this.initialSelfPosition!.tile, obj.tile) >
                                        this.options.leashTiles
                                ) {
                                    moveTask.cancel();
                                    return true;
                                }
                                const targetSpeed =
                                    effectiveTarget instanceof GameObject && effectiveTarget.isUnit()
                                        ? effectiveTarget.moveTrait.baseSpeed
                                        : 0;
                                const ticksToWait = Math.ceil(
                                    (this.rangeHelper.tileDistance(obj, effectiveTarget) - (this.weapon.range + 1)) /
                                        ((obj.moveTrait.baseSpeed + targetSpeed) / Coords.LEPTONS_PER_TILE),
                                );
                                if (ticksToWait > 0) {
                                    this.rangeCheckCooldown = Math.min(GameSpeed.BASE_TICKS_PER_SECOND, ticksToWait);
                                }
                            }
                        } else {
                            let fallbackTarget;
                            if (this.options.leashTiles !== undefined) {
                                fallbackTarget = this.game.createTarget(
                                    this.initialSelfPosition!.onBridge,
                                    this.initialSelfPosition!.tile,
                                );
                            } else {
                                fallbackTarget = this.game.createTarget(
                                    this.lastValidTargetPosition!.onBridge,
                                    this.lastValidTargetPosition!.tile,
                                );
                            }
                            attackTrait.currentTarget = fallbackTarget;
                            moveTask.retarget(fallbackTarget.tile, fallbackTarget.isBridge());
                            this.updateTargetLines(fallbackTarget, false);
                        }
                        return false;
                    }
                    if (!obj.moveTrait || obj.moveTrait.isDisabled()) {
                        return true;
                    }
                    if (this.isCancelling()) {
                        return true;
                    }
                    if (
                        obj.tile === this.lastSelfTileBeforeMove ||
                        (this.moveExecuted && obj.moveTrait.lastMoveResult === MoveResult.Fail)
                    ) {
                        this.moveAttempts++;
                    } else {
                        this.moveAttempts = 0;
                    }
                    if (
                        this.weapon.rules.limboLaunch &&
                        obj.defaultToGuardArea &&
                        targetObj &&
                        this.moveExecuted &&
                        obj.moveTrait.lastMoveResult === MoveResult.Fail &&
                        this.rangeHelper.isInRange(
                            obj,
                            targetObj,
                            0,
                            obj.armedTrait.computeGuardScanRange(this.weapon),
                            true,
                        )
                    ) {
                        return true;
                    }
                    if (this.moveAttempts > MAX_MOVE_ATTEMPTS) {
                        return true;
                    }
                    if (this.moveAttempts > 0) {
                        this.children.push(new WaitMinutesTask(1 / 60));
                    }
                    const moveTarget = effectiveTarget;
                    const moveBridge =
                        targetObj && !isValidTarget ? this.lastValidTargetPosition!.onBridge : this.target.getBridge();
                    const newMoveTask = new MoveInWeaponRangeTask(this.game, moveTarget, !!moveBridge, this.weapon);
                    newMoveTask.blocking = false;
                    this.children.push(newMoveTask);
                    this.moveExecuted = true;
                    this.lastSelfTileBeforeMove = obj.tile;
                    this.lastSelfMoveTargetTile = moveTarget instanceof GameObject ? moveTarget.tile : moveTarget;
                    return this.onTick(obj);
                }
                return true;
            }
            this.moveExecuted = false;
            this.moveAttempts = 0;
            if (moveTask) {
                const shouldCancelMove =
                    (obj.rules.balloonHover && !obj.rules.hoverAttack) ||
                    obj.rules.fighter ||
                    obj.rules.spawned ||
                    (obj.rules.movementZone === MovementZone.Fly &&
                        !this.rangeHelper.isInRange2(
                            obj,
                            this.target.obj ?? this.target.tile,
                            this.weapon.minRange,
                            this.weapon.range - 1,
                        ));
                if (shouldCancelMove) {
                    moveTask.cancel();
                }
            }
            if (moveTask && (obj.isInfantry() || this.weapon.rules.spawner)) {
                return false;
            }
            if (moveTask?.children.some((task) => !task.cancellable) && this.weapon.rules.limboLaunch) {
                return false;
            }
            if (
                moveTask &&
                moveTask.shouldAirStrafe(obj) &&
                this.target.obj?.isUnit() &&
                this.target.obj.moveTrait.isMoving() &&
                this.weapon.range > 1 &&
                !this.rangeHelper.isInRange2(obj, this.target.obj, this.weapon.minRange, this.weapon.range - 1)
            ) {
                return false;
            }
            attackTrait.attackState = AttackState.PrepareToFire;
        }
        if (attackTrait.attackState !== AttackState.PrepareToFire) {
            return false;
        }
        if (!isValidTarget || attackTrait.isDisabled()) {
            moveTask?.cancel();
            return true;
        }
        const targetWorldCoords = this.target.getWorldCoords();
        const selfWorldPosition = obj.position.worldPosition;
        // Only aim once the geometry has settled: if either the target or the
        // unit moved since the last tick, go back to CheckRange instead of
        // firing on a stale solution. This is what stops a tank from shooting at
        // where a jeep *was*.
        if (
            !(
                this.lastInRangeTargetPosition.length() &&
                this.lastInRangeTargetPosition.equals(targetWorldCoords) &&
                this.lastInRangeSelfPosition.length() &&
                this.lastInRangeSelfPosition.equals(selfWorldPosition)
            )
        ) {
            this.lastInRangeTargetPosition.copy(targetWorldCoords);
            this.lastInRangeSelfPosition.copy(selfWorldPosition);
            attackTrait.attackState = AttackState.CheckRange;
            return this.onTick(obj);
        }
        if (!(this.weapon.rules.omniFire || (obj.rules.omniFire && obj.rules.fighter))) {
            const direction = new Vector3().copy(targetWorldCoords).sub(selfWorldPosition);
            const desiredFacing = FacingUtil.fromMapCoords(new Vector2(direction.x, direction.z));
            const facingTolerance = this.weapon.projectileRules.rot
                ? FACING_TOLERANCE_PROJECTILE
                : FACING_TOLERANCE;
            if ((obj.isVehicle() || obj.isBuilding()) && obj.turretTrait) {
                obj.turretTrait.desiredFacing = desiredFacing;
                if (Math.abs(desiredFacing - obj.turretTrait.facing) >= facingTolerance) {
                    return false;
                }
            } else if (Math.abs(desiredFacing - obj.direction) >= facingTolerance) {
                if (obj.isAircraft()) {
                    obj.direction = FacingUtil.tick(obj.direction, desiredFacing, obj.rules.rot).facing;
                    return false;
                }
                if (moveTask) {
                    return false;
                }
                if (this.options.disallowTurning) {
                    return true;
                }
                if (obj.isVehicle()) {
                    this.children.push(new TurnTask(desiredFacing));
                    return false;
                }
                obj.direction = desiredFacing;
            }
        }
        if (!this.losHelper.hasLineOfSight(obj, this.target.obj || this.target.tile, this.weapon)) {
            attackTrait.attackState = AttackState.CheckRange;
            return this.onTick(obj);
        }
        if (attackTrait.isOnCooldown(obj)) {
            return false;
        }
        if (this.weapon.warhead.rules.temporal && obj.temporalTrait.getTarget() === this.target.obj) {
            return false;
        }
        if (this.weapon.rules.suicide && this.weapon.type !== WeaponType.DeathWeapon) {
            this.game.destroyObject(obj, {
                player: obj.owner,
                obj: obj,
                weapon: this.weapon,
            });
            return true;
        }
        const prismType = this.game.rules.general.prism.type;
        if (obj.isBuilding() && obj.name === prismType && this.weapon.type !== WeaponType.Secondary) {
            this.fireUpPrismSupportTowers(obj, prismType);
        }
        if (obj.isInfantry() || obj.isVehicle()) {
            obj.isFiring = true;
        }
        if (obj.art.fireUp) {
            this.children.push(new WaitTicksTask(obj.art.fireUp).setCancellable(false));
            attackTrait.attackState = AttackState.FireUp;
            return false;
        }
        attackTrait.attackState = AttackState.Firing;
        return this.onTick(obj);
    }

    /**
     * Why this attack should stop. `forceDropTarget` is the limbo-launch flag;
     * the rest are the four "the target is no longer worth shooting" cases:
     * an infested transport (it is already ours), an invulnerable target, a
     * warped-out one (unless this weapon is temporal), and — the subtle one — a
     * **captured** target, detected by comparing the owner to the owner the
     * attack started with. `initialTargetOwner !== target.owner` is how a unit
     * stops shelling a building that its own engineer just captured.
     */
    private shouldDropTarget(target: any): boolean {
        return (
            this.forceDropTarget ||
            (target?.isTechno() &&
                ((this.weapon.rules.limboLaunch &&
                    (((target.isVehicle() || target.isAircraft()) && target.parasiteableTrait?.isInfested()) ||
                        target.invulnerableTrait.isActive())) ||
                    (target.warpedOutTrait.isInvulnerable() && !this.weapon.warhead.rules.temporal) ||
                    this.initialTargetOwner !== target.owner))
        );
    }

    /**
     * Prism support beams. Every friendly Prism Tower in range that is idle and
     * off cooldown gets a **passive** attack order against our target; the next
     * tick, `countSupportBeamsAndFireDownTowers` counts how many of them are
     * aimed at the same target and turns that into a damage multiplier.
     *
     * The `slice(0, supportMax)` is what caps a prism cluster: beyond four
     * supporting towers the extra ones do nothing, which is why the optimal
     * build is a diamond, not a wall.
     */
    private fireUpPrismSupportTowers(obj: any, prismType: string): void {
        const supportTowers = obj.owner
            .getOwnedObjectsByType(ObjectType.Building)
            .filter(
                (building: any) =>
                    building.name === prismType &&
                    building.secondaryWeapon &&
                    !building.unitOrderTrait.hasTasks() &&
                    building.attackTrait &&
                    !building.attackTrait.isDisabled() &&
                    !building.attackTrait.isOnCooldown(building),
            )
            .filter((building: any) =>
                this.rangeHelper.isInWeaponRange(building, obj, building.secondaryWeapon, this.game.rules),
            )
            .slice(0, this.game.rules.general.prism.supportMax);
        for (const tower of supportTowers) {
            tower.unitOrderTrait.addTask(
                tower.attackTrait.createAttackTask(this.game, obj, obj.centerTile, tower.secondaryWeapon, {
                    passive: true,
                }),
            );
        }
    }

    private countSupportBeamsAndFireDownTowers(obj: any, prismType: string): number {
        const supportingTowers = obj.owner
            .getOwnedObjectsByType(ObjectType.Building)
            .filter((building: any) => building.name === prismType && building.attackTrait?.currentTarget?.obj === obj);
        for (const tower of supportingTowers) {
            tower.unitOrderTrait.getCurrentTask()?.cancel();
        }
        return Math.min(this.game.rules.general.prism.supportMax, supportingTowers.length);
    }

    getTargetLinesConfig(): TargetLinesConfig {
        return this.targetLinesConfig;
    }
}
