/**
 * Compatibility facade over `gameobject/task/system/**` — **scheduled for
 * deletion in B9, when `game/Game.ts` is replaced by the ported orchestrator.**
 *
 * Before B6a this file *was* the task system: a home-grown `Task` with its own
 * `tick()` driver, a three-state `TaskStatus`, and a `UnitOrders` queue. The
 * faithful port now lives in `sim/gameobject/task/system/`, and that port is
 * materially different in four ways (see `TaskRunner`'s header). This file
 * survives only because the *live* hand-written engine (`game/Game.ts`) and the
 * two harvester tasks written for it (`sim/task/harvester/**`) drive tasks
 * through it. B6c removed the last two reference-faithful tasks from this
 * directory (`TurnTask`, `WaitForBuildUpTask`), so nothing new should be added
 * here.
 *
 * What is shared and what is not:
 *
 *   `TaskStatus`      shared — re-exported from the new enum. The old enum's
 *                     numeric values (Running=0, Cancelling=1, Cancelled=2,
 *                     Finished=3) are gone; nothing compared them numerically,
 *                     only by name.
 *   `Task`            **not** shared. The reference base class has no `onTick`
 *                     and no driver; this subclass adds both back so the legacy
 *                     tasks keep working unchanged.
 *   `WaitTicksTask`…  same constructors, but each gets `tick()` bolted on —
 *                     legacy tasks call `child.tick(unit)`, which the reference
 *                     classes do not have.
 *   `UnitOrders`      legacy. The reference equivalent is `UnitOrderTrait`
 *                     (B6d). Its `tick()` is the naive head-only loop, kept
 *                     because the old entities have no `isSpawned` and
 *                     `TaskRunner` would treat them as despawned and stall.
 */
import { Task as BaseTask } from './gameobject/task/system/Task';
import { TaskStatus } from './gameobject/task/system/TaskStatus';
import { TaskGroup as BaseTaskGroup } from './gameobject/task/system/TaskGroup';
import { CallbackTask as BaseCallbackTask } from './gameobject/task/system/CallbackTask';
import { WaitTicksTask as BaseWaitTicksTask } from './gameobject/task/system/WaitTicksTask';
import { WaitMinutesTask as BaseWaitMinutesTask } from './gameobject/task/system/WaitMinutesTask';

export { TaskStatus };
export { TaskRunner } from './gameobject/task/system/TaskRunner';

/**
 * The pre-port driver: run children to completion, then the body, then finish.
 * Kept as a free function because five different classes need it.
 */
function legacyTick(task: BaseTask, obj: any): boolean {
    if (task.status === TaskStatus.Cancelled || task.status === TaskStatus.Finished) return true;
    if (task.status === TaskStatus.NotStarted) {
        task.status = TaskStatus.Running;
        task.onStart(obj);
    }
    while (task.children.length) {
        const child = task.children[0];
        if ((child as any).tick(obj)) task.children.shift();
        else return false;
    }
    if ((task as any).onTick(obj)) {
        task.onEnd(obj);
        task.status = TaskStatus.Finished;
        return true;
    }
    return false;
}

export class Task extends BaseTask {
    /** Default body so a subclass may omit `onTick` entirely (legacy contract). */
    onTick(_obj: any): boolean {
        return false;
    }

    /**
     * Legacy cancel semantics, reproduced exactly: from any non-finished state
     * the task becomes `Cancelling` (rather than the reference's "only from
     * Running, and throw if NotStarted has children"). The difference matters
     * because `UnitOrders.cancelAllTasks` runs on freshly queued tasks too.
     */
    cancel(_obj?: any): void {
        if (this.status === TaskStatus.Finished) return;
        if (this.cancellable) this.status = TaskStatus.Cancelling;
        for (const child of this.children) child.cancel();
    }

    /**
     * Hard cancel, used when a new order replaces the current one. Not in the
     * reference — it is the pre-port escape hatch that lets a caller drop a
     * non-cancellable child instead of honouring its veto.
     */
    forceCancel(obj: any): boolean {
        if (!this.cancellable || this.children.some((child) => !child.cancellable)) return false;
        for (const child of this.children) child.cancel();
        this.children.length = 0;
        this.status = TaskStatus.Cancelled;
        this.onEnd(obj);
        return true;
    }

    tick(obj: any): boolean {
        return legacyTick(this, obj);
    }
}

export class TaskGroup extends BaseTaskGroup {
    tick(obj: any): boolean {
        return legacyTick(this, obj);
    }
}

export class CallbackTask extends BaseCallbackTask {
    tick(obj: any): boolean {
        return legacyTick(this, obj);
    }
}

export class WaitTicksTask extends BaseWaitTicksTask {
    tick(obj: any): boolean {
        return legacyTick(this, obj);
    }
}

export class WaitMinutesTask extends BaseWaitMinutesTask {
    tick(obj: any): boolean {
        return legacyTick(this, obj);
    }
}

/** Per-unit task queue. Replaced by `UnitOrderTrait` in B6d. */
export class UnitOrders {
    private tasks: Task[] = [];

    addTask(task: Task): void {
        this.tasks.push(task);
    }

    addTasks(...tasks: Task[]): void {
        for (const task of tasks) this.addTask(task);
    }

    addTaskToFront(task: Task): void {
        this.tasks.unshift(task);
    }

    /** insert as the *next* task, behind whatever is running now */
    addTaskNext(task: Task): void {
        this.tasks.splice(1, 0, task);
    }

    getCurrentTask(): Task | undefined {
        return this.tasks[0];
    }

    getTasks(): Task[] {
        return Array.from(this.tasks);
    }

    hasTasks(): boolean {
        return this.tasks.length > 0;
    }

    isIdle(): boolean {
        return this.tasks.length === 0;
    }

    cancelAllTasks(): void {
        for (const task of this.tasks) task.cancel();
    }

    tick(obj: any): void {
        while (this.tasks.length) {
            const task = this.tasks[0];
            if (task.tick(obj)) this.tasks.shift();
            else return;
        }
    }

    clear(_obj?: any): void {
        this.tasks.length = 0;
    }
}
