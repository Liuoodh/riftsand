/**
 * Port of redalert2/src/game/gameobject/trait/CrashableTrait.ts.
 *
 * When an aircraft (or a jumpjet) loses its last hit point the reference does
 * not delete it — `crash()` swaps the trait list for just this trait so the
 * object stops shooting, stops taking orders and keeps falling. Each tick it
 * spins the roll/pitch a little and drops 30 leptons; on ground contact (or out
 * of bounds) the object is finally destroyed.
 *
 * The locomotor-specific parts live behind `CrashWorld`:
 *   - `crashMovement(unit, state)` returns the per-tick movement vector
 *     (WingedLocomotor.tickCrash / JumpjetLocomotor.tickCrash);
 *   - `moveBy(unit, dx, dy, dz)` and `destroyCrashed(unit, attacker)` are the
 *     world calls.
 */
export interface CrashWorld {
    /** per-tick movement, world units (leptons / 256 → px are the caller's business) */
    crashMovement(unit: any, state: any): { x: number; y: number; z: number };
    /** apply a movement delta; returns true when the unit touched the ground */
    moveBy(unit: any, dx: number, dy: number, dz: number): boolean;
    destroyCrashed(unit: any, attackerInfo: any): void;
}

export class CrashableTrait {
    private obj: any;
    private crashingEvtSent = false;
    private crashState: any = {};
    private attackerInfo: any;

    constructor(obj: any) {
        this.obj = obj;
        this.crashingEvtSent = false;
    }

    /** NotifyTick */
    onTick(unit: any, world: CrashWorld): void {
        if (!unit.isCrashing) return;
        if (!this.crashingEvtSent) {
            this.crashingEvtSent = true;
        }
        const movement = world.crashMovement(unit, this.crashState);
        const grounded = world.moveBy(unit, movement.x, movement.y, movement.z);
        if (grounded) {
            this.attackerInfo = this.attackerInfo ?? { player: unit.owner };
            world.destroyCrashed(unit, this.attackerInfo);
        }
    }

    /** `crash(attacker)` — freeze the object into a pure falling body */
    crash(attacker: any): void {
        this.attackerInfo = attacker;
        this.obj.isCrashing = true;
        this.obj.orders?.clear?.(this.obj);
        this.obj.attackTarget = null;
        this.obj.focus = null;
        this.obj.engage = null;
    }

    isCrashing(): boolean {
        return !!this.obj?.isCrashing;
    }

    dispose(): void {
        this.obj = undefined;
    }
}
