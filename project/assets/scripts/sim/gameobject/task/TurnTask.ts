/**
 * Port of redalert2/src/game/gameobject/task/TurnTask.ts (21 lines).
 *
 * Turns a unit in place until `direction` matches, then reports done. Every
 * locomotor pushes one of these before it starts moving straight, which is why
 * `cancellable = false`: a turn is never interrupted halfway, otherwise the
 * unit's facing and its velocity disagree for a frame and the renderer picks
 * the wrong sprite.
 *
 * `spinVelocity` is the *signed* delta the turn produced this tick, not the
 * target facing — the renderer rolls the hull by it. It must be zeroed on the
 * final tick, otherwise a unit that finished turning keeps a permanent bank.
 *
 * Note this task does nothing per tick except rotate: it is driven by the
 * owning `TaskRunner`, so `onTick` returning `false` just means "still
 * turning". A `direction` that is already exact completes on the very first
 * tick without touching `direction`.
 */
import { Task } from './system/Task';
import { FacingUtil } from '../unit/FacingUtil';

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
