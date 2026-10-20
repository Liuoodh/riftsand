/**
 * Port of redalert2/src/game/gameobject/task/GarrisonBuildingTask.ts (36 lines).
 *
 * Infantry garrisoning — and, for a *neutral* civilian structure, capturing it
 * on the way in. That dual role is the whole subtlety of this file:
 *
 *   - `isAllowed` requires the garrison to be non-full, unowned-or-friendly,
 *     and manned by a single owner already (so two players cannot end up
 *     sharing one building — `units[0].owner !== e.owner` rejects a mixed
 *     stack, which would otherwise be reachable by walking in after a capture).
 *   - `mindControllableTrait.isActive()` refuses a mind-controlled infantryman:
 *     otherwise Yuri could garrison his own puppets to launder the control.
 *   - On entry, the owner change happens **only** when the building was neutral
 *     and empty. An own/allied garrisonable (the Bio Reactor) must not be
 *     re-owned by the first soldier who walks in, and the comment in the
 *     reference is explicit about that.
 *   - `updateOccupantWeapons` runs last, after the unit is in `units`, because
 *     it recomputes which weapon the building fires from the occupant list.
 *
 * The power bonus is pushed through `powerTrait.updateFrom` rather than a
 * boolean flip so the grid recomputes its totals once, not once per occupant.
 */
import { BuildingGarrisonEvent } from '../../event/BuildingGarrisonEvent';
import { EnterBuildingTask } from './EnterBuildingTask';

export class GarrisonBuildingTask extends EnterBuildingTask {
    isAllowed(e: any): boolean {
        return (
            !this.target.isDestroyed &&
            !!this.target.garrisonTrait?.canBeOccupied() &&
            this.target.garrisonTrait.units.length < this.target.garrisonTrait.maxOccupants &&
            !(this.target.garrisonTrait.units.length && this.target.garrisonTrait.units[0].owner !== e.owner) &&
            (this.target.owner.isNeutral || this.game.areFriendly(e, this.target)) &&
            !e.mindControllableTrait?.isActive()
        );
    }

    onEnter(e: any): void {
        this.game.limboObject(e, {
            selected: false,
            controlGroup: this.game.getUnitSelection().getOrCreateSelectionModel(e).getControlGroupNumber(),
        });
        const garrisonTrait = this.target.garrisonTrait;
        // Occupying a neutral (civilian) building claims it; entering an
        // own/allied garrisonable like the Bio Reactor must not.
        if (!garrisonTrait.units.length && this.target.owner.isNeutral) {
            e.owner.buildingsCaptured++;
            this.game.changeObjectOwner(this.target, e.owner);
            this.game.events.dispatch(new BuildingGarrisonEvent(this.target));
        }
        garrisonTrait.units.push(e);
        if (this.target.rules.occupantsPowerBonus && this.target.rules.power > 0) {
            this.target.owner.powerTrait?.updateFrom(this.target, 'update', this.game);
        }
        garrisonTrait.updateOccupantWeapons(this.game);
    }
}
