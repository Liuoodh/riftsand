/**
 * Port of redalert2/src/game/gameobject/task/PlantC4Task.ts (27 lines).
 *
 * SEAL / Tanya demolition. Two details carry the feel:
 *
 * 1. **`onEnter` returns `false`.** That is the soft-refusal contract of
 *    `EnterBuildingTask`: the charge is set, then the unit is pushed back out
 *    with `MoveOutsideTask` instead of standing inside the building while it
 *    blows up. Returning `true` here would leave the saboteur on the footprint
 *    and he would die to his own charge.
 * 2. **The delay is computed in ticks, not seconds.** `c4Delay` is in minutes,
 *    so `60 * c4Delay * BASE_TICKS_PER_SECOND` — the `60` converts minutes to
 *    seconds. Dropping it makes the charge go off 60× too fast.
 *
 * `isAllowed` only checks "alive and not invulnerable": C4 ignores ownership,
 * which is what lets a Yuri clone plant on his own side's bridge.
 */
import { GameSpeed } from '../../GameSpeed';
import { EnterObjectEvent } from '../../event/EnterObjectEvent';
import { EnterBuildingTask } from './EnterBuildingTask';

export class PlantC4Task extends EnterBuildingTask {
    isAllowed(e: any): boolean {
        return !this.target.isDestroyed && !this.target.invulnerableTrait.isActive();
    }

    onEnter(e: any): boolean {
        const chargeTime = Math.floor(60 * this.game.rules.combatDamage.c4Delay * GameSpeed.BASE_TICKS_PER_SECOND);
        this.target.c4ChargeTrait.setCharge(chargeTime, {
            player: e.owner,
            obj: e,
        });
        this.game.events.dispatch(new EnterObjectEvent(this.target, e));
        return false;
    }

    getTargetLinesConfig(e: any): any {
        return { target: this.target, pathNodes: [], isAttack: true };
    }
}
