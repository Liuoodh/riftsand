/**
 * MoveAsideTask — port of
 *   redalert2/src/game/gameobject/task/move/MoveAsideTask.ts
 *
 * "Please step out of the lane." The blocked unit looks at the eight cells
 * around itself starting from the side the pressure came from, takes the first
 * free one (never straight back and never straight forward on the first pass),
 * and drives there with strictCloseEnough. If no cell is free it asks the unit
 * in front to move aside as well (one chain step), then gives up after 40 ticks.
 */
import { Task, WaitTicksTask } from './Task';
import { MoveTask } from './MoveTask';
import { MoveTrait, CollisionState, MoveState } from './MoveTrait';
import { rotateVec2, Vec2 } from './Math2';
import { MovementZone } from './type/MovementZone';
import { SimWorld } from './World';

export class MoveAsideTask extends Task {
    private resolved = false;
    private chainPushIssued = false;
    private timeoutTicks?: number;

    constructor(
        private world: SimWorld,
        private fromDirection: Vec2,
    ) {
        super();
    }

    onEnd(unit: any): void {
        unit.moveTrait.collisionState = CollisionState.Resolved;
    }

    onTick(unit: any): boolean {
        this.timeoutTicks = this.timeoutTicks === undefined ? 0 : this.timeoutTicks + 1;
        if (this.timeoutTicks > 40 || this.resolved || this.isCancelling()) return true;

        const map = this.world;
        let targetTile: any;
        for (let angle = 0; angle < 360; angle += 45) {
            if ((angle !== 0 || this.chainPushIssued) && angle !== 180) {
                const direction = rotateVec2(this.fromDirection.clone(), angle).round();
                const tile = map.tiles.getByMapCoords(unit.tile.rx + Math.sign(direction.x), unit.tile.ry + Math.sign(direction.y));
                if (tile && map.mapBounds.isWithinBounds(tile)) {
                    if (
                        unit.rules.movementZone === MovementZone.Fly ||
                        (!map.terrain.findObstacles({ tile, onBridge: undefined }, unit).length &&
                            this.isEligibleTile(tile, unit.tile))
                    ) {
                        targetTile = tile;
                        break;
                    }
                }
            }
        }

        if (targetTile) {
            this.resolved = true;
            if (unit.isInfantry() && unit.deployerTrait?.isDeployed?.()) unit.deployerTrait.setDeployed(false);
            if (unit.moveTrait.isDisabled()) return true;
            this.children.push(
                new MoveTask(this.world, targetTile, false, { closeEnoughTiles: 0, strictCloseEnough: true }),
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
        if (!pushTile || !map.mapBounds.isWithinBounds(pushTile)) return true;

        /*
         * Reference filters `unit.owner === unit.owner` (a shadowed variable), so
         * it pushes anybody. The intent is clearly "units of the same side";
         * pushing an enemy out of the way is not something a move order should
         * do, so the intent is what is ported here.
         */
        const pushableUnits = map.tileOccupation
            .getGroundObjectsOnTile(pushTile)
            .filter(
                (obj: any) =>
                    obj.isUnit() &&
                    obj.owner === unit.owner &&
                    obj.tile === pushTile &&
                    !(obj.isInfantry() && obj.stance === 'paradrop'),
            );

        if (pushableUnits.find((other: any) => other.moveTrait.collisionState === CollisionState.Waiting || other.orders.hasTasks())) {
            this.children.push(new WaitTicksTask(5));
            unit.moveTrait.collisionState = CollisionState.Waiting;
            unit.moveTrait.moveState = MoveState.PlanMove;
            return false;
        }

        for (const other of pushableUnits) {
            other.orders.addTask(new MoveAsideTask(this.world, this.fromDirection));
        }
        this.children.push(new WaitTicksTask(1));
        unit.moveTrait.collisionState = CollisionState.Waiting;
        unit.moveTrait.moveState = MoveState.PlanMove;
        this.chainPushIssued = true;
        return false;
    }

    private isEligibleTile(tile: any, sourceTile: any): boolean {
        return Math.abs(tile.z - sourceTile.z) < 2;
    }
}
