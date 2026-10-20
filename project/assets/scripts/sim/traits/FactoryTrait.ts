/**
 * Port of redalert2/src/game/gameobject/trait/FactoryTrait.ts.
 *
 * The trait owns two things the rest of the sim depends on:
 *   1. the *exit cell* of a factory (bottom-left for a barracks, mid-right for a
 *      war factory) — the produced unit appears inside the footprint and then
 *      drives out, exactly like retail, instead of popping into the open;
 *   2. the delivering handshake — a factory stays busy until its unit has
 *      cleared the footprint, which is what spaces vehicles out.
 *
 * `world` is Game; the methods it must provide are listed in `FactoryWorld`.
 */
import { FactoryType } from '../player/Production';
import { QueueStatus } from '../player/ProductionQueue';
import { BuildStatus } from '../rules/BuildStatus';
import { RadialTileFinder } from '../map/tileFinder/RadialTileFinder';

export enum FactoryStatus {
    Idle = 0,
    Delivering = 1,
}

export interface FactoryWorld {
    tiles: any;
    mapBounds: any;
    passability: any;
    tileOccupation: any;
    general: { closeEnough: number };
    createUnitForPlayer(rules: any, owner: any): any;
    spawnObject(unit: any, tile: any): void;
    startExitMove(unit: any, building: any, rallyPoint: any): void;
    isTileOccupiedBy(tile: any, building: any): boolean;
    /*
     * In the reference `building.owner` is the player object. Here `owner` is a
     * numeric player id, so every roster lookup goes through the world.
     */
    getProduction(owner: any): any;
    getBuildings(owner: any): any[];
    getPlayer(owner: any): any;
}

export class FactoryTrait {
    type: FactoryType;
    isCloningVats: boolean;
    status: FactoryStatus = FactoryStatus.Idle;
    deliveringUnit?: any;
    private exitRetryTicks = 0;

    constructor(type: FactoryType, isCloningVats = false) {
        this.type = type;
        this.isCloningVats = isCloningVats;
    }

    /** NotifySpawn */
    onSpawn(building: any, world: FactoryWorld): void {
        this.resetRallyPoint(building, world);
    }

    resetRallyPoint(building: any, world: FactoryWorld): void {
        if (this.type === FactoryType.BuildingType || this.type === FactoryType.AircraftType) return;
        const rallyPoint = this.computeDefaultRallyPoint(building, this.type, world);
        building.rallyTrait?.changeRallyPoint(rallyPoint, building, world);
    }

    /** NotifyTick */
    onTick(building: any, world: FactoryWorld): void {
        if (this.status === FactoryStatus.Delivering) {
            const unit = this.deliveringUnit;
            if (!unit || unit.dead) {
                this.deliveringUnit = undefined;
                this.status = FactoryStatus.Idle;
                return;
            }
            if (world.isTileOccupiedBy(unit.tile, building)) {
                // self-heal: an exit task that died must not wedge the factory
                if (unit.orders && !unit.orders.hasTasks() && this.exitRetryTicks-- <= 0) {
                    this.exitRetryTicks = 90;
                    world.startExitMove(unit, building, building.rallyTrait?.getRallyPoint?.() ?? unit.tile);
                }
                return;
            }
            this.status = FactoryStatus.Idle;
            this.deliveringUnit = undefined;
            return;
        }

        const production = world.getProduction(building.owner);
        if (!production || building.status === BuildStatus.BuildDown) return;
        const primaryFactory = production.getPrimaryFactory(this.type);
        if (
            (primaryFactory === building || primaryFactory?.factoryTrait?.deliveringUnit) &&
            this.type !== FactoryType.BuildingType
        ) {
            const queue = production.getQueueForFactory(this.type);
            if (queue && queue.status === QueueStatus.Ready) {
                const item = queue.getFirst();
                if (!item) return;
                if (this.type === FactoryType.AircraftType) {
                    let produced = this.produceAircraftAt(building, item, world);
                    if (!produced) {
                        for (const airport of world.getBuildings(building.owner)) {
                            if (produced) break;
                            if (airport.factoryTrait?.type === FactoryType.AircraftType && airport.helipadTrait) {
                                produced = this.produceAircraftAt(airport, item, world);
                            }
                        }
                    }
                    if (!produced) return;
                } else {
                    this.produceGroundUnitAt(building, item, world);
                    if (!this.isCloningVats && this.type === FactoryType.InfantryType) {
                        for (const vat of world.getBuildings(building.owner)) {
                            if (vat.factoryTrait && vat.def?.cloning && vat.factoryTrait.status === FactoryStatus.Idle) {
                                vat.factoryTrait.produceGroundUnitAt(vat, item, world);
                            }
                        }
                    }
                }
                const player = world.getPlayer(building.owner);
                if (player) player.built++;
                item.creditsSpent = 0;
                item.progress = 0;
                queue.shift(item.rules, 1);
                if (queue.currentSize) queue.status = QueueStatus.Active;
            }
        }
    }

