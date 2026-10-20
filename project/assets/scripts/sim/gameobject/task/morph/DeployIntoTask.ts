/**
 * Port of redalert2/src/game/gameobject/task/morph/DeployIntoTask.ts (15 lines).
 *
 * The `Deploy` order: resolve `rules.deploysInto` to a **building** and hand the
 * rest to `MorphIntoTask`. The `ObjectType.Building` lookup type is not
 * cosmetic — the same name can exist as a vehicle, and asking for the wrong
 * object type silently returns the wrong prototype.
 *
 * `onTick` short-circuits on cancel *before* calling `super`, because
 * `MorphIntoTask.onTick` performs the swap on its first tick. A cancelled
 * deploy must not still spawn the building.
 */
import { MorphIntoTask } from './MorphIntoTask';
import { ObjectType } from '../../../type/ObjectType';

export class DeployIntoTask extends MorphIntoTask {
    onStart(unit: any): void {
        const deploysInto = unit.rules.deploysInto;
        if (!deploysInto) {
            throw new Error(`Object type "${unit.name}" doesn't deploy into anything`);
        }
        this.morphInto = this.game.rules.getObject(deploysInto, ObjectType.Building);
        super.onStart(unit);
    }

    onTick(unit: any): boolean {
        return !!this.isCancelling() || super.onTick(unit);
    }
}
