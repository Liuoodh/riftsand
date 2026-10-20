/**
 * Port of redalert2/src/game/gameobject/task/EnterBunkerTask.ts (19 lines).
 *
 * A tank bunker is the one structure that accepts *vehicles*: the unit is
 * limboed (removed from the map but not destroyed) and stored in the bunker's
 * trait, where it keeps firing through the bunker's armour.
 *
 * `isAllowed` is deliberately friendship-gated and occupancy-gated but **not**
 * `rules.engineer`-gated — any friendly vehicle may climb in. The control group
 * is carried across the limbo so the unit is still selectable as part of the
 * group it belongs to; dropping it would silently shrink the player's group.
 */
import { EnterBuildingTask } from './EnterBuildingTask';

export class EnterBunkerTask extends EnterBuildingTask {
    isAllowed(e: any): boolean {
        return (
            !this.target.isDestroyed &&
            !!this.target.tankBunkerTrait &&
            !this.target.tankBunkerTrait.isOccupied() &&
            this.game.areFriendly(e, this.target)
        );
    }

    onEnter(e: any): void {
        this.game.limboObject(e, {
            selected: false,
            controlGroup: this.game.getUnitSelection().getOrCreateSelectionModel(e).getControlGroupNumber(),
        });
        this.target.tankBunkerTrait.store(e, this.game);
    }
}
