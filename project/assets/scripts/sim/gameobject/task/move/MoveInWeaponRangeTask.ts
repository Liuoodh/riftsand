/**
 * Port of redalert2/src/game/gameobject/task/move/MoveInWeaponRangeTask.ts (286 lines).
 *
 * "Walk until the target is in range, then stop." This is what every attack
 * order actually uses; `AttackTask` only fires once this task has parked the
 * unit. Four special cases live here because they change *where* the unit stops:
 *
 * 1. **Buildings are approached, not entered.** `onStart` looks for a cell
 *    within 5 of the footprint that is passable and on (roughly) the same
 *    height, and retargets to it if the geometric distance to the footprint is
 *    more than √2. Attacking a 3×3 building from its corner would otherwise
 *    leave the unit outside its own weapon range.
 *
 * 2. **Minimum range.** `recalcMinRange` runs once at the start (and again
 *    after a flyby): if the unit is *inside* the weapon's minimum range it walks
 *    outward. Artillery that stayed put inside its min range would simply never
 *    fire.
 *
 * 3. **Air strafing** (`shouldAirStrafe`): fighters with a rocket weapon
 *    (`iniRot > 1`) pick a random cell that puts the target in range, fly to it,
 *    and only then count as "close enough". Without the random cell every
 *    fighter attacks from the same angle.
 *
 * 4. **Bombing runs** (`isBombingRun`): level bombers (`iniRot <= 1`) do not
 *    stop at all. They lock a maneuver point 7 cells *past* the target, overfly
 *    it, and only turn back once they are within one cell of that point. That is
 *    why a bomber's course looks like it missed.
 *
 * ---
 * **Deviation (reference inconsistency):** the reference calls
 *
 *     super(game, target instanceof GameObject ? … : target, unit, { … })
 *
 * passing `unit` where `MoveTask`'s third parameter is `toBridge: boolean`.
 * Every other subclass (`AttackMoveTask`, `ExitFactoryTask`, `MoveAsideTask`,
 * `MoveTargetTask`, `MoveInsideTask`, `MoveOutsideTask`, `MoveToDockTask`,
 * `TeleportMoveToRefineryTask`) passes a boolean there, and `MoveTask` itself
 * reads `this.toBridge` as a layer flag. Passing a unit would make every
 * attacker believe it is on the bridge layer, so this passes `false`. The
 * override's parameter names are likewise renamed to match the base
 * (`preferredTile`, `preferredBridge`) — the reference names them
 * `fromTile`/`toTile`, which is what the *call site* looks like, not what the
 * base signature means. See REFERENCE-PARITY §29.
 */
import { MoveTask } from './MoveTask';
import { GameObject } from '../../GameObject';
import { RangeHelper } from '../../unit/RangeHelper';
import { Coords } from '../../../Coords';
import { LosHelper } from '../../unit/LosHelper';
import { RadialTileFinder } from '../../../map/tileFinder/RadialTileFinder';
import { MovementZone } from '../../../type/MovementZone';
import { ZoneType } from '../../unit/ZoneType';
import { MoveState } from '../../trait/MoveTrait';
import { RandomTileFinder } from '../../../map/tileFinder/RandomTileFinder';
import { LocomotorType } from '../../../type/LocomotorType';
import { bresenham } from '../../../bresenham';
import { FacingUtil } from '../../unit/FacingUtil';
import { Vector2 } from '../../../math/Vector2';

export const STRAFE_CLOSE_ENOUGH = 2;

export class MoveInWeaponRangeTask extends MoveTask {
    public target: any;
    private weapon: any;
    private recalcMinRange: boolean = true;
    private cancelRequested: boolean = false;
    private bomberInitialLock: boolean = false;
    private rangeHelper: RangeHelper;
    private losHelper: LosHelper;
    private bomberManeuverTile?: any;
    private bomberQueuedTargetTile?: any;

    constructor(game: any, target: any, unit: any, weapon: any) {
        super(
            game,
            target instanceof GameObject ? (target.isBuilding() ? (target as any).centerTile : target.tile) : target,
            false,
            {
                /*
                 * The target itself must not be treated as an obstacle while
                 * pathing toward it — otherwise a unit ordered to attack the
                 * building next door finds "no path" and never starts.
                 */
                pathFinderIgnoredBlockers: target instanceof GameObject && weapon.range > 0 ? [target] : undefined,
            },
        );
        this.target = target;
        this.weapon = weapon;
        this.rangeHelper = new RangeHelper(game.map.tileOccupation);
        this.losHelper = new LosHelper(game.map.tiles, game.map.tileOccupation);
    }

