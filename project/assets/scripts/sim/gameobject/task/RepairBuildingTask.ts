/**
 * Port of redalert2/src/game/gameobject/task/RepairBuildingTask.ts (27 lines).
 *
 * The engineer's two jobs share one task because they share the approach:
 * repair a damaged structure, or repair a **bridge control hut**.
 *
 * The cab-hut branch is unconditional — if the target has `cabHutTrait`, the
 * engineer fixes the bridge, full stop. That is why the `else` carries every
 * other condition: a hut is never "too healthy to repair", because the check
 * would be meaningless (`healthTrait.health` of a hut is the bridge's, not the
 * hut's).
 *
 * `healthTrait.healToFull` takes the engineer and the game so the healing can
 * be attributed (veterancy, "unit repaired" event) rather than silently setting
 * `health = 100`.
 *
 * `!target.owner.isCombatant() && !!target.garrisonTrait` lets an engineer
 * repair a *neutral* garrisonable structure — the civilian clinic and the
 * hospital — which is otherwise unreachable because `areFriendly` is false.
 */
import { BuildingRepairFullEvent } from '../../event/BuildingRepairFullEvent';
import { BridgeRepairEvent } from '../../event/BridgeRepairEvent';
import { EnterBuildingTask } from './EnterBuildingTask';

export class RepairBuildingTask extends EnterBuildingTask {
    isAllowed(e: any): boolean {
        return this.target.cabHutTrait
            ? this.target.cabHutTrait.canRepairBridge()
            : e.rules.engineer &&
                  !this.target.isDestroyed &&
                  this.target.rules.repairable &&
                  this.target.healthTrait.health < 100 &&
                  ((!this.target.owner.isCombatant() && !!this.target.garrisonTrait) ||
                      this.game.areFriendly(e, this.target));
    }

    onEnter(e: any): void {
        this.game.unspawnObject(e);
        if (this.target.cabHutTrait) {
            this.target.cabHutTrait.repairBridge(this.game, e.owner);
            this.game.events.dispatch(new BridgeRepairEvent(e.owner, this.target.centerTile));
        } else {
            this.target.healthTrait.healToFull(e, this.game);
            this.game.events.dispatch(new BuildingRepairFullEvent(this.target, e.owner));
        }
    }
}
