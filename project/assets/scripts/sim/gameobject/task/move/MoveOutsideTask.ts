/**
 * Port of redalert2/src/game/gameobject/task/move/MoveOutsideTask.ts (13 lines).
 *
 * The inverse of `MoveInsideTask`: leave the building's footprint and stop only
 * on a cell the building does **not** occupy. The building itself is an ignored
 * blocker, otherwise the unit would treat the structure it just exited as a
 * wall and re-path forever.
 *
 * `cancellable = false` — you cannot abort halfway out of a factory, the unit
 * would be left embedded in the foundation.
 */
import { MoveTask } from './MoveTask';

export class MoveOutsideTask extends MoveTask {
    private target: any;

    constructor(game: any, target: any, targetTile?: any) {
        super(game, targetTile ?? target.tile, false, { ignoredBlockers: [target] });
        this.target = target;
        this.cancellable = false;
    }

    canStopAtTile(unit: any, tile: any, onBridge: any): boolean {
        return !this.game.map.tileOccupation.isTileOccupiedBy(tile, this.target) && super.canStopAtTile(unit, tile, onBridge);
    }
}
