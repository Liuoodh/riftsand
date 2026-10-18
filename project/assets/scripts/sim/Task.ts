/**
 * Minimal task system — port of
 *   redalert2/src/game/gameobject/task/system/Task.ts
 *   redalert2/src/game/gameobject/task/system/WaitTicksTask.ts
 *
 * Tasks run one tick at a time, may push children, and stop the parent until a
 * child finishes. MoveTask depends on exactly that: it pushes a TurnTask or a
 * WaitTicksTask and returns `false`, so the unit stands still while the child
 * runs.
 */
export enum TaskStatus {
    Running = 0,
    Cancelling = 1,
    Cancelled = 2,
    Finished = 3,
}

export class Task {
    status: TaskStatus = TaskStatus.Running;
    children: Task[] = [];
    cancellable = true;
    private started = false;

    onStart(_obj: any): void {}
    onTick(_obj: any): boolean {
        return false;
    }
    onEnd(_obj: any): void {}

    isCancelling(): boolean {
        return this.status === TaskStatus.Cancelling;
    }

    cancel(obj?: any): void {
        if (this.status === TaskStatus.Finished) return;
        if (this.cancellable) this.status = TaskStatus.Cancelling;
        for (const child of this.children) child.cancel(obj);
    }

    /** hard cancel, used when a new order replaces the current one */
    forceCancel(obj: any): boolean {
        if (!this.cancellable || this.children.some((child) => !child.cancellable)) return false;
        for (const child of this.children) child.cancel(obj);
        this.children.length = 0;
        this.status = TaskStatus.Cancelled;
        this.onEnd(obj);
        return true;
    }

    tick(obj: any): boolean {
        if (this.status === TaskStatus.Cancelled || this.status === TaskStatus.Finished) return true;
        if (!this.started) {
            this.started = true;
            this.onStart(obj);
        }
        while (this.children.length) {
            const child = this.children[0];
            if (child.tick(obj)) this.children.shift();
            else return false;
        }
        if (this.onTick(obj)) {
            this.onEnd(obj);
            this.status = TaskStatus.Finished;
            return true;
        }
        return false;
    }
}

export class WaitTicksTask extends Task {
    constructor(private ticks: number) {
        super();
    }

    onTick(): boolean {
        return this.isCancelling() || !(this.ticks-- > 0);
    }
}

/** Per-unit task queue (the reference's UnitOrderTrait, trimmed to movement). */
export class UnitOrders {
    private tasks: Task[] = [];

    addTask(task: Task): void {
        this.tasks.push(task);
    }

    getCurrentTask(): Task | undefined {
        return this.tasks[0];
    }

    hasTasks(): boolean {
        return this.tasks.length > 0;
    }

    tick(obj: any): void {
        while (this.tasks.length) {
            const task = this.tasks[0];
            if (task.tick(obj)) this.tasks.shift();
            else return;
        }
    }

    clear(obj?: any): void {
        this.tasks.length = 0;
    }
}
