/**
 * Port of redalert2/src/game/gameobject/task/TurnTask.ts (21 lines).
 *
 * Turns a unit in place until `direction` matches, then reports done. Every
 * locomotor pushes one of these before it starts moving straight, which is why
 * `cancellable = false`: a turn is never interrupted halfway, otherwise the
 * unit's facing and its velocity disagree for a frame and the renderer picks
 * the wrong sprite.
 */
import { Task } from '../Task';
import { FacingUtil } from '../gameobject/unit/FacingUtil';

export class TurnTask extends Task {
    private direction: number;
    public cancellable: boolean = false;

    constructor(direction: number) {
        super();
        this.direction = direction;
    }

    onTick(entity: any): boolean {
        if (entity.direction === this.direction) {
            entity.spinVelocity = 0;
            return true;
        }
        const rotationSpeed = entity.rules.rot;
        const { facing, delta } = FacingUtil.tick(entity.direction, this.direction, rotationSpeed);
        entity.direction = facing;
        entity.spinVelocity = delta;
        return false;
    }
}
