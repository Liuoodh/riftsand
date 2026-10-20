/**
 * Port of redalert2/src/game/gameobject/task/system/TaskRunner.ts (75 lines).
 *
 * This is where "a task runs" actually happens, and it is materially smarter
 * than the naive `while (queue.length) if (head.tick(obj)) shift()` loop that
 * stood in for it before this port. Four behaviours are easy to get wrong:
 *
 * 1. **Non-blocking tasks are drained in one tick.** `tickChildren` loops over
 *    every task not yet processed, so a queue of three `CallbackTask`s all run
 *    in the same frame. A blocking task breaks the loop instead. That is the
 *    difference between a harvester that evaluates "arrived / blocked / ore
 *    gone" once and one that takes three frames to make up its mind.
 *
 * 2. **`processedTasks` guards against a single task looping forever.** The
 *    loop condition is `find(task => !processedTasks.has(task))`, so a task that
 *    returns `false` (still running) is marked processed and the loop moves on
 *    to the next candidate in the same tick. Without the set, a non-blocking
 *    unfinished task would be re-selected immediately.
 *
 * 3. **`!object.isSpawned` short-circuits everything.** A task on an object that
 *    was disposed mid-tick simply stops; the queue is left intact for whoever
 *    tears the object down.
 *
 * 4. **`waitingForChildrenToFinish` parks a task whose body said "done" too
 *    early.** `onTick` returning `true` while a non-blocking child is still
 *    running flips the flag instead of finishing the parent; the parent is then
 *    re-entered on later ticks until `allChildrenFinished`.
 */
import { TaskStatus } from './TaskStatus';
import { Task } from './Task';

export class TaskRunner {
    tick(tasks: Task[], object: any): void {
        this.tickChildren(tasks, object);
    }

    startTask(task: Task, object: any): void {
        if (task.status !== TaskStatus.NotStarted) {
            throw new Error(`Attempted to start a task with status ${task.status}`);
        }
        task.status = TaskStatus.Running;
        task.onStart(object);
    }

    tickTask(task: Task, object: any): boolean {
        let allChildrenFinished = this.tickChildren(task.children, object);
        const blockingChild = task.children.find((child) => child.blocking);
        if (!allChildrenFinished && blockingChild) return false;
        if (!object.isSpawned) return false;
        if (task.status === TaskStatus.NotStarted) {
            throw new Error('Attempted tick on a non-started task');
        }
        if (task.isRunning() || task.isCancelling()) {
            const isCancelling = task.isCancelling();
            let shouldContinue = !!task.waitingForChildrenToFinish || !!(task as any).onTick(object);
            if (task.children.length && !blockingChild && shouldContinue) {
                allChildrenFinished = task.children.every(
                    (child) => child.status === TaskStatus.Cancelled || child.status === TaskStatus.Finished,
                );
                task.waitingForChildrenToFinish = !allChildrenFinished;
            }
            shouldContinue = shouldContinue && allChildrenFinished;
            if (shouldContinue) {
                task.onEnd(object);
                task.status = isCancelling ? TaskStatus.Cancelled : TaskStatus.Finished;
            }
            return shouldContinue;
        }
        return true;
    }

    tickChildren(tasks: Task[], object: any): boolean {
        let allFinished = true;
        if (tasks.length) {
            const processedTasks = new Set<Task>();
            let currentTask: Task | undefined;
            while (object.isSpawned && (currentTask = tasks.find((task) => !processedTasks.has(task)))) {
                let isFinished: boolean;
                if (currentTask.status === TaskStatus.NotStarted) {
                    this.startTask(currentTask, object);
                }
                if (currentTask.status === TaskStatus.Running || currentTask.status === TaskStatus.Cancelling) {
                    isFinished = this.tickTask(currentTask, object) === true;
                } else {
                    if (currentTask.status !== TaskStatus.Cancelled) {
                        throw new Error(`Unhandled task status ${TaskStatus[currentTask.status]}`);
                    }
                    isFinished = true;
                }
                if (isFinished) {
                    const index = tasks.indexOf(currentTask);
                    if (index !== -1) {
                        tasks.splice(index, 1);
                    }
                } else {
                    allFinished = false;
                    if (currentTask.blocking) break;
                    processedTasks.add(currentTask);
                }
            }
        }
        return allFinished;
    }
}
