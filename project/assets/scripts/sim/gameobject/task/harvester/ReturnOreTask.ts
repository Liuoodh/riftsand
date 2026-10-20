/**
 * Port of redalert2/src/game/gameobject/task/harvester/ReturnOreTask.ts (267 lines).
 *
 * The delivery half of the harvester loop. Full handshake, in order:
 *
 *   pick refinery → reserve a pad → (queue if the pad is taken) → drive to the
 *   pad → dock → wait two ticks → unload → chain back into `GatherOreTask`
 *
 * Four rules carry the retail feel:
 *
 * 1. **The refinery is re-validated every tick**, and the check includes
 *    `unit.tile !== findRefineryDockingTile(this.target)`. That means "am I
 *    still on the pad?" — the moment the miner is nudged off, or the refinery is
 *    captured/destroyed, the whole approach restarts from `MovingToRefinery`.
 *    Without it a miner whose refinery got captured would sit on the old pad
 *    forever.
 * 2. **Two different dock numbers.** `getFirstAvailableDockNumber` is "free
 *    right now"; `getFirstEmptyDockNumber` is "physically empty but maybe
 *    reserved". The `needsReservation` flag is set in the second case and
 *    forces the queueing branch, so a miner never drives onto a pad another
 *    miner has already claimed.
 * 3. **`harvesterTooFarDistance`** aborts a long trip *unless* the order was
 *    explicit. That is the anti-thrash rule: an automatically-retargeted miner
 *    gives up rather than crossing the map, but a player who clicked a specific
 *    refinery gets his order honoured.
 * 4. **The 270° turn before docking is skipped for infantry.** Yuri's slaves
 *    have no `rot` and would wait for a turn that never completes.
 *
 * The unload payout is where retail hides its AI economy bonus. Base value comes
 * from `rules.getTiberium(...).value` per bail, then each ore purifier adds
 * `floor(oreValue * purifierBonus)`. On top of that, an **AI player secretly
 * owns extra purifiers** (`AIVirtualPurifiers=4,2,0`): brutal gets +4, normal
 * +2, easy 0. That is the real reason a brutal AI can field armies on a single
 * refinery — it is not smarter, it is richer. Everything here derives from
 * immutable player state, so it stays lockstep-deterministic.
 *
 * `preventOpportunityFire` is raised only in `PreparingToUnload`, which is the
 * window where the miner is stationary on the pad; it may still shoot while
 * driving to the refinery.
 *
 * `onEnd` undocks **and** frees the reservation, gated on `target.isSpawned` —
 * a destroyed refinery has no dock trait left to talk to, and touching it would
 * throw during the death cleanup.
 */
import { Task } from '../system/Task';
import { RangeHelper } from '../../unit/RangeHelper';
import { RadialTileFinder } from '../../../map/tileFinder/RadialTileFinder';
import { MoveTask } from '../move/MoveTask';
import { TurnTask } from '../TurnTask';
import { WaitMinutesTask } from '../system/WaitMinutesTask';
import { TiberiumType } from '../../../type/TiberiumType';
import { HarvesterStatus } from '../../../traits/HarvesterTrait';
import { TeleportMoveToRefineryTask } from './TeleportMoveToRefineryTask';
import { GatherOreTask } from './GatherOreTask';
import { CallbackTask } from '../system/CallbackTask';
import { MoveResult } from '../../trait/MoveTrait';
import { ZoneType } from '../../unit/ZoneType';
import { Vector2 } from '../../../math/Vector2';
import { SpeedType } from '../../../type/SpeedType';

export class ReturnOreTask extends Task {
    private game: any;
    private forceTarget: any;
    private resetLastOreSite: boolean;
    private explicitOrder: boolean;
    private rangeHelper: RangeHelper;
    private target?: any;
    private reservedDockNumber?: number;

    constructor(game: any, forceTarget?: any, resetLastOreSite: boolean = false, explicitOrder: boolean = false) {
        super();
        this.game = game;
        this.forceTarget = forceTarget;
        this.resetLastOreSite = resetLastOreSite;
        this.explicitOrder = explicitOrder;
        this.useChildTargetLines = true;
        this.preventOpportunityFire = false;
        this.rangeHelper = new RangeHelper(game.map.tileOccupation);
    }

