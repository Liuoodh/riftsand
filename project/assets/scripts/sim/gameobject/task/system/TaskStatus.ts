/**
 * Verbatim from redalert2/src/game/gameobject/task/system/TaskStatus.ts.
 *
 * Five states, and the numbering is **not** the order a task visits them in:
 * `Finished` sits at 2 and `Cancelling`/`Cancelled` at 3/4. Do not "tidy" this
 * into lifecycle order — `TaskRunner` serialises the enum name into error
 * messages and the replay format stores the numeric value.
 */
export enum TaskStatus {
    NotStarted = 0,
    Running = 1,
    Finished = 2,
    Cancelling = 3,
    Cancelled = 4,
}
