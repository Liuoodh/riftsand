/**
 * Port of redalert2/src/game/gameobject/trait/DockTrait.ts (dock slots, not the
 * sell/destroy side effects).
 *
 * A building owns N dock slots. A unit either *reserves* a slot (on its way in)
 * or *occupies* one (unloading / parked). The distinction matters: a refinery
 * with two harvesters approaching must not let both pick slot 0, and a slot that
 * is reserved but not yet occupied still counts as taken when the queue asks
 * "how many pads are free".
 *
 * The reference keeps `dockTiles` computed from the art's docking offsets; our
 * buildings only need the refinery pad and the air pad, so the tile for slot i
 * comes from `building.dockTileFor(i)` with a right-middle default.
 */
export class DockTrait {
    private building: any;
    private numberOfDocks: number;
    private unitsByDockNumber: Array<any | undefined>;
    private reservedDocks: Array<any | undefined>;
    private dockTiles: any[] = [];

    constructor(building: any, numberOfDocks: number) {
        this.building = building;
        this.numberOfDocks = numberOfDocks;
        this.unitsByDockNumber = new Array(numberOfDocks).fill(undefined);
        this.reservedDocks = new Array(numberOfDocks).fill(undefined);
    }

    getNumberOfDocks(): number { return this.numberOfDocks; }

    /** NotifySpawn */
    onSpawn(): void {
        this.dockTiles = [];
        for (let i = 0; i < this.numberOfDocks; i++) {
            this.dockTiles[i] = this.findDockTile(i);
        }
    }

    /** NotifyUnspawn */
    onUnspawn(): void {
        for (let i = 0; i < this.numberOfDocks; i++) this.unreserveDockAt(i);
    }

    /** NotifyTick: a docked unit that drove off frees its slot */
    onTick(): void {
        for (let i = 0; i < this.numberOfDocks; i++) {
            const unit = this.unitsByDockNumber[i];
            if (unit && unit.tile !== this.getDockTile(i)) this.undockUnit(unit);
        }
    }

    getFirstAvailableDockNumber(): number | undefined {
        const index = this.unitsByDockNumber.findIndex((unit, i) => !unit && !this.reservedDocks[i]);
        return index !== -1 ? index : undefined;
    }

    getAvailableDockCount(): number {
        return this.unitsByDockNumber.filter((unit, i) => !unit && !this.reservedDocks[i]).length;
    }

    getFirstEmptyDockNumber(): number | undefined {
        const index = this.unitsByDockNumber.findIndex((unit) => !unit);
        return index !== -1 ? index : undefined;
    }

    getDockTile(dockIndex: number): any {
        return this.dockTiles[dockIndex];
    }

    getAllDockTiles(): any[] {
        return [...this.dockTiles];
    }

    getDockNumberByTile(tile: any): number | undefined {
        const index = this.dockTiles.indexOf(tile);
        return index !== -1 ? index : undefined;
    }

    private findDockTile(dockIndex: number): any {
        if (typeof this.building.dockTileFor === 'function') {
            const tile = this.building.dockTileFor(dockIndex);
            if (tile) return tile;
        }
        // fallback: one cell past the right edge, the retail DockingOffset layout
        const b = this.building;
        const tx = b.tx + b.size;
        const ty = b.ty + Math.floor(b.size / 2) + dockIndex;
        return b.tileLookup?.(tx, ty);
    }

    /**
     * Reference: a vehicle can use a repair pad, an aircraft can only use a
     * helipad, and a unit with an explicit `dock` list needs the building name.
     */
    isValidUnitForDock(unit: any): boolean {
        const isRepairableVehicle = this.building.unitRepairTrait && unit.isVehicle?.() && !this.building.helipadTrait;
        const isDockableUnit = (unit.rules?.dock ?? []).indexOf(this.building.def?.id) !== -1;
        const navalMatch = !!this.building.rules?.naval === !!unit.rules?.naval;
        return (isRepairableVehicle || isDockableUnit) && navalMatch;
    }

    dockUnitAt(unit: any, dockIndex: number): void {
        if (dockIndex < 0 || dockIndex > this.numberOfDocks - 1) return;
        if (this.unitsByDockNumber[dockIndex]) return;
        this.unitsByDockNumber[dockIndex] = unit;
        if (!unit.dockableTrait) unit.dockableTrait = { dock: undefined, reservedDock: undefined };
        unit.dockableTrait.dock = this.building;
    }

    undockUnitAt(dockIndex: number): void {
        if (dockIndex < 0 || dockIndex > this.numberOfDocks - 1) return;
        const unit = this.unitsByDockNumber[dockIndex];
        if (unit) {
            this.unitsByDockNumber[dockIndex] = undefined;
            unit.dockableTrait.dock = undefined;
        }
    }

    undockUnit(unit: any): void {
        const index = this.unitsByDockNumber.indexOf(unit);
        if (index !== -1) this.undockUnitAt(index);
    }

    isDocked(unit: any): boolean {
        return this.unitsByDockNumber.indexOf(unit) !== -1;
    }

    hasDockedUnits(): boolean {
        return !!this.unitsByDockNumber.find((unit) => unit);
    }

    getDockedUnits(): any[] {
        return this.unitsByDockNumber.filter((unit) => !!unit);
    }

    reserveDockAt(unit: any, dockIndex: number): void {
        if (dockIndex < 0 || dockIndex > this.numberOfDocks - 1) return;
        if (this.reservedDocks[dockIndex]) return;
        this.reservedDocks[dockIndex] = unit;
        if (!unit.dockableTrait) unit.dockableTrait = { dock: undefined, reservedDock: undefined };
        unit.dockableTrait.reservedDock?.dockTrait?.unreserveDockForUnit(unit);
        unit.dockableTrait.reservedDock = this.building;
    }

    unreserveDockAt(dockIndex: number): void {
        if (dockIndex < 0 || dockIndex > this.numberOfDocks - 1) return;
        const unit = this.reservedDocks[dockIndex];
        if (unit) {
            this.reservedDocks[dockIndex] = undefined;
            if (unit.dockableTrait) unit.dockableTrait.reservedDock = undefined;
        }
    }

    unreserveDockForUnit(unit: any): void {
        const index = this.reservedDocks.indexOf(unit);
        if (index !== -1) this.unreserveDockAt(index);
    }

    hasReservedDockForUnit(unit: any): boolean {
        return this.reservedDocks.indexOf(unit) !== -1;
    }

    hasReservedDockAt(dockIndex: number): boolean {
        return !!this.reservedDocks[dockIndex];
    }

    getReservedDockForUnit(unit: any): number | undefined {
        const index = this.reservedDocks.indexOf(unit);
        return index !== -1 ? index : undefined;
    }

    /** a docked unit that walks/drives off the pad is released automatically */
    getDockedUnitsSnapshot(): any[] {
        return [...this.unitsByDockNumber];
    }
}