    onStart(unit: any) {
        const target = this.target;
        const map = this.game.map;

        if (target instanceof GameObject && target.isBuilding() && unit.rules.movementZone !== MovementZone.Fly) {
            const centerTile = target.tile;
            const foundation = target instanceof GameObject ? target.getFoundation() : { width: 1, height: 1 };
            const tileFinder = new RadialTileFinder(
                map.tiles,
                map.mapBounds,
                centerTile,
                foundation,
                1,
                5,
                (tile: any) =>
                    map.terrain.getPassableSpeed(tile, unit.rules.speedType, unit.isInfantry(), false) > 0 &&
                    Math.abs(tile.z - centerTile.z) < 2,
            );
            const tile = tileFinder.getNextTile();
            if (tile && this.rangeHelper.tileDistance(target, tile) > Math.SQRT2) {
                this.updateTarget(tile, false);
            }
        }

        this.bomberInitialLock = this.isCloseEnoughToDest(unit, unit.tile);
        super.onStart(unit);
    }

    cancel() {
        /*
         * A bomber overflying its target cannot stop on the spot; it finishes
         * the run and cancels on the way back (`bomberCanReturn`). Cancelling
         * mid-run would leave it circling the map.
         */
        if (this.bomberManeuverTile) {
            this.cancelRequested = true;
        } else {
            super.cancel();
        }
    }

    shouldAirStrafe(unit: any): boolean {
        return (
            unit.rules.movementZone === MovementZone.Fly &&
            unit.rules.locomotor === LocomotorType.Aircraft &&
            unit.rules.fighter &&
            this.weapon.projectileRules.iniRot > 1
        );
    }

    isBombingRun(unit: any): boolean {
        return (
            unit.rules.movementZone === MovementZone.Fly &&
            unit.rules.locomotor === LocomotorType.Aircraft &&
            this.weapon.projectileRules.iniRot <= 1
        );
    }

    isAirStrafeCloseEnough(unit: any): boolean {
        return this.rangeHelper.tileDistance(unit, this.targetTile) < Math.min(this.weapon.range, STRAFE_CLOSE_ENOUGH);
    }

    bomberCanReturn(unit: any): boolean {
        return !this.bomberManeuverTile || this.rangeHelper.tileDistance(unit, this.bomberManeuverTile) <= 1;
    }

    findStrafeDestination(unit: any, targetTile: any): any {
        const tileFinder = new RandomTileFinder(
            this.game.map.tiles,
            this.game.map.mapBounds,
            targetTile,
            this.weapon.range,
            this.game,
            (tile: any) => this.rangeHelper.isInWeaponRange(unit, targetTile, this.weapon, this.game.rules, tile),
        );
        return tileFinder.getNextTile();
    }

    hasReachedDestination(unit: any): boolean {
        return super.hasReachedDestination(unit) || this.canStopAtTile(unit, unit.tile, unit.onBridge);
    }

    canStopAtTile(unit: any, tile: any, onBridge: boolean): boolean {
        /*
         * Do not stop on top of the target. For units this also requires the
         * same sub-cell as the target — standing on the neighbouring corner of
         * an infantryman's cell is fine, sharing his corner is not.
         */
        if (
            unit.zone !== ZoneType.Air &&
            this.target instanceof GameObject &&
            this.game.map.tileOccupation.isTileOccupiedBy(tile, this.target) &&
            (!this.target.isUnit() ||
                (this.target.tile === tile &&
                    this.target.moveTrait.moveState !== MoveState.Moving &&
                    this.target.position.subCell === unit.position.subCell))
        ) {
            return false;
        }

        if (unit.zone !== ZoneType.Air) {
            if (!super.canStopAtTile(unit, tile, onBridge)) {
                return false;
            }
        } else if (
            this.game.map.tileOccupation
                .getAirObjectsOnTile(tile)
                .filter(
                    (obj: any) => obj.isUnit() && obj.moveTrait.moveState !== MoveState.Moving && obj !== unit,
                ).length
        ) {
            return false;
        }

        return (
            !(this.isBombingRun(unit) && !this.bomberCanReturn(tile)) &&
            (this.isCancelling() || this.isCloseEnoughToDest(unit, tile))
        );
    }

