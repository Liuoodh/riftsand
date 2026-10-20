/**
 * Port of redalert2/src/game/gameobject/task/CaptureBuildingTask.ts (37 lines).
 *
 * Engineer capture. The straightforward part is "unspawn the engineer, change
 * the owner, fire `BuildingCaptureEvent`". The non-obvious part is the
 * `multiEngineer` block, which is the retail rule that an engineer does **not**
 * always capture outright:
 *
 *   - `needsEngineer` structures (tech buildings, derricks) are captured whole
 *     unless `engineerAlwaysCaptureTech` is set;
 *   - anything above `100 * engineerCaptureLevel` percent health is *damaged*
 *     instead, by `engineerDamage * maxHitPoints`, and the engineer dies doing
 *     it. This is why one engineer on a fresh construction yard leaves it at
 *     ~25% and captured, but on a damaged one may not flip it at all.
 *
 * The `minHealth` clamp is the subtle bit. `Math.floor(1 / engineerDamage) *
 * engineerDamage` is "the largest multiple of one engineer's worth of damage
 * that still fits in 100%" — for the default 0.25 that is `4 * 0.25 = 1`, so
 * `minHealth = 0`. The point of the clamp is to never deal *less* than the
 * damage that would leave the structure at a health value where the next
 * engineer can finish it: the split must tile exactly, never round down to 0
 * damage and silently consume the engineer for nothing.
 *
 * `damage > 0` is the guard that makes that possible — a hopeless capture
 * falls through to the ordinary "capture anyway" path rather than doing zero
 * damage and returning.
 */
import { BuildStatus } from '../Building';
import { BuildingCaptureEvent } from '../../event/BuildingCaptureEvent';
import { Warhead } from '../../Warhead';
import { CollisionType } from '../unit/CollisionType';
import { ZoneType } from '../unit/ZoneType';
import { EnterBuildingTask } from './EnterBuildingTask';

export class CaptureBuildingTask extends EnterBuildingTask {
    isAllowed(e: any): boolean {
        return (
            e.rules.engineer &&
            this.target.rules.capturable &&
            !this.target.isDestroyed &&
            this.target.buildStatus !== BuildStatus.BuildDown &&
            !this.game.areFriendly(e, this.target)
        );
    }

    onEnter(engineer: any): void {
        this.game.unspawnObject(engineer);
        if (this.game.gameOpts.multiEngineer) {
            const generalRules = this.game.rules.general;
            if (
                (!this.target.rules.needsEngineer || !generalRules.engineerAlwaysCaptureTech) &&
                this.target.healthTrait.health > 100 * generalRules.engineerCaptureLevel
            ) {
                let damage = Math.floor(generalRules.engineerDamage * this.target.healthTrait.maxHitPoints);
                const minHealth = Math.floor(
                    (1 - Math.floor(1 / generalRules.engineerDamage) * generalRules.engineerDamage) *
                        this.target.healthTrait.maxHitPoints,
                );
                damage = Math.min(damage, this.target.healthTrait.getHitPoints() - minHealth);
                if (damage > 0) {
                    const warheadId = this.game.rules.combatDamage.c4Warhead;
                    const warhead = new Warhead(this.game.rules.getWarhead(warheadId));
                    warhead.detonate(
                        this.game,
                        damage,
                        this.target.tile,
                        0,
                        this.target.position.worldPosition,
                        ZoneType.Ground,
                        CollisionType.None,
                        this.game.createTarget(this.target, this.target.tile),
                        { player: engineer.owner, obj: engineer, weapon: undefined } as any,
                        false,
                        undefined,
                        0,
                    );
                    return;
                }
            }
        }
        engineer.owner.buildingsCaptured++;
        this.game.changeObjectOwner(this.target, engineer.owner);
        this.game.events.dispatch(new BuildingCaptureEvent(this.target));
    }
}
