/**
 * Port of redalert2/src/game/gameobject/task/system/Task.ts (55 lines).
 *
 * The base class is **deliberately inert**: it has no `onTick`, no driver loop,
 * and never mutates its own status except in `cancel`. Everything that looks
 * like "run the task" lives in `TaskRunner`. Two consequences worth knowing:
 *
 * 1. A subclass that only overrides `onTick` does nothing until a `TaskRunner`
 *    ticks it. `Task.tick()` does not exist — the B5a-era helper that had one
 *    was a simplification that silently serialised the whole queue.
 * 2. `waitingForChildrenToFinish` is the only mutable flag the runner writes
 *    back. It exists for the "fire-and-forget child" case: a task whose `onTick`
 *    returns `true` while a non-blocking child is still running gets parked
 *    here until that child finishes, instead of completing early.
 *
 * Two defaults are counter-intuitive and load-bearing:
 *
 *   `preventOpportunityFire = true` — units do **not** shoot while a task runs,
 *   unless the task opts out. `MoveTask` opts out; `TurnTask` does not.
 *   `blocking = true` — the runner stops at the first unfinished blocking task
 *   instead of draining the rest of the queue in the same tick.
 */
import { TaskStatus } from './TaskStatus';
import type { TargetLinesConfig } from './TargetLinesConfig';

export class Task {
    status: TaskStatus;
    children: Task[];
    cancellable: boolean;
    useChildTargetLines: boolean;
    blocking: boolean;
    waitingForChildrenToFinish: boolean;
    preventOpportunityFire: boolean;
    preventLanding: boolean;
    isAttackMove: boolean;

    constructor() {
        this.status = TaskStatus.NotStarted;
        this.children = [];
        this.cancellable = true;
        this.useChildTargetLines = false;
        this.blocking = true;
        this.waitingForChildrenToFinish = false;
        this.preventOpportunityFire = true;
        this.preventLanding = true;
        this.isAttackMove = false;
    }

    isRunning(): boolean {
        return this.status === TaskStatus.Running;
    }

    isCancelling(): boolean {
        return this.status === TaskStatus.Cancelling;
    }

    setCancellable(value: boolean): this {
        this.cancellable = value;
        return this;
    }

    setBlocking(value: boolean): this {
        this.blocking = value;
        return this;
    }

    onStart(_object: any): void {}

    onEnd(_object: any): void {}

    /**
     * Cancels a *running* task by moving it to `Cancelling` — the runner then
     * gives it one more `onTick` so it can clean up (drop a path, retract a
     * turret). A `NotStarted` task with children is a programming error in the
     * reference and throws rather than silently corrupting the queue.
     */
    cancel(): void {
        if (!this.cancellable) return;
        if (this.status === TaskStatus.Running) {
            this.status = TaskStatus.Cancelling;
            if (this.children.length) {
                this.children.forEach((child) => child.cancel());
            }
        } else if (this.status === TaskStatus.NotStarted && this.children.length) {
            this.status = TaskStatus.Cancelled;
            throw new Error("Should't have any children before starting a task");
        }
    }

    getTargetLinesConfig(_object: any): TargetLinesConfig | undefined {
        return undefined;
    }
}