    onStart(unit: any): void {
        // Harvesters are vehicles OR Yuri's slaves (infantry).
        if (!unit.harvesterTrait) {
            throw new Error(`Unit ${unit.name} is not a harvester.`);
        }
        unit.harvesterTrait.status = HarvesterStatus.MovingToRefinery;
        if (this.resetLastOreSite) {
            unit.harvesterTrait.lastOreSite = undefined;
        }
    }

    onEnd(unit: any): void {
        if (this.target?.isSpawned) {
            this.target.dockTrait.undockUnit(unit);
            this.target.dockTrait.unreserveDockForUnit(unit);
        }
        if (unit.harvesterTrait.status !== HarvesterStatus.LookingForRefinery) {
            unit.harvesterTrait.status = HarvesterStatus.Idle;
        }
    }

    onTick(unit: any): boolean {
        if (this.isCancelling()) return true;
        const harvesterTrait = unit.harvesterTrait;
        if (harvesterTrait.status === HarvesterStatus.LookingForRefinery) return true;
        if (harvesterTrait.status === HarvesterStatus.MovingToRefinery) {
            if (
                !this.target ||
                !this.isValidTargetRefinery(this.target, unit) ||
                unit.tile !== this.findRefineryDockingTile(this.target)
            ) {
                const refinery = this.forceTarget ?? this.findClosestReachableRefinery(unit);
                if (!refinery) {
                    harvesterTrait.status = HarvesterStatus.LookingForRefinery;
                    return true;
                }
                if (this.target && this.target !== refinery && this.target.dockTrait.hasReservedDockForUnit(unit)) {
                    this.target.dockTrait.unreserveDockForUnit(unit);
                }
                this.target = refinery;
            }
            let dockNumber = this.target.dockTrait.getFirstAvailableDockNumber();
            let needsReservation = false;
            if (dockNumber === undefined) {
                dockNumber = this.target.dockTrait.getFirstEmptyDockNumber();
                if (dockNumber !== undefined) {
                    needsReservation = !this.target.dockTrait.hasReservedDockForUnit(unit);
                }
            }
            const dockingTile = this.findRefineryDockingTile(this.target);
            const distance = this.rangeHelper.tileDistance(unit, dockingTile);
            if (
                dockNumber === undefined ||
                needsReservation ||
                (distance > this.game.rules.general.harvesterTooFarDistance && !this.explicitOrder)
            ) {
                const queueingTile = this.findReachableQueueingTile(unit);
                if (!queueingTile) return true;
                if (unit.tile !== queueingTile) {
                    this.children.push(
                        unit.rules.teleporter
                            ? new TeleportMoveToRefineryTask(this.game, dockingTile, queueingTile, () =>
                                  this.chronoMinerCanTeleport(unit, dockingTile, this.target),
                              )
                            : new MoveTask(this.game, queueingTile, false),
                        new CallbackTask(() => {
                            if (unit.moveTrait.lastMoveResult === MoveResult.Fail) {
                                harvesterTrait.status = HarvesterStatus.LookingForRefinery;
                            } else if (unit.moveTrait.lastMoveResult === MoveResult.CloseEnough) {
                                this.children.push(new WaitMinutesTask(5 / 60));
                            } else if (unit.moveTrait.lastMoveResult === MoveResult.Success) {
                                this.children.push(new WaitMinutesTask(2 / 60));
                            }
                        }),
                    );
                }
                return false;
            }
            if (!this.target.dockTrait.hasReservedDockForUnit(unit)) {
                this.target.dockTrait.reserveDockAt(unit, dockNumber);
            }
            if (this.reservedDockNumber === undefined) {
                this.reservedDockNumber = this.target.dockTrait.getReservedDockForUnit(unit);
            }
            if (unit.tile !== dockingTile) {
                this.children.push(
                    unit.rules.teleporter
                        ? new TeleportMoveToRefineryTask(this.game, dockingTile, undefined, () =>
                              this.chronoMinerCanTeleport(unit, dockingTile, this.target),
                          )
                        : new MoveTask(this.game, dockingTile, false, {
                              closeEnoughTiles: 0,
                              strictCloseEnough: true,
                          }),
                    new CallbackTask(() => {
                        if (unit.moveTrait.lastMoveResult === MoveResult.Fail) {
                            harvesterTrait.status = HarvesterStatus.LookingForRefinery;
                        }
                    }),
                );
                return false;
            }
            harvesterTrait.status = HarvesterStatus.Docking;
        }
        if (!this.isValidTargetRefinery(this.target, unit)) {
            harvesterTrait.status = HarvesterStatus.MovingToRefinery;
            this.forceTarget = undefined;
            return this.onTick(unit);
        }
        if (harvesterTrait.status === HarvesterStatus.Docking) {
            // The unload facing is a vehicle animation detail; infantry
            // slaves have no turn rate and would wait forever.
            if (!unit.isInfantry() && unit.direction !== 270) {
                this.children.push(new TurnTask(270));
                return false;
            }
            this.target.dockTrait.dockUnitAt(unit, this.reservedDockNumber);
            this.reservedDockNumber = undefined;
            harvesterTrait.status = HarvesterStatus.PreparingToUnload;
        }
        if (harvesterTrait.status === HarvesterStatus.PreparingToUnload) {
            this.preventOpportunityFire = true;
            this.children.push(new WaitMinutesTask(2 / 60));
            harvesterTrait.status = HarvesterStatus.Unloading;
            return false;
        }
        if (harvesterTrait.status !== HarvesterStatus.Unloading) return false;
        const oreValue =
            harvesterTrait.ore * this.game.rules.getTiberium(TiberiumType.Ore).value +
            harvesterTrait.gems * this.game.rules.getTiberium(TiberiumType.Gems).value;
        this.target.owner.credits += oreValue;
        let purifierCount = [...this.target.owner.buildings].filter(
            (building: any) =>
                building.rules.orePurifier &&
                (!building.poweredTrait || !this.target.owner.powerTrait?.isLowPower()),
        ).length;
        // Retail AIVirtualPurifiers=4,2,0: AI houses refine ore as if they
        // owned extra Ore Purifiers, scaled by difficulty (brutal +100%,
        // normal +50% at PurifierBonus=0.25). This is THE hidden economy
        // bonus that lets retail's brutal AI field endless armies without
        // literally printing money. Deterministic: derived from immutable
        // player state, identical on every lockstep client.
        if (this.target.owner.isAi) {
            const difficulty = this.target.owner.aiDifficulty;
            purifierCount += difficulty === 0 ? 4 : difficulty === 4 ? 2 : 0; // AiDifficulty.Brutal=0, Normal=4
        }
        const purifierBonus = this.game.rules.general.purifierBonus;
        this.target.owner.credits += purifierCount * Math.floor(oreValue * purifierBonus);
        harvesterTrait.ore = 0;
        harvesterTrait.gems = 0;
        if (unit.unitOrderTrait.getTasks().length === 1) {
            unit.unitOrderTrait.addTask(new GatherOreTask(this.game));
        }
        return true;
    }

