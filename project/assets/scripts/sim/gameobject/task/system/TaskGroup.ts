/**
 * Verbatim from redalert2/src/game/gameobject/task/system/TaskGroup.ts (10 lines).
 *
 * Runs its children in order. The trick is that `onTick` returns `true` on the
 * very first call: the runner drains `children` before it ever reaches the body,
 * so `onTick` only runs once the queue is empty — and by then the group is done
 * by definition. Written any other way, a group would report "finished" while
 * its children were still moving.
 */
import { Task } from './Task';

export class TaskGroup extends Task {
    constructor(...tasks: Task[]) {
        super();
        this.children.push(...tasks);
    }

    onTick(_object: any): boolean {
        return true;
    }
}
