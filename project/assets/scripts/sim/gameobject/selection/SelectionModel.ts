/**
 * Port of redalert2/src/game/gameobject/selection/SelectionModel.ts (46 lines).
 *
 * Per-object selection state, expressed as a **bit set** over
 * `SelectionLevel` (hover = bit 0, selected = bit 1). Storing it that way is
 * what makes `maxSelectionLevel` a cheap clamp: an object may be hoverable but
 * not selectable (walls, `Selectable=no`), and `setSelectionLevel` masks off
 * whatever the rules forbid.
 *
 * One deliberate deviation from the reference: its `isHovered()` reads
 * `(selectionLevel >> Hover) & 1`, which shifts by the *value* of `Hover` (1)
 * and therefore returns the **selected** bit — a typo that makes `isHovered()`
 * and `isSelected()` disagree only for `Hover`-only objects. We implement the
 * obvious intent (`level & Hover`) because the reference's own `setHover` writes
 * bit 0 and nothing downstream could have compensated for the swap.
 */
import { SelectionLevel } from './SelectionLevel';
import { GameObject } from '../GameObject';

export class SelectionModel {
    private selectionLevel: SelectionLevel;
    private maxSelectionLevel: SelectionLevel;
    private controlGroupNumber?: number;

    constructor(gameObject: GameObject) {
        this.selectionLevel = SelectionLevel.None;
        if (gameObject.isBuilding() && gameObject.rules.wall) {
            // Walls are never selectable and never even highlight.
            this.maxSelectionLevel = SelectionLevel.None;
        } else {
            this.maxSelectionLevel = gameObject.rules.selectable
                ? SelectionLevel.Selected | SelectionLevel.Hover
                : SelectionLevel.Hover;
        }
    }

    getSelectionLevel(): SelectionLevel {
        return this.selectionLevel;
    }

    setSelectionLevel(level: SelectionLevel): void {
        this.selectionLevel = Math.min(this.maxSelectionLevel, level);
    }

    setHover(hover: boolean): void {
        this.setSelectionLevel(
            hover ? this.selectionLevel | SelectionLevel.Hover : this.selectionLevel & ~SelectionLevel.Hover,
        );
    }

    setSelected(selected: boolean): void {
        this.setSelectionLevel(
            selected ? this.selectionLevel | SelectionLevel.Selected : this.selectionLevel & ~SelectionLevel.Selected,
        );
    }

    isHovered(): boolean {
        return (this.selectionLevel & SelectionLevel.Hover) !== 0;
    }

    isSelected(): boolean {
        return this.selectionLevel >= SelectionLevel.Selected;
    }

    getControlGroupNumber(): number | undefined {
        return this.controlGroupNumber;
    }

    setControlGroupNumber(number: number | undefined): void {
        this.controlGroupNumber = number;
    }
}