    private isValidTargetRefinery(refinery: any, unit: any): boolean {
        return refinery.isSpawned && this.game.areFriendly(refinery, unit) && !refinery.warpedOutTrait.isActive();
    }

    private findClosestReachableRefinery(unit: any): any {
        const rangeHelper = this.rangeHelper;
        const isAirUnit = unit.zone === ZoneType.Air;
        const speedType = unit.rules.speedType;
        const isInfantry = unit.isInfantry();
        const islandIdMap =
            !isAirUnit && this.game.map.terrain.getPassableSpeed(unit.tile, speedType, isInfantry, unit.onBridge)
                ? this.game.map.terrain.getIslandIdMap(speedType, isInfantry)
                : undefined;
        const refineries = [...unit.owner.buildings]
            .filter(
                (building: any) =>
                    building.rules.refinery &&
                    building.dockTrait &&
                    !building.warpedOutTrait.isActive() &&
                    this.isReachableRefinery(building, unit, islandIdMap),
            )
            .sort((a: any, b: any) => rangeHelper.distance2(unit, a) - rangeHelper.distance2(unit, b));
        const closestRefinery = refineries[0];
        const availableRefinery = refineries.find(
            (refinery: any) => refinery.dockTrait.getAvailableDockCount() > 0,
        );
        if (
            !availableRefinery ||
            (closestRefinery &&
                rangeHelper.tileDistance(unit, availableRefinery.centerTile) -
                    rangeHelper.tileDistance(unit, closestRefinery.centerTile) >
                    this.game.rules.general.harvesterTooFarDistance)
        ) {
            return closestRefinery;
        }
        return availableRefinery;
    }

