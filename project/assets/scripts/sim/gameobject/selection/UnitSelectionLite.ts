/**
 * Port of redalert2/src/game/gameobject/selection/UnitSelectionLite.ts (27 lines).
 *
 * A read-only selection used for **enemy** objects: the AI and the "what is
 * under the cursor" probe only need to know ownership and selectability, not
 * control groups or hover bits.
 *
 * The `reverse().find()` is not incidental. When a cell contains a mix of
 * objects the *last* enemy in insertion order wins, which is what makes a
 * freshly-spawned unit take precedence over the terrain object it appeared on.
 */
import { GameObject } from '../GameObject';

export class UnitSelectionLite {
    private player: any;
    private selectedUnits: Set<GameObject>;

    constructor(player: any) {
        this.player = player;
        this.selectedUnits = new Set();
    }

    update(units: GameObject[]): void {
        const enemyUnit = Array.from(units)
            .reverse()
            .find((unit) => unit.owner !== this.player);
        if (enemyUnit) {
            units = [enemyUnit];
        }
        this.selectedUnits.clear();
        for (const unit of units) {
            if (unit.rules.selectable) {
                this.selectedUnits.add(unit);
            }
        }
    }

    getSelectedUnits(): GameObject[] {
        return Array.from(this.selectedUnits).filter((unit) => !unit.isDestroyed && !unit.isCrashing);
    }

    isSelected(unit: GameObject): boolean {
        return this.selectedUnits.has(unit);
    }
}
