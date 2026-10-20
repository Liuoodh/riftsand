/**
 * Port of redalert2/src/game/gameobject/task/EvacuateTransportTask.ts (243 lines).
 *
 * Unloading a transport. `soft` decides what happens to a passenger that has
 * nowhere to stand:
 *
 *   soft = true  → keep retrying, three times, then give up quietly (leaving the
 *                  passenger inside). This is the "unload" button.
 *   soft = false → the passenger is destroyed where he stands. This is the death
 *                  path: a transport killed over water must not leak immortal
 *                  infantry, so they drown.
 *
 * The unit selection is **LIFO** (`units[units.length - 1]`), which is what
 * makes an APC's unload order look like a stack being popped instead of a queue
 * being drained. `evacState` gates how far that goes:
 *
 *   None           → nothing to do
 *   OnlyPassengers → leave the gunner inside (single-occupant transports)
 *   All            → empty it completely, gunner included
 *
 * `onStart` picks All only when the transport carries exactly one unit *and*
 * that unit is a gunner (`rules.gunner`); otherwise OnlyPassengers. That single
 * condition is why an IFV with one engineer inside ejects him, while a
 * Battle Fortress with four GIs keeps the gunner.
 *
 * The geometry search is the interesting part. `findValidEvacTarget` fans out
 * from the transport's **rear** (`direction + 180`) in 45° steps up to 180°, and
 * for each direction probes up to two cells. A cell at distance 1 is remembered
 * as `fallbackTarget`; a cell at distance 2 wins outright and is returned with
 * distance 1 as `spawnNode` — the unit appears on the near cell and then gets a
 * `MoveTask` to the far one, so the disembark animation reads as a two-cell hop.
 * Nothing found at all → `fallbackTarget` (possibly `undefined`).
 *
 * `turnPerformed` makes the transport turn to face its rear exactly once, before
 * the first passenger comes out. Re-checking it every tick would make the
 * transport oscillate whenever the chosen direction changed between passengers.
 *
 * The `CallbackTask(() => transport.zone !== ZoneType.Air)` at the top is a
 * polling wait: an airborne transport must land before anyone can get out, and
 * there is no "on landed" event to subscribe to at this layer.
 */
import { LeaveTransportEvent } from '../../event/LeaveTransportEvent';
import { FacingUtil } from '../unit/FacingUtil';
import { MovePositionHelper } from '../unit/MovePositionHelper';
import { MoveTask } from './move/MoveTask';
import { ScatterTask } from './ScatterTask';
import { Task } from './system/Task';
import { TurnTask } from './TurnTask';
import { WaitMinutesTask } from './system/WaitMinutesTask';
import { ZoneType } from '../unit/ZoneType';
import { CallbackTask } from './system/CallbackTask';

enum EvacuationState {
    None = 0,
    OnlyPassengers = 1,
    All = 2,
}

interface EvacTarget {
    spawnNode: { tile: any; onBridge?: any };
    moveNode?: { tile: any; onBridge?: any };
    dir: number;
}

export class EvacuateTransportTask extends Task {
    private game: any;
    private soft: boolean;
    private evacState: EvacuationState = EvacuationState.None;
    private evacTries: number = 0;
    private turnPerformed: boolean = false;
    public preventLanding: boolean = false;

    constructor(game: any, soft: boolean) {
        super();
        this.game = game;
        this.soft = soft;
    }

    forceEvac(): void {
        this.evacState = EvacuationState.All;
    }

    onStart(transport: any): void {
        if (!transport.transportTrait) {
            throw new Error(`Object "${transport.name}" is not a valid transport`);
        }
        const transportTrait = transport.transportTrait;
        if (transportTrait.units.length > 0) {
            this.evacState =
                (this.evacState !== EvacuationState.OnlyPassengers && transportTrait.units.length !== 1) ||
                !transport.rules.gunner
                    ? EvacuationState.OnlyPassengers
                    : EvacuationState.All;
        }
    }

    onTick(transport: any): boolean {
        if (this.isCancelling() || this.evacState === EvacuationState.None) {
            return true;
        }
        if (transport.zone === ZoneType.Air) {
            this.children.push(new CallbackTask(() => transport.zone !== ZoneType.Air));
            return false;
        }
        const units = transport.transportTrait.units;
        if (
            !units.length ||
            (transport.rules.gunner && units.length === 1 && this.evacState !== EvacuationState.All)
        ) {
            return true;
        }
        const unitToEvacuate = units[units.length - 1];
        const evacTarget = this.findValidEvacTarget(transport, unitToEvacuate);
        if (evacTarget && !this.turnPerformed) {
            this.turnPerformed = true;
            const targetDirection = (evacTarget.dir + 180) % 360;
            if (transport.direction !== targetDirection) {
                this.children.push(new TurnTask(targetDirection));
                return false;
            }
        }
        if (this.evacuateUnit(unitToEvacuate, transport, evacTarget)) {
            units.pop();
            this.children.push(new WaitMinutesTask(1 / 60));
            return false;
        }
        if (++this.evacTries <= 3) {
            this.children.push(new WaitMinutesTask(0.05));
            return false;
        }
        return true;
    }

