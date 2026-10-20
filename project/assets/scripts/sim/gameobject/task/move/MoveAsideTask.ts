/**
 * Port of redalert2/src/game/gameobject/task/move/MoveAsideTask.ts (93 lines).
 *
 * "Please step out of the lane." Issued by `MoveTask` to the unit that is
 * blocking it, with `fromDirection` = the blocker→blocked vector, so the pushed
 * unit prefers cells that are *not* in the way.
 *
 * The scan order is the whole point: eight directions at 45° starting from 0,
 * skipping
 *   - 0° on the first pass (`angle !== 0 || this.chainPushIssued`) — moving
 *     straight along the pressure direction does not help, and
 *   - 180° always (`angle !== 180`) — backing into the unit that pushed you is
 *     worse than staying put.
 * So the first pass tries 45/90/135/225/270/315; the second (after a chain push)
 * also allows 0.
 *
 * If no cell is free it asks the unit *in front* to move aside too — exactly one
 * chain step (`chainPushIssued`), then it waits 5 ticks. The 40-tick timeout is
 * the last resort: `Resolved` on `onEnd` regardless, so the pusher is never left
 * permanently blocked.
 *
 * ---
 * **Deviation (bug fix):** the reference's pushable-unit filter reads
 *
 *     .filter(unit => unit.isUnit() && unit.owner === unit.owner && ...)
 *
 * where the arrow parameter shadows the outer `unit`, making the owner test a
 * tautology. Taken literally it would push *enemy* units out of the way, i.e.
 * your tank could shove an enemy tank aside. The self-comparison is a
 * transcription artefact, not a design choice, so the comparison is restored to
 * the obvious intent: `obj.owner === unit.owner`. See REFERENCE-PARITY §29.
 */
import { Task } from '../system/Task';
import { MovePositionHelper } from '../../unit/MovePositionHelper';
import { WaitTicksTask } from '../system/WaitTicksTask';
import { CollisionState, MoveState } from '../../trait/MoveTrait';
import { MoveTask } from './MoveTask';
import { rotateVec2 } from '../../../math/geometry';
import { MovementZone } from '../../../type/MovementZone';
import { StanceType } from '../../StanceType';

export class MoveAsideTask extends Task {
    private game: any;
    private fromDirection: any;
    private resolved: boolean = false;
    private chainPushIssued: boolean = false;
    private timeoutTicks?: number;

    constructor(game: any, fromDirection: any) {
        super();
        this.game = game;
        this.fromDirection = fromDirection;
    }

    onEnd(unit: any): void {
        unit.moveTrait.collisionState = CollisionState.Resolved;
    }

    onTick(unit: any): boolean {
        this.timeoutTicks = this.timeoutTicks === undefined ? 0 : this.timeoutTicks + 1;
        if (this.timeoutTicks > 40 || this.resolved || this.isCancelling()) {
            return true;
        }

        const map = this.game.map;
        const moveHelper = new MovePositionHelper(map);
        const bridge = unit.onBridge ? map.tileOccupation.getBridgeOnTile(unit.tile) : undefined;

        let targetTile: any;
        let targetBridge: any;
        for (let angle = 0; angle < 360; angle += 45) {
            if ((angle !== 0 || this.chainPushIssued) && angle !== 180) {
                const direction = rotateVec2(this.fromDirection.clone(), angle).round();
                const tile = map.tiles.getByMapCoords(
                    unit.tile.rx + Math.sign(direction.x),
                    unit.tile.ry + Math.sign(direction.y),
                );
                if (tile && map.mapBounds.isWithinBounds(tile)) {
                    targetBridge = map.tileOccupation.getBridgeOnTile(tile);
                    if (
                        unit.rules.movementZone === MovementZone.Fly ||
                        (!map.terrain.findObstacles({ tile, onBridge: targetBridge }, unit).length &&
                            moveHelper.isEligibleTile(tile, targetBridge, bridge, unit.tile))
                    ) {
                        targetTile = tile;
                        break;
                    }
                }
            }
        }

        if (targetTile) {
            this.resolved = true;
            if (unit.isInfantry() && unit.deployerTrait?.isDeployed()) {
                unit.deployerTrait.setDeployed(false);
            }
            if (unit.moveTrait.isDisabled()) {
                return true;
            }
            this.children.push(
                new MoveTask(this.game, targetTile, !!targetBridge, {
                    closeEnoughTiles: 0,
                    strictCloseEnough: true,
                }),
            );
            return false;
        }

        if (this.chainPushIssued) {
            this.children.push(new WaitTicksTask(5));
            return false;
        }

        const pushTile = map.tiles.getByMapCoords(
            unit.tile.rx + Math.sign(this.fromDirection.x),
            unit.tile.ry + Math.sign(this.fromDirection.y),
        );
        if (!pushTile || !map.mapBounds.isWithinBounds(pushTile)) {
            return true;
        }
        targetBridge = map.tileOccupation.getBridgeOnTile(pushTile);

        /* `obj`, not `unit`: see the deviation note in the header. */
        const pushableUnits = map.tileOccupation
            .getGroundObjectsOnTile(pushTile)
            .filter(
                (obj: any) =>
                    obj.isUnit() &&
                    obj.owner === unit.owner &&
                    obj.tile === pushTile &&
                    obj.onBridge === !!targetBridge &&
                    !(obj.isInfantry() && obj.stance === StanceType.Paradrop) &&
                    !(obj.isAircraft() && obj.missileSpawnTrait),
            );

        if (
            pushableUnits.find(
                (obj: any) => obj.moveTrait.collisionState === CollisionState.Waiting || obj.unitOrderTrait.hasTasks(),
            )
        ) {
            this.children.push(new WaitTicksTask(5));
            unit.moveTrait.collisionState = CollisionState.Waiting;
            unit.moveTrait.moveState = MoveState.PlanMove;
            return false;
        }

        pushableUnits.forEach((obj: any) => {
            obj.unitOrderTrait.addTask(new MoveAsideTask(this.game, this.fromDirection));
        });
        this.children.push(new WaitTicksTask(1));
        unit.moveTrait.collisionState = CollisionState.Waiting;
        unit.moveTrait.moveState = MoveState.PlanMove;
        this.chainPushIssued = true;
        return false;
    }
}
