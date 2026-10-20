/**
 * Port of redalert2/src/game/gameobject/task/EnterRecyclerTask.ts (22 lines).
 *
 * The Grinder: a unit walks in and is *sold at full refund*, which is what
 * makes it an economy building rather than a dump.
 *
 * Five independent vetoes, each of which has bitten someone:
 *
 *   - air units and chrono units are refused (you cannot grind a flying unit,
 *     and a chrono miner teleports out faster than the grinder can eat it);
 *   - engineers are refused — otherwise a 500-credit engineer is a free
 *     demolition of the refund formula;
 *   - `computeRefundValue(e) > 0` is the real gate: an already-damaged
 *     conscript is worth nothing, and grinding him would just be a way to
 *     delete your own units for free;
 *   - the target must be `BuildStatus.Ready` (a grinder under construction
 *     eating tanks is a classic exploit);
 *   - the unit must belong to the grinder's owner.
 *
 * `UnitRecycleEvent` is what the "unit recycled" voice line and the refund UI
 * listen to — the credits themselves are moved by `sell`, before the event.
 */
import { BuildStatus } from '../Building';
import { LocomotorType } from '../../type/LocomotorType';
import { MovementZone } from '../../type/MovementZone';
import { UnitRecycleEvent } from '../../event/UnitRecycleEvent';
import { EnterBuildingTask } from './EnterBuildingTask';

export class EnterRecyclerTask extends EnterBuildingTask {
    isAllowed(e: any): boolean {
        return (
            e.rules.movementZone !== MovementZone.Fly &&
            e.rules.locomotor !== LocomotorType.Chrono &&
            !e.rules.engineer &&
            this.game.sellTrait.computeRefundValue(e) > 0 &&
            ((e.isInfantry() && this.target.rules.cloning) || this.target.rules.grinding) &&
            !this.target.isDestroyed &&
            this.target.buildStatus === BuildStatus.Ready &&
            e.owner === this.target.owner
        );
    }

    onEnter(e: any): void {
        this.game.sellTrait.sell(e);
        this.game.events.dispatch(new UnitRecycleEvent(e));
    }
}
