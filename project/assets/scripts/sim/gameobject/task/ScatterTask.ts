/**
 * Port of redalert2/src/game/gameobject/task/ScatterTask.ts (40 lines).
 *
 * "Get out of the way" issued *to oneself*. Two entry points:
 *
 *   - with a target  → walk to that exact cell (`target.tile` / `target.onBridge`)
 *   - without one    → ask `ScatterPositionHelper` where to go
 *
 * Aircraft are exempt: `movementZone === Fly` does nothing, because a plane
 * that scatters is a plane that abandons its attack run.
 *
 * `onTick` returns `true` on the first tick — the task only exists to spawn the
 * `MoveTask` child. That is not an oversight: `TaskRunner` parks the parent
 * while children run (`waitingForChildrenToFinish`), and the child's result is
 * what the order system reads.
 */
import { MoveTask } from './move/MoveTask';
import { Task } from './system/Task';
import { ScatterPositionHelper } from '../unit/ScatterPositionHelper';
import { MovementZone } from '../../type/MovementZone';

export class ScatterTask extends Task {
    private game: any;
    private target: any;
    private options: any;

    constructor(game: any, target?: any, options?: any) {
        super();
        this.game = game;
        this.target = target;
        this.options = options;
    }

    onStart(unit: any): void {
        if (!unit.moveTrait.isDisabled() && unit.rules.movementZone !== MovementZone.Fly) {
            let tile: any;
            let toBridge: boolean;

            if (this.target) {
                ({ tile, toBridge } = this.target);
            } else {
                const position = new ScatterPositionHelper(this.game)
                    .findPositions([unit], this.options)
                    .get(unit);
                if (!position) return;
                tile = position.tile;
                toBridge = !!position.onBridge;
            }

            this.children.push(
                new MoveTask(this.game, tile, toBridge, {
                    closeEnoughTiles: 0,
                    ignoredBlockers: this.options?.ignoredBlockers,
                }),
            );
        }
    }

    onTick(unit: any): boolean {
        return true;
    }
}