    private isReachableRefinery(refinery: any, unit: any, islandIdMap: any): boolean {
        const dockingTile = this.findRefineryDockingTile(refinery);
        return (
            unit.rules.teleporter ||
            islandIdMap?.get(dockingTile, false) === islandIdMap?.get(unit.tile, unit.onBridge)
        );
    }

    private findReachableQueueingTile(unit: any): any {
        if (this.target.art.queueingCell) {
            const queueingPos = new Vector2(this.target.tile.rx, this.target.tile.ry).add(
                this.target.art.queueingCell,
            );
            const queueingTile = this.game.map.tiles.getByMapCoords(queueingPos.x, queueingPos.y);
            if (queueingTile && this.isValidQueueingTile(queueingTile, unit)) {
                return queueingTile;
            }
        }
        return new RadialTileFinder(
            this.game.map.tiles,
            this.game.map.mapBounds,
            this.target.tile,
            this.target.getFoundation(),
            1,
            1,
            (tile: any) => this.isValidQueueingTile(tile, unit),
        ).getNextTile();
    }

    private isValidQueueingTile(tile: any, unit: any): boolean {
        const isAirUnit = unit.zone === ZoneType.Air;
        const speedType = unit.rules.speedType;
        const isInfantry = unit.isInfantry();
        const islandIdMap =
            !isAirUnit && this.game.map.terrain.getPassableSpeed(unit.tile, speedType, isInfantry, unit.onBridge)
                ? this.game.map.terrain.getIslandIdMap(speedType, isInfantry)
                : undefined;
        return (
            isAirUnit ||
            (islandIdMap?.get(tile, false) === islandIdMap?.get(unit.tile, unit.onBridge) &&
                Math.abs(tile.z - this.target.tile.z) < 2 &&
                !tile.onBridgeLandType)
        );
    }

    private findRefineryDockingTile(refinery: any): any {
        const dockingPos = {
            x: refinery.tile.rx + refinery.getFoundation().width - 1,
            y: refinery.tile.ry + Math.floor(refinery.getFoundation().height / 2),
        };
        const canonicalTile = this.game.map.tiles.getByMapCoords(dockingPos.x, dockingPos.y);
        // Classic refineries keep their docking pad passable, but Yuri's slave
        // miner occupies its whole foundation — slaves deliver by walking up
        // to the miner instead. Fall back to a deterministic passable tile
        // adjacent to the foundation when the canonical pad is blocked.
        if (
            refinery.rules.enslaves &&
            (!canonicalTile ||
                !this.game.map.terrain.getPassableSpeed(canonicalTile, SpeedType.Foot, true, false))
        ) {
            const adjacentTile = new RadialTileFinder(
                this.game.map.tiles,
                this.game.map.mapBounds,
                refinery.tile,
                refinery.getFoundation(),
                1,
                1,
                (tile: any) => this.game.map.terrain.getPassableSpeed(tile, SpeedType.Foot, true, false) > 0,
            ).getNextTile();
            if (adjacentTile) {
                return adjacentTile;
            }
        }
        return canonicalTile;
    }

    private chronoMinerCanTeleport(unit: any, targetTile: any, refinery: any): boolean {
        const rangeHelper = this.rangeHelper;
        const distance = rangeHelper.tileDistance(unit, targetTile);
        return (
            !(!this.forceTarget && distance > this.game.rules.general.chronoHarvTooFarDistance) &&
            !(distance <= 1) &&
            !!this.isValidTargetRefinery(refinery, unit) &&
            !(
                refinery.dockTrait.getAvailableDockCount() === 0 &&
                !refinery.dockTrait.hasReservedDockForUnit(unit)
            )
        );
    }
}
