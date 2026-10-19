/**
 * Port of redalert2/src/game/gameobject/trait/TurretTrait.ts.
 *
 * The turret owns its own facing; nothing here aims it. AttackTask (or, in this
 * project, Game.updateCombatant) writes `desiredFacing`, and the trait rotates
 * one step per tick at `rules.rot` degrees. A turret is "ready to fire" only
 * when `isRotating()` is false — that is the check the retail attack task blocks
 * on, and the reason a tank does not shoot sideways while the barrel swings.
 */
import { FacingUtil } from '../Math2';

export class TurretTrait {
    private facing = 0;
    private desiredFacing = 0;

    isRotating(): boolean {
        return this.facing !== this.desiredFacing;
    }

    getFacing(): number { return this.facing; }
    getDesiredFacing(): number { return this.desiredFacing; }

    setDesiredFacing(facing: number): void {
        this.desiredFacing = ((facing % 360) + 360) % 360;
    }

    /** NotifySpawn: start aligned with the hull, not at 0 */
    onSpawn(target: any): void {
        if (target.isUnit?.()) {
            this.facing = this.desiredFacing = target.direction;
        }
    }

    /** NotifyTick */
    onTick(gameObject: any): void {
        if (this.desiredFacing !== this.facing) {
            const rotationSpeed = gameObject.rules.rot;
            this.facing = FacingUtil.tick(
                this.facing,
                this.desiredFacing,
                rotationSpeed || Number.POSITIVE_INFINITY,
            ).facing;
        }
    }
}
