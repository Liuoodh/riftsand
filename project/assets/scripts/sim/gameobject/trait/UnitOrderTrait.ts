/**
 * Port of redalert2/src/game/gameobject/trait/UnitOrderTrait.ts (229 lines).
 *
 * The order queue — and the only thing that drives tasks. Every techno gets
 * exactly one, added *to the front* of its trait list by `ObjectFactory` so it
 * ticks before anything that reads `getCurrentTask()`.
 *
 * The tick is a two-stage pipeline, and the stages are not interchangeable:
 *
 * **Stage 1 — run the current task.** `TaskRunner.tick` advances blocking tasks
 * until one refuses to finish. If the object died mid-tick, return before
 * touching the order queue.
 *
 * **Stage 2 — promote orders into tasks.** Only when there are no tasks, or the
 * head task is *cancelling*, does the queue get a chance. The `while` loop pops
 * **one productive order per tick** (`if (processedOrder) break`), which is what
 * keeps a queued move-then-attack from teleporting the unit two orders forward in
 * a single frame. Each popped order advances the shared `waypointPath` cursor —
 * this is how a multi-unit move order hands the next waypoint to each unit as it
 * finishes the previous one.
 *
 * Details that are easy to lose:
 *
 *   - **`queuedOrders`** marks orders the player shift-queued. A queued order
 *     that produces tasks injects a `WaitTicksTask(5)` + `resetGuardModeToIdle`
 *     *first*, so the unit visibly finishes its current business before starting
 *     the next. Without it, a shift-queued move looks like the unit never stopped.
 *   - **`addOrder` filters `NotStarted` tasks and cancels the rest.** The filter
 *     runs before the cancel loop: a freshly added task must not be cancelled by
 *     the order that created it.
 *   - **Target lines do not come from the head task.** `targetTask` walks down
 *     `useChildTargetLines` so a `MoveToDockTask`'s inner move draws the line.
 *     The walk stops at the first cancelling child.
 *   - **Waypoint bookkeeping is reference-counted.** `cleanupWaypoint` only
 *     splices a waypoint out when no *other* unit still points at it, and no
 *     waypoint's `next` refers to it. Getting this wrong leaves dangling `next`
 *     pointers that make a group move loop forever.
 */
import { TaskRunner } from '../task/system/TaskRunner';
import { TaskStatus } from '../task/system/TaskStatus';
import { NotifyTick } from './interface/NotifyTick';
import { WaitTicksTask } from '../task/system/WaitTicksTask';
import { NotifyOwnerChange } from './interface/NotifyOwnerChange';
import { CallbackTask } from '../task/system/CallbackTask';
import { NotifyTeleport } from './interface/NotifyTeleport';
import { NotifyOrder } from './interface/NotifyOrder';

interface GameObject {
    isSpawned: boolean;
    resetGuardModeToIdle(): void;
    traits: { filter(type: any): any[] };
    unitOrderTrait: UnitOrderTrait;
}

interface Task {
    isCancelling(): boolean;
    cancel(): void;
    status: TaskStatus;
    useChildTargetLines?: boolean;
    children?: Task[];
    getTargetLinesConfig?(gameObject: GameObject): any;
}

interface Order {
    isValid(): boolean;
    isAllowed(): boolean;
    process(): Task[] | null;
    onAdd(tasks: Task[], queued: boolean): boolean | void;
    orderType: string;
}

interface Waypoint {
    next?: Waypoint;
}

interface WaypointPath {
    waypoints: Waypoint[];
    units: GameObject[];
}

export class UnitOrderTrait {
    private gameObject: GameObject;
    private orders: Order[] = [];
    private queuedOrders = new Set<Order>();
    private tasks: Task[] = [];
    private taskRunner = new TaskRunner();
    private waypointPath?: WaypointPath;
    private currentWaypoint?: Waypoint;
    private targetLinesTask?: Task;
    private targetLinesConfig?: any;

    constructor(gameObject: GameObject) {
        this.gameObject = gameObject;
    }

    [NotifyTick.onTick](gameObject: GameObject, deltaTime: number): void {
        if (!gameObject.isSpawned) return;
        const hasTasks = this.hasTasks();
        const currentTask = this.tasks.find((task) => !task.isCancelling());
        if (hasTasks) {
            this.taskRunner.tick(this.tasks as any, gameObject);
        }
        if (!gameObject.isSpawned) return;
        const orderCount = this.orders.length;
        if (orderCount && (!hasTasks || !currentTask)) {
            let processedOrder = false;
            while (this.orders.length > 0) {
                const order = this.orders[0];
                if (order.isValid() && order.isAllowed()) {
                    const newTasks = order.process();
                    if (newTasks) {
                        if (this.queuedOrders.has(order)) {
                            this.tasks.push(new WaitTicksTask(5) as any);
                            this.tasks.push(
                                new CallbackTask(() => {
                                    gameObject.resetGuardModeToIdle();
                                }) as any,
                            );
                        }
                        this.tasks.push(...newTasks);
                        if (!hasTasks) {
                            this.taskRunner.tick(this.tasks as any, gameObject);
                        }
                    }
                    processedOrder = true;
                }
                this.orders.shift();
                this.queuedOrders.delete(order);
                if (!gameObject.isSpawned) return;
                if (this.waypointPath) {
                    if (this.currentWaypoint) {
                        this.cleanupWaypoint(this.currentWaypoint, this.waypointPath);
                        this.currentWaypoint = this.currentWaypoint.next;
                    } else {
                        this.currentWaypoint = this.waypointPath.waypoints[0];
                    }
                    if (!this.currentWaypoint) {
                        this.cleanupWaypointPath();
                    }
                }
                if (processedOrder) break;
            }
        }
        if (!orderCount && !hasTasks && this.waypointPath && this.currentWaypoint) {
            this.cleanupWaypoint(this.currentWaypoint, this.waypointPath);
            this.cleanupWaypointPath();
        }
        let targetTask = currentTask;
        while (targetTask?.useChildTargetLines) {
            const childTask = targetTask.children?.find((child) => !child.isCancelling());
            if (!childTask) break;
            targetTask = childTask;
        }
        if (this.targetLinesTask !== targetTask) {
            this.targetLinesTask = targetTask;
            this.targetLinesConfig = targetTask?.getTargetLinesConfig?.(this.gameObject);
        }
    }