    private evacuateUnit(unit: any, transport: any, evacTarget?: EvacTarget): boolean {
        if (!evacTarget) {
            if (!this.soft) {
                unit.position.tile = transport.tile;
                unit.position.tileElevation = transport.tileElevation;
                unit.onBridge = transport.onBridge;
                unit.zone = transport.zone;
                this.game.destroyObject(unit, { player: unit.owner });
                return true;
            }
            return false;
        }
        const { spawnNode, moveNode } = evacTarget;
        unit.position.tileElevation = spawnNode.onBridge?.tileElevation ?? 0;
        unit.onBridge = !!spawnNode.onBridge;
        unit.zone = this.game.map.getTileZone(spawnNode.tile, !spawnNode.onBridge);
        this.game.unlimboObject(unit, spawnNode.tile);
        unit.unitOrderTrait.unmarkNextQueuedOrder();
        if (moveNode) {
            unit.unitOrderTrait.addTask(new MoveTask(this.game, moveNode.tile, !!moveNode.onBridge));
        } else {
            // Reference passes `undefined` for the direction and the excluded
            // list; the scatter is a plain random step off the spawn node.
            unit.unitOrderTrait.addTask(new ScatterTask(this.game, undefined as any, undefined as any));
        }
        this.game.events.dispatch(new LeaveTransportEvent(transport));
        return true;
    }

    private findValidEvacTarget(transport: any, unit: any): EvacTarget | undefined {
        const map = this.game.map;
        const moveHelper = new MovePositionHelper(map);
        const bridge = transport.onBridge ? map.tileOccupation.getBridgeOnTile(transport.tile) : undefined;
        const baseDirection = (transport.direction + 180) % 360;
        let fallbackTarget: EvacTarget | undefined;
        for (let angleOffset = 0; angleOffset <= 180; angleOffset += 45) {
            const directions =
                angleOffset && angleOffset < 180
                    ? [baseDirection + angleOffset, baseDirection - angleOffset]
                    : [baseDirection];
            for (const direction of directions) {
                const mapCoords = FacingUtil.toMapCoords(direction);
                let currentTile = transport.tile;
                let currentBridge = bridge;
                let intermediateNode: { tile: any; onBridge?: any } | undefined;
                for (let distance = 1; distance <= 2; distance++) {
                    if (distance === 2) {
                        if (!intermediateNode) break;
                        currentTile = intermediateNode.tile;
                        currentBridge = intermediateNode.onBridge;
                    }
                    const targetX = transport.tile.rx + Math.sign(mapCoords.x) * distance;
                    const targetY = transport.tile.ry + Math.sign(mapCoords.y) * distance;
                    const targetTile = map.tiles.getByMapCoords(targetX, targetY);
                    if (!targetTile || !map.mapBounds.isWithinBounds(targetTile)) {
                        break;
                    }
                    const bridgeOptions = [map.tileOccupation.getBridgeOnTile(targetTile)];
                    if (bridgeOptions[0]) {
                        bridgeOptions.push(undefined);
                    }
                    for (const bridgeOption of bridgeOptions) {
                        if (this.isValidEvacPosition(targetTile, bridgeOption, currentBridge, currentTile, unit)) {
                            if (distance === 1) {
                                intermediateNode = { tile: targetTile, onBridge: bridgeOption };
                                fallbackTarget = {
                                    spawnNode: intermediateNode,
                                    moveNode: undefined,
                                    dir: direction,
                                };
                            } else {
                                return {
                                    spawnNode: intermediateNode!,
                                    moveNode: { tile: targetTile, onBridge: bridgeOption },
                                    dir: direction,
                                };
                            }
                        }
                    }
                }
            }
        }
        return fallbackTarget;
    }

    private isValidEvacPosition(tile: any, onBridge: any, fromBridge: any, fromTile: any, unit: any): boolean {
        const map = this.game.map;
        return (
            map.terrain.getPassableSpeed(tile, unit.rules.speedType, unit.isInfantry(), !!onBridge) > 0 &&
            new MovePositionHelper(map).isEligibleTile(tile, onBridge, fromBridge, fromTile) &&
            !map.terrain.findObstacles({ tile, onBridge }, unit).length
        );
    }
}
