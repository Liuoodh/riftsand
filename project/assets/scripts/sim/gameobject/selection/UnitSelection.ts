/**
 * Port of redalert2/src/game/gameobject/selection/UnitSelection.ts (104 lines).
 *
 * The player's selection: a `Set` of objects, a lazily built `SelectionModel`
 * per object, and eight control groups.
 *
 * Two details are worth the port:
 *
 * 1. `getSelectedUnits()` **filters on read** — destroyed, crashing, disposed
 *    and unspawned objects are dropped from the result but stay in the set until
 *    `cleanupUnit` runs. That ordering is what lets a unit die mid-frame and
 *    still be rendered one last time as selected (so the selection ring fades
 *    with the death animation instead of vanishing a frame early).
 * 2. `hashNeedsUpdate` / `getHash()` is the replay checksum: it must be stable
 *    across runs, so it hashes object **ids**, not set iteration order.
 */
import { SelectionModel } from './SelectionModel';
import { fnv32a } from '../../util/math';
import { GameObject } from '../GameObject';

export class UnitSelection {
    private selectedUnits: Set<GameObject>;
    private selectionModelsByUnit: Map<GameObject, SelectionModel>;
    private groups: Map<number, Set<GameObject>>;
    private hashNeedsUpdate: boolean;
    private hash: number;

    constructor() {
        this.selectedUnits = new Set();
        this.selectionModelsByUnit = new Map();
        this.groups = new Map();
        this.hashNeedsUpdate = true;
        this.hash = 0;
    }

    getOrCreateSelectionModel(unit: GameObject): SelectionModel {
        let model = this.selectionModelsByUnit.get(unit);
        if (!model) {
            model = new SelectionModel(unit);
            this.selectionModelsByUnit.set(unit, model);
        }
        return model;
    }

    deselectAll(): void {
        this.selectedUnits.forEach((unit) => this.selectionModelsByUnit.get(unit)?.setSelected(false));
        this.selectedUnits.clear();
        this.hashNeedsUpdate = true;
    }

    addToSelection(unit: GameObject): void {
        this.selectedUnits.add(unit);
        this.getOrCreateSelectionModel(unit).setSelected(true);
        this.hashNeedsUpdate = true;
    }

    removeFromSelection(units: GameObject[]): void {
        units.forEach((unit) => {
            this.selectedUnits.delete(unit);
            this.getOrCreateSelectionModel(unit).setSelected(false);
        });
        this.hashNeedsUpdate = true;
    }

    getSelectedUnits(): GameObject[] {
        return Array.from(this.selectedUnits).filter(
            (unit) => !unit.isDestroyed && !unit.isCrashing && !unit.isDisposed && unit.isSpawned,
        );
    }

    isSelected(unit: GameObject): boolean {
        return this.selectedUnits.has(unit);
    }

    cleanupUnit(unit: GameObject): void {
        this.selectionModelsByUnit.delete(unit);
        this.selectedUnits.delete(unit);
        this.removeUnitsFromGroup([unit]);
        this.hashNeedsUpdate = true;
    }

    updateHash(): void {
        this.hash = fnv32a(Array.from(this.selectedUnits).map((unit) => unit.id));
    }

    getHash(): number {
        if (this.hashNeedsUpdate) {
            this.updateHash();
            this.hashNeedsUpdate = false;
        }
        return this.hash;
    }

    createGroup(groupNumber: number): void {
        this.addUnitsToGroup(groupNumber, this.getSelectedUnits());
    }

    addUnitsToGroup(groupNumber: number, units: GameObject[], clearExisting: boolean = true): void {
        // Re-assigning a unit removes it from whichever group held it before.
        this.removeUnitsFromGroup(units);
        let group = this.groups.get(groupNumber);
        if (!group) {
            group = new Set();
            this.groups.set(groupNumber, group);
        }
        if (clearExisting) {
            Array.from(group.values()).forEach((unit) => this.selectionModelsByUnit.get(unit)?.setControlGroupNumber(undefined));
            group.clear();
        }
        for (const unit of units) {
            group.add(unit);
            this.getOrCreateSelectionModel(unit).setControlGroupNumber(groupNumber);
        }
    }

    addGroupToSelection(groupNumber: number): void {
        if (this.groups.has(groupNumber)) {
            for (const unit of Array.from(this.groups.get(groupNumber)!)) {
                this.addToSelection(unit);
            }
        }
    }

    selectGroup(groupNumber: number): void {
        this.deselectAll();
        this.addGroupToSelection(groupNumber);
    }

    getGroupUnits(groupNumber: number): GameObject[] {
        return Array.from(this.groups.get(groupNumber) ?? []);
    }

    removeUnitsFromGroup(units: GameObject[]): void {
        for (const group of this.groups.values()) {
            for (const unit of units) {
                group.delete(unit);
                this.selectionModelsByUnit.get(unit)?.setControlGroupNumber(undefined);
            }
        }
    }
}