    produceGroundUnitAt(building: any, item: any, world: FactoryWorld): void {
        const unit = world.createUnitForPlayer(item.rules, building.owner);
        let rallyPoint = this.computeInternalRallyPoint(building, this.type, building.rallyTrait?.getRallyPoint?.(), world);
        if (this.type !== FactoryType.UnitType) {
            rallyPoint = building.rallyTrait?.findRallyPointforUnit?.(unit, rallyPoint, world, false, building.tile.z) ?? rallyPoint;
        }
        const exitCoords = this.computeExitCoords(building, this.type);
        const spawnTile = world.tiles.getByMapCoords(Math.floor(exitCoords.rx), Math.floor(exitCoords.ry));
        if (unit.isInfantry?.()) {
            const occupied = world.tileOccupation
                .getGroundObjectsOnTile(rallyPoint)
                .filter((obj: any) => obj.isInfantry?.() && obj.moveTrait?.moveState !== 1)
                .map((obj: any) => obj.position?.subCell);
            unit.subCell = [2, 4, 3].find((sc) => occupied.indexOf(sc) === -1) ?? 2;
        }
        unit.direction = 270;
        world.spawnObject(unit, spawnTile);
        world.startExitMove(unit, building, rallyPoint);
        this.status = FactoryStatus.Delivering;
        this.deliveringUnit = unit;
        this.exitRetryTicks = 90;
    }

    produceAircraftAt(building: any, item: any, world: FactoryWorld): boolean {
        const dockTrait = building.dockTrait;
        if (!dockTrait) return false;
        const dockNumber = dockTrait.getFirstAvailableDockNumber();
        if (dockNumber === undefined) return false;
        const unit = world.createUnitForPlayer(item.rules, building.owner);
        const tile = dockTrait.getDockTile(dockNumber);
        world.spawnObject(unit, tile);
        dockTrait.dockUnitAt(unit, dockNumber);
        if (unit.airportBoundTrait) unit.airportBoundTrait.preferredAirport = building;
        return true;
    }

    /** barracks: bottom-left of the footprint; war factory: mid-right */
    computeExitCoords(building: any, factoryType: FactoryType): { rx: number; ry: number } {
        if (factoryType === FactoryType.InfantryType) return this.computeBarracksDefaultExitCoords(building);
        if (factoryType === FactoryType.UnitType) return this.computeWarFactoryExitCoords(building);
        throw new Error('Unsupported factory type ' + factoryType);
    }

    computeInternalRallyPoint(building: any, factoryType: FactoryType, rallyPoint: any, world: FactoryWorld): any {
        let coords: { rx: number; ry: number };
        if (factoryType === FactoryType.InfantryType) coords = this.computeBarracksInternalRallyCoords(building);
        else if (factoryType === FactoryType.UnitType) coords = this.computeWarFactoryInternalRallyCoords(building);
        else throw new Error('Unsupported factory type ' + factoryType);
        return world.tiles.getByMapCoords(coords.rx, coords.ry) ?? this.findTileAdjacentToBuilding(building, world);
    }

    computeDefaultRallyPoint(building: any, factoryType: FactoryType, world: FactoryWorld): any {
        let coords: { rx: number; ry: number };
        if (factoryType === FactoryType.InfantryType) coords = this.computeBarracksInternalRallyCoords(building);
        else if (factoryType === FactoryType.UnitType) coords = this.computeWarFactoryDefaultRallyCoords(building);
        else throw new Error('Unsupported factory type ' + factoryType);
        return world.tiles.getByMapCoords(coords.rx, coords.ry) ?? this.findTileAdjacentToBuilding(building, world);
    }

    findTileAdjacentToBuilding(building: any, world: FactoryWorld): any {
        return new RadialTileFinder(
            world.tiles,
            world.mapBounds,
            building.tile,
            building.art.foundation,
            1,
            1,
            () => true,
        ).getNextTile();
    }

    computeBarracksDefaultExitCoords(building: any): { rx: number; ry: number } {
        const foundation = building.art.foundation;
        let x: number;
        let y: number;
        if (foundation.width <= 2 || foundation.height <= 2) {
            x = foundation.width - 1;
            y = foundation.height - 1;
        } else {
            x = 0;
            y = foundation.height - 1;
        }
        return { rx: building.tile.rx + x, ry: building.tile.ry + y };
    }

    computeBarracksInternalRallyCoords(building: any): { rx: number; ry: number } {
        const foundation = building.art.foundation;
        const { rx, ry } = this.computeBarracksDefaultExitCoords(building);
        if (foundation.width <= 2 || foundation.height <= 2) return { rx, ry: ry + 1 };
        return { rx, ry };
    }

    computeWarFactoryExitCoords(building: any): { rx: number; ry: number } {
        const foundation = building.art.foundation;
        return {
            rx: building.tile.rx + Math.floor(foundation.width / 2),
            ry: building.tile.ry + Math.floor(foundation.height / 2),
        };
    }

    computeWarFactoryInternalRallyCoords(building: any): { rx: number; ry: number } {
        const foundation = building.art.foundation;
        return {
            rx: building.tile.rx + foundation.width - 1,
            ry: building.tile.ry + Math.floor(foundation.height / 2),
        };
    }

    computeWarFactoryDefaultRallyCoords(building: any): { rx: number; ry: number } {
        const foundation = building.art.foundation;
        return {
            rx: building.tile.rx + foundation.width,
            ry: building.tile.ry + Math.floor(foundation.height / 2),
        };
    }
}