    isCloseEnoughToDest(unit: any, tile: any): boolean {
        /*
         * A balloon-hover unit (Kirov, siege chopper) does not need line of fire
         * to stop: it hovers directly over the target and drops.
         */
        if (unit.rules.balloonHover && !unit.rules.hoverAttack) {
            return this.rangeHelper.isInTileRange(tile, this.target, 0, 0);
        }
        /*
         * Cell-based weapons, and every vehicle, use tile distance + line of
         * sight. Infantry with a real projectile use the 3-D weapon range from
         * the muzzle position, including the sub-cell offset — that is why a
         * GI behind a wall can still be "in range" while a tank is not.
         */
        if (this.weapon.rules.cellRangefinding || !unit.isInfantry()) {
            return (
                this.rangeHelper.isInWeaponRange(unit, this.target, this.weapon, this.game.rules, tile) &&
                this.losHelper.hasLineOfSight(tile, this.target, this.weapon)
            );
        }
        const offset =
            unit.zone === ZoneType.Air
                ? unit.position.computeSubCellOffset(unit.position.desiredSubCell)
                : unit.position.getTileOffset();
        const { minRange, range } = this.rangeHelper.computeWeaponRangeVsTarget(
            tile,
            this.target,
            this.weapon,
            this.game.rules,
        );
        const worldPos = Coords.tile3dToWorld(
            tile.rx + offset.x / Coords.LEPTONS_PER_TILE,
            tile.ry + offset.y / Coords.LEPTONS_PER_TILE,
            tile.z + unit.position.tileElevation,
        );
        return (
            (unit.isUnit() && unit.rules.movementZone === MovementZone.Fly
                ? this.rangeHelper.isInRange2(worldPos, this.target, minRange, range)
                : this.rangeHelper.isInRange3(worldPos, this.target, minRange, range)) &&
            this.losHelper.hasLineOfSight(tile, this.target, this.weapon)
        );
    }

    findRelocationTile(preferredTile: any, preferredBridge: any, unit: any): any {
        if (unit.rules.movementZone !== MovementZone.Fly) {
            return super.findRelocationTile(preferredTile, preferredBridge, unit);
        } else {
            const map = this.game.map;
            const tileFinder = new RandomTileFinder(
                map.tiles,
                map.mapBounds,
                preferredTile,
                1,
                this.game,
                (tile: any) => this.isCancelling() || this.isCloseEnoughToDest(unit, tile),
            );
            return tileFinder.getNextTile();
        }
    }

    retarget(newTarget: any, updatePath: boolean) {
        const targetTile =
            newTarget instanceof GameObject
                ? newTarget.isBuilding()
                    ? (newTarget as any).centerTile
                    : newTarget.tile
                : newTarget;
        if (this.bomberManeuverTile) {
            /*
             * Mid-run retargets are queued, not applied: the bomber is committed
             * to its pass and will pick the new target up on the way back.
             */
            this.bomberQueuedTargetTile = targetTile;
        } else {
            this.updateTarget(targetTile, updatePath);
            this.recalcMinRange = true;
        }
        this.target = newTarget;
        if (this.options?.ignoredBlockers) {
            this.options.ignoredBlockers = newTarget instanceof GameObject ? [newTarget] : undefined;
        }
        if (!this.options) {
            this.options = {};
        }
        this.options.pathFinderIgnoredBlockers = newTarget instanceof GameObject ? [newTarget] : undefined;
    }