    [NotifyOwnerChange.onChange](): void {
        this.clearOrders();
        this.cancelAllTasks();
    }

    [NotifyTeleport.onBeforeTeleport](
        gameObject: GameObject,
        fromPos: any,
        toPos: any,
        crossRealm: boolean,
    ): void {
        if (toPos && !crossRealm) {
            this.clearOrders();
            this.tasks.length = 0;
        }
    }

    /**
     * `onAdd` returning exactly `false` is the "I refuse this order" contract —
     * note the strict comparison, because an order that returns `undefined` is
     * merely indifferent and must still be queued.
     */
    addOrder(order: Order, queued = false): void {
        const addResult = order.onAdd(this.tasks, queued);
        if (addResult === false) {
            this.targetLinesTask = undefined;
            return;
        }
        if (!queued) {
            this.clearOrders();
            this.tasks = this.tasks.filter((task) => task.status !== TaskStatus.NotStarted);
            this.tasks.forEach((task) => task.cancel());
        }
        this.orders.push(order);
        if (queued) {
            this.queuedOrders.add(order);
        }
        this.gameObject.traits.filter(NotifyOrder).forEach((trait: any) => {
            trait[NotifyOrder.onPush](this.gameObject, order.orderType);
        });
    }

    clearOrders(): void {
        this.orders.length = 0;
        this.queuedOrders.clear();
        if (this.currentWaypoint && this.waypointPath) {
            this.cleanupWaypoint(this.currentWaypoint, this.waypointPath);
        }
        this.cleanupWaypointPath();
        this.gameObject.resetGuardModeToIdle();
    }

    /** Called when a transport unloads: the next queued order is now a real one. */
    unmarkNextQueuedOrder(): void {
        if (this.orders.length > 0) {
            this.queuedOrders.delete(this.orders[0]);
        }
    }

    hasTasks(): boolean {
        return this.tasks.length > 0;
    }

    isIdle(): boolean {
        return this.orders.length === 0 && this.tasks.length === 0;
    }

    getCurrentTask(): Task | undefined {
        return this.tasks[0];
    }

    cancelAllTasks(): void {
        this.tasks.forEach((task) => task.cancel());
    }

    addTask(task: Task): void {
        this.tasks.push(task);
    }

    addTasks(...tasks: Task[]): void {
        tasks.forEach((task) => this.addTask(task));
    }

    addTaskToFront(task: Task): void {
        this.tasks.unshift(task);
    }

    /** Insert as the *next* task, behind whatever is running now. */
    addTaskNext(task: Task): void {
        this.tasks.splice(1, 0, task);
    }

    getTasks(): Task[] {
        return [...this.tasks];
    }

    dispose(): void {
        this.clearOrders();
        this.tasks.length = 0;
        this.gameObject = undefined as any;
    }

    private cleanupWaypointPath(): void {
        if (!this.waypointPath) return;
        const unitIndex = this.waypointPath.units.indexOf(this.gameObject);
        if (unitIndex !== -1) {
            this.waypointPath.units.splice(unitIndex, 1);
        }
        if (this.waypointPath.units.length === 0) {
            this.waypointPath.waypoints.forEach((waypoint) => {
                waypoint.next = undefined;
            });
            this.waypointPath.waypoints.length = 0;
        }
        this.waypointPath = undefined;
        this.currentWaypoint = undefined;
    }

    private cleanupWaypoint(waypoint: Waypoint, waypointPath: WaypointPath): void {
        const isWaypointInUse = waypointPath.units.find((unit) => {
            if (unit === this.gameObject) return false;
            const otherCurrentWaypoint =
                unit.unitOrderTrait.currentWaypoint ?? unit.unitOrderTrait.waypointPath?.waypoints[0];
            return otherCurrentWaypoint === waypoint;
        });
        const isReferencedAsNext = waypointPath.waypoints.find((wp) => wp.next === waypoint);
        if (!isWaypointInUse && !isReferencedAsNext) {
            const waypointIndex = waypointPath.waypoints.indexOf(waypoint);
            if (waypointIndex === -1) {
                throw new Error('Given waypoint not found in waypoint path');
            }
            waypointPath.waypoints.splice(waypointIndex, 1);
        }
    }
}
