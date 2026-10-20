/**
 * Port of redalert2/src/game/gameobject/task/move/MoveToBlockTask.ts (40 lines).
 *
 * Drive up to a structure until it physically stops you, then shoot it. This is
 * the "attack building with a tank" order: it is *not* `AttackTask`, because an
 * attack task would stop at weapon range, and at weapon range a building's own
 * defences reach you. The unit closes to touching distance first.
 *
 * Three options make that work:
 *   - `stopOnBlocker: target` — `MoveTask` returns `CloseEnough` the moment the
 *     path is blocked by this exact object instead of re-pathing around it;
 *   - `pathFinderIgnoredBlockers: [target]` — lets the path end *on* the
 *     building's footprint instead of stopping one cell short;
 *   - `closeEnoughTiles: 1`.
 *
 * The task waits for `lastMoveResult === CloseEnough` before firing. Any other
 * result (Success on a free approach, Fail, Cancel) ends the whole task without
 * a shot — deliberately: this order is "get adjacent", not "attack".
 */
import { MoveResult } from '../../trait/MoveTrait';
import { Task } from '../system/Task';
import { MoveTask } from './MoveTask';

export class MoveToBlockTask extends Task {
    private game: any;
    private target: any;
    private attackPerformed: boolean = false;

    constructor(game: any, target: any) {
        super();
        this.game = game;
        this.target = target;
        this.preventOpportunityFire = false;
        this.useChildTargetLines = true;
    }

    onStart(unit: any): void {
        this.children.push(
            new MoveTask(this.game, this.target.centerTile, false, {
                closeEnoughTiles: 1,
                pathFinderIgnoredBlockers: [this.target],
                stopOnBlocker: this.target,
            }),
        );
    }

    onTick(unit: any): boolean {
        if (this.attackPerformed || this.isCancelling() || !unit.attackTrait || unit.attackTrait.isDisabled()) {
            return true;
        }
        if (unit.moveTrait.lastMoveResult !== MoveResult.CloseEnough) {
            return true;
        }
        const weapon = unit.attackTrait.selectWeaponVersus(unit, this.target, this.game, true);
        if (!weapon) {
            return true;
        }
        this.children.push(
            unit.attackTrait.createAttackTask(this.game, this.target, this.target.tile, weapon, { force: true }),
        );
        this.attackPerformed = true;
        return false;
    }
}
