/**
 * Verbatim from redalert2/src/game/gameobject/task/system/CallbackTask.ts (12 lines).
 *
 * A one-tick task whose whole body is a closure. The harvester tasks rely on it
 * to inspect `moveTrait.lastMoveResult` the tick *after* a MoveTask finished —
 * reading it from the MoveTask's own `onEnd` would see the value from before the
 * final tick, and without the extra tick a blocked truck would rebuild an
 * identical path every frame.
 */
import { Task } from './Task';

export class CallbackTask extends Task {
    private cb: (unit: any) => void;

    constructor(cb: (unit: any) => void) {
        super();
        this.cb = cb;
    }

    onTick(unit: any): boolean {
        this.cb(unit);
        return true;
    }
}
