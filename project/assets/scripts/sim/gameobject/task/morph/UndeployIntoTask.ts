/**
 * Port of redalert2/src/game/gameobject/task/morph/UndeployIntoTask.ts (12 lines).
 *
 * Same as `DeployIntoTask` but in reverse: `rules.undeploysInto` resolved as a
 * **vehicle**. Kept as its own class rather than a boolean flag because the two
 * orders differ in more than direction — a deploy may need a pack animation and
 * a 180° turn, an undeploy never does, and `MorphIntoTask.onStart` decides that
 * from the object types rather than from the order.
 */
import { MorphIntoTask } from './MorphIntoTask';
import { ObjectType } from '../../../type/ObjectType';

export class UndeployIntoTask extends MorphIntoTask {
    onStart(unit: any): void {
        const undeploysInto = unit.rules.undeploysInto;
        if (!undeploysInto) {
            throw new Error(`Object type "${unit.name}" doesn't undeploy into anything`);
        }
        this.morphInto = this.game.rules.getObject(undeploysInto, ObjectType.Vehicle);
        super.onStart(unit);
    }
}
