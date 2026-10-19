/**
 * Port of redalert2/src/game/gameobject/trait/UnlandableTrait.ts.
 *
 * A unit that is not allowed to land — the paradrop transport, a spy plane
 * flying a scripted path — must never just stop in the middle of the map. This
 * trait checks "am I idle?" every tick and, if so, sends the object on a
 * straight `bresenham` line to whichever mid-edge of the map is farther away
 * (picked by a coin flip), then unspawns it on arrival.
 *
 * The move is `allowOutOfBoundsTarget` because the exit tile is deliberately
 * *outside* — the aircraft keeps flying off the edge and only then disappears.
 * The task group is non-cancellable: a player cannot grab the transport and
 * park it over their own base.
 */
import { bresenham, isNotNullOrUndefined } from '../bresenham';

export interface UnlandableWorld {
    /** true when this object must leave: neutral-owned or the paradrop plane */
    shouldLeave(object: any): boolean;
    isIdle(object: any): boolean;
    mapSize(): { width: number; height: number };
    getTile(rx: number, ry: number): any | undefined;
    generateRandom(): number;
    /** `new MoveTask(world, exitTile, false, { allowOutOfBoundsTarget: true })` */
    exitMoveTask(object: any, exitTile: any): any;
    /** `world.unspawnObject(obj)` */
    unspawn(object: any): void;
    addTask(object: any, task: any): void;
    cancelAllTasks(object: any): void;
}

export class UnlandableTrait {
    private enabled = true;

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    /** NotifyTick.onTick */
    onTick(gameObject: any, world: UnlandableWorld): void {
        if (!this.enabled) return;
        if (!world.shouldLeave(gameObject)) return;
        if (!world.isIdle(gameObject)) return;
        const exitTile = this.chooseExitTile(gameObject.tile, world);
        if (!exitTile) return;
        world.cancelAllTasks(gameObject);
        world.addTask(gameObject, world.exitMoveTask(gameObject, exitTile));
    }

    /** the last cell of a straight line to the middle of a map edge */
    chooseExitTile(tile: any, world: UnlandableWorld): any | undefined {
        const mapSize = world.mapSize();
        const targetPoint =
            world.generateRandom() > 0.5
                ? { x: Math.floor(mapSize.width / 2), y: 0 }
                : { x: 0, y: Math.floor(mapSize.height / 2) };
        const path = bresenham(tile.rx, tile.ry, targetPoint.x, targetPoint.y)
            .map((point) => world.getTile(point.x, point.y))
            .filter(isNotNullOrUndefined);
        if (!path.length) return undefined;
        return path[path.length - 1];
    }
}