    onTick(unit: any): boolean {
        if (this.recalcMinRange) {
            this.recalcMinRange = false;
            const relocTile = this.findMinRangeRelocationTile(unit, this.targetTile);
            if (relocTile !== this.targetTile) {
                if (!relocTile) {
                    this.cancel();
                    return false;
                }
                this.updateTarget(relocTile, !!relocTile.onBridgeLandType);
            }
        }

        if (this.shouldAirStrafe(unit) && !this.isCancelling()) {
            this.updateTarget(
                this.target instanceof GameObject
                    ? this.target.isBuilding()
                        ? (this.target as any).centerTile
                        : this.target.tile
                    : this.target,
                false,
            );
            if (!this.isAirStrafeCloseEnough(unit)) {
                const strafeDest = this.findStrafeDestination(unit, this.targetTile);
                if (strafeDest) {
                    this.updateTarget(strafeDest, false);
                }
            }
        }

        if (
            this.isBombingRun(unit) &&
            !this.isCancelling() &&
            (!unit.ammo || this.weapon.getBurstsFired() || this.bomberInitialLock) &&
            !this.bomberManeuverTile
        ) {
            this.bomberInitialLock = false;
            const unitPos = unit.position.getMapPosition();
            const targetTile =
                this.target instanceof GameObject
                    ? this.target.isBuilding()
                        ? (this.target as any).centerTile
                        : this.target.tile
                    : this.target;
            /*
             * Maneuver point = 7 cells beyond the target along the current
             * bearing. The bomber flies the *straight line* to it, which is why
             * the pass is drawn from the unit's current cell, not from the
             * target.
             */
            const direction = new Vector2(targetTile.rx + 0.5, targetTile.ry + 0.5)
                .clone()
                .multiplyScalar(Coords.LEPTONS_PER_TILE)
                .sub(unitPos);
            let distance = direction.length();
            if (!distance) {
                direction.copy(FacingUtil.toMapCoords(unit.direction));
                distance = Number.EPSILON;
            }
            const maneuverPos = unitPos
                .clone()
                .add(direction.setLength(distance + 7 * Coords.LEPTONS_PER_TILE));
            const maneuverMapCoords = maneuverPos.multiplyScalar(1 / Coords.LEPTONS_PER_TILE).floor();
            const bresCoords = bresenham(maneuverMapCoords.x, maneuverMapCoords.y, unit.tile.rx, unit.tile.ry);
            if (!bresCoords.length) {
                throw new Error('Bresenham returned no tiles');
            }
            const firstCoord = bresCoords[0];
            this.bomberManeuverTile =
                this.game.map.tiles.getByMapCoords(firstCoord.x, firstCoord.y) ??
                this.game.map.tiles.getPlaceholderTile(firstCoord.x, firstCoord.y);
            this.options!.allowOutOfBoundsTarget = true;
            this.updateTarget(this.bomberManeuverTile, false);
        }

        if (this.bomberManeuverTile && this.bomberCanReturn(unit.tile)) {
            this.bomberManeuverTile = undefined;
            if (this.bomberQueuedTargetTile) {
                this.updateTarget(this.bomberQueuedTargetTile, false);
                this.recalcMinRange = true;
                this.bomberQueuedTargetTile = undefined;
            }
        }

        if (this.cancelRequested) {
            if (!this.bomberManeuverTile) {
                this.cancelRequested = false;
                this.cancel();
            }
        }

        return !!(this.isBombingRun(unit) && this.isCancelling() && this.forceCancel(unit)) || super.onTick(unit);
    }

    forceCancel(unit: any): boolean {
        return !this.bomberManeuverTile && super.forceCancel(unit);
    }

    findMinRangeRelocationTile(unit: any, targetTile: any): any {
        const { minRange, range } = this.rangeHelper.computeWeaponRangeVsTarget(
            unit,
            this.target,
            this.weapon,
            this.game.rules,
        );
        if (unit.rules.locomotor === LocomotorType.Chrono) {
            /*
             * Chrono units teleport, so they can pick the *ideal* band
             * (`range - 1 .. range`) instead of "outside the minimum".
             */
            return this.rangeHelper.isInRange(unit, this.target, range - 1, range, this.weapon.rules.cellRangefinding)
                ? targetTile
                : (this.findTileInRange(unit, targetTile, range - 1, 2 * range) ?? targetTile);
        } else {
            return this.rangeHelper.isInRange(
                unit,
                this.target,
                minRange,
                Number.POSITIVE_INFINITY,
                this.weapon.rules.cellRangefinding,
            )
                ? targetTile
                : this.findTileInRange(unit, targetTile, 2 * minRange, range - minRange);
        }
    }

    findTileInRange(unit: any, targetTile: any, minDist: number, maxDist: number): any {
        const map = this.game.map;
        /*
         * Step `minDist` away from the target along the line we came in on, then
         * ring-search outward. Walking the bresenham line (instead of computing
         * a point) keeps the candidate on a real cell.
         */
        const direction = new Vector2(unit.tile.rx - targetTile.rx, unit.tile.ry - targetTile.ry)
            .setLength(minDist)
            .floor()
            .add(new Vector2(targetTile.rx, targetTile.ry));
        let tile;
        for (const coord of bresenham(direction.x, direction.y, targetTile.rx, targetTile.ry)) {
            tile = map.tiles.getByMapCoords(coord.x, coord.y);
            if (tile) break;
        }
        if (tile) {
            const tileFinder = new RadialTileFinder(
                map.tiles,
                map.mapBounds,
                tile,
                { width: 1, height: 1 },
                0,
                maxDist,
                (t: any) =>
                    this.rangeHelper.isInWeaponRange(unit, this.target, this.weapon, this.game.rules, t) &&
                    this.losHelper.hasLineOfSight(t, this.target, this.weapon) &&
                    map.terrain.getPassableSpeed(t, unit.rules.speedType, unit.isInfantry(), !!t.onBridgeLandType) >
                        0 &&
                    !map.terrain.findObstacles({ tile: t, onBridge: !!t.onBridgeLandType }, unit).length,
            );
            return tileFinder.getNextTile();
        }
    }
}
