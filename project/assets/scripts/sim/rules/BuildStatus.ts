/**
 * BuildStatus — redalert2/src/game/gameobject/Building.ts:32-36.
 *
 * Lives in its own module so sim/traits can compare it without importing the
 * entity layer (Entities re-exports it, so `import { BuildStatus } from
 * '../game/Entities'` keeps working).
 */
export enum BuildStatus {
    BuildUp = 0,
    Ready = 1,
    BuildDown = 2,
}
