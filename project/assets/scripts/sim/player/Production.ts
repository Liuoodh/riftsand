/**
 * Player production.
 *
 * Port of redalert2/src/game/player/production/Production.ts.
 *
 * The object graph is the same: one Production per player, one ProductionQueue
 * per QueueType, a primary factory per FactoryType plus a factory count used by
 * the build-speed formula. Prerequisite names are looked up exactly like retail
 * (`POWER`, `FACTORY`, `BARRACKS`, `RADAR`, `TECH`, `PROC` are categories, any
 * other string is a building id).
 *
 * Adaptations:
 *   - `player.country` becomes `player.faction`;
 *   - the object rules are our `BuildingDef` / `UnitDef`, normalised with
 *     `owner` / `techLevel` / `prerequisite` by Game.economyInit();
 *   - stolen tech is not modelled (no spies yet), so `meetsStolenTech` is true.
 */
import { ProductionQueue, QueueStatus, QueueType } from './ProductionQueue';
import { PowerLevel } from './PowerTrait';

export enum FactoryType {
    BuildingType = 0,
    InfantryType = 1,
    UnitType = 2,
    AircraftType = 3,
    NavalUnitType = 4,
}

export enum BuildCat {
    Combat = 0,
    Resource = 1,
    Power = 2,
    Infantry = 3,
    Vehicle = 4,
    Aircraft = 5,
}

export enum PrereqCategory {
    Power = 'POWER',
    Factory = 'FACTORY',
    Barracks = 'BARRACKS',
    Radar = 'RADAR',
    Tech = 'TECH',
    Proc = 'PROC',
}

const PREREQ_MAP = new Map<string, PrereqCategory>([
    ['POWER', PrereqCategory.Power],
    ['FACTORY', PrereqCategory.Factory],
    ['BARRACKS', PrereqCategory.Barracks],
    ['RADAR', PrereqCategory.Radar],
    ['TECH', PrereqCategory.Tech],
    ['PROC', PrereqCategory.Proc],
]);

export interface ProductionRules {
    general: {
        maximumQueuedObjects: number;
        prereqCategories: Map<PrereqCategory, string[]>;
    };
    getSuperWeapon?(id: string): { disableableFromShell?: boolean } | undefined;
}

export class Production {
    private player: any;
    private maxTechLevel: number;
    private gameOpts: any;
    private rules: ProductionRules;
    private allAvailableObjects: any[];
    buildSpeedModifier: number;
    private queues = new Map<QueueType, ProductionQueue>();
    private primaryFactories = new Map<FactoryType, any>();
    private factoryCounts = new Map<FactoryType, number>();
    private veteranTypes = new Set<any>();
    private stolenTech = new Set<any>();
    private updateHandlers: Array<(player: any, queue: ProductionQueue) => void> = [];

    static factory(player: any, rules: ProductionRules, gameOpts: any, availableObjects: any[]): Production {
        const production = new Production(player, 10, gameOpts, rules, availableObjects);
        const maxQueueSize = rules.general.maximumQueuedObjects + 1;
        production.addQueue(QueueType.Structures, new ProductionQueue(QueueType.Structures, 1, 1));
        production.addQueue(QueueType.Armory, new ProductionQueue(QueueType.Armory, 1, 1));
        production.addQueue(QueueType.Infantry, new ProductionQueue(QueueType.Infantry, maxQueueSize, maxQueueSize));
        production.addQueue(QueueType.Vehicles, new ProductionQueue(QueueType.Vehicles, maxQueueSize, maxQueueSize));
        production.addQueue(QueueType.Ships, new ProductionQueue(QueueType.Ships, maxQueueSize, maxQueueSize));
        production.addQueue(QueueType.Aircrafts, new ProductionQueue(QueueType.Aircrafts, 0, maxQueueSize));
        return production;
    }

    constructor(player: any, techLevel: number, gameOpts: any, rules: ProductionRules, availableObjects: any[]) {
        this.player = player;
        this.maxTechLevel = techLevel;
        this.gameOpts = gameOpts;
        this.rules = rules;
        this.allAvailableObjects = availableObjects;
        this.buildSpeedModifier = 1;
    }

    onQueueUpdate(handler: (player: any, queue: ProductionQueue) => void): void {
        this.updateHandlers.push(handler);
    }

    addQueue(type: QueueType, queue: ProductionQueue): void {
        this.queues.set(type, queue);
        queue.onUpdate(() => {
            for (const handler of this.updateHandlers) handler(this.player, queue);
        });
    }

    getQueue(type: QueueType): ProductionQueue {
        const queue = this.queues.get(type);
        if (!queue) throw new Error('No queue found with type ' + QueueType[type]);
        return queue;
    }

    getAllQueues(): ProductionQueue[] {
        return Array.from(this.queues.values());
    }

    getQueueTypeForObject(object: any): QueueType {
        if (object.isBuilding) {
            return object.buildCat === BuildCat.Combat ? QueueType.Armory : QueueType.Structures;
        }
        if (object.kind === 'infantry') return QueueType.Infantry;
        if (object.kind === 'air') return QueueType.Aircrafts;
        if (object.kind) return object.naval ? QueueType.Ships : QueueType.Vehicles;
        throw new Error('Unsupported object type for queue');
    }

    getQueueForObject(object: any): ProductionQueue {
        return this.getQueue(this.getQueueTypeForObject(object));
    }

    getQueueTypeForFactory(type: FactoryType): QueueType {
        if (type === FactoryType.InfantryType) return QueueType.Infantry;
        if (type === FactoryType.UnitType) return QueueType.Vehicles;
        if (type === FactoryType.AircraftType) return QueueType.Aircrafts;
        if (type === FactoryType.NavalUnitType) return QueueType.Ships;
        throw new Error('Unsupported factory type ' + FactoryType[type]);
    }

    getFactoryTypeForQueueType(type: QueueType): FactoryType {
        if (type === QueueType.Structures || type === QueueType.Armory) return FactoryType.BuildingType;
        if (type === QueueType.Infantry) return FactoryType.InfantryType;
        if (type === QueueType.Vehicles) return FactoryType.UnitType;
        if (type === QueueType.Aircrafts) return FactoryType.AircraftType;
        if (type === QueueType.Ships) return FactoryType.NavalUnitType;
        throw new Error('Unsupported queue type ' + QueueType[type]);
    }

    getQueueForFactory(type: FactoryType): ProductionQueue {
        return this.getQueue(this.getQueueTypeForFactory(type));
    }

    isAvailableForProduction(object: any): boolean {
        return (
            this.isAvailableTo(object, this.player.faction) &&
            object.techLevel !== -1 &&
            object.techLevel <= this.maxTechLevel &&
            !(object.buildLimit === 0 && !this.player.isAi) &&
            !(object.superWeapon && !this.gameOpts?.superWeapons) &&
            this.hasFactoryFor(object) &&
            this.meetsPrerequisites(object)
        );
    }

    private isAvailableTo(object: any, faction: string): boolean {
        if (typeof object.isAvailableTo === 'function') return object.isAvailableTo(faction);
        const owner = object.owner;
        if (!owner || !owner.length) return true;
        return owner === faction || (Array.isArray(owner) && owner.indexOf(faction) !== -1);
    }

    getAvailableObjects(): any[] {
        return this.allAvailableObjects.filter((obj) => this.isAvailableForProduction(obj));
    }

    /**
     * Retail asks "does a factory of the right type owned by a house allowed to
     * build this object exist". Our defs have a single faction, so the owner
     * clause collapses to "same faction".
     */
    hasFactoryFor(object: any): boolean {
        if (!object.owner || !object.owner.length) return true;
        const factoryType = this.getFactoryTypeFor(object);
        return !!this.player.buildings.find(
            (building: any) =>
                building.factoryTrait?.type === factoryType &&
                (factoryType !== FactoryType.UnitType || !!building.rules?.naval === !!object.naval) &&
                this.isAvailableTo(object, this.player.faction),
        );
    }

    meetsStolenTech(_object: any): boolean {
        return true;
    }

    getFactoryTypeFor(object: any): FactoryType {
        if (object.isBuilding || object.size !== undefined) return FactoryType.BuildingType;
        if (object.kind === 'infantry') return FactoryType.InfantryType;
        if (object.kind === 'air') return FactoryType.AircraftType;
        return object.naval ? FactoryType.NavalUnitType : FactoryType.UnitType;
    }

    meetsPrerequisites(object: any): boolean {
        const buildingNames = this.player.buildings.map((b: any) => b.def.id);
        for (const prereq of object.prerequisite ?? []) {
            const upperPrereq = String(prereq).toUpperCase();
            const category = PREREQ_MAP.get(upperPrereq);
            if (category) {
                const prereqBuildings = this.rules.general.prereqCategories.get(category);
                if (prereqBuildings === undefined) throw new Error(`Missing prerequisite category ${category}`);
                if (!prereqBuildings.some((name) => buildingNames.indexOf(name) !== -1)) return false;
            } else if (buildingNames.indexOf(upperPrereq) === -1 && buildingNames.indexOf(String(prereq)) === -1) {
                return false;
            }
        }
        return true;
    }

    getPrimaryFactory(type: FactoryType): any {
        return this.primaryFactories.get(type);
    }

    setPrimaryFactory(building: any): void {
        if (building.rules?.factory !== undefined && building.rules?.factoryType !== undefined) {
            this.primaryFactories.set(building.rules.factoryType, building);
        } else if (building.factoryTrait) {
            this.primaryFactories.set(building.factoryTrait.type, building);
        }
    }

    isPrimaryFactory(building: any): boolean {
        const type = building.factoryTrait?.type;
        return type !== undefined && this.getPrimaryFactory(type) === building;
    }

    incrementFactoryCount(type: FactoryType): void {
        this.factoryCounts.set(type, (this.factoryCounts.get(type) ?? 0) + 1);
    }

    decrementFactoryCount(type: FactoryType): void {
        const current = this.factoryCounts.get(type);
        if (!current) return;
        this.factoryCounts.set(type, current - 1);
    }

    getFactoryCount(type: FactoryType): number {
        return this.factoryCounts.get(type) ?? 0;
    }

    crownPrimaryFactoryHeir(type: FactoryType): void {
        const heir = this.player.buildings.find((building: any) => building.factoryTrait?.type === type);
        if (heir) this.primaryFactories.set(type, heir);
        else this.primaryFactories.delete(type);
    }

    hasAnyFactory(): boolean {
        return this.primaryFactories.size > 0;
    }

    addVeteranType(type: any): void {
        this.veteranTypes.add(type);
    }

    hasVeteranType(type: any): boolean {
        return this.veteranTypes.has(type);
    }

    addStolenTech(type: any): void {
        this.stolenTech.add(type);
    }

    /** the reference's low-power hook on ProductionTrait */
    applyPowerLevel(level: PowerLevel, power: number, drain: number, general: any): void {
        if (level === PowerLevel.Low) {
            this.buildSpeedModifier = this.computeLowPowerBuildSpeedModifier(power, drain, general);
        } else {
            this.buildSpeedModifier = 1;
        }
    }

    /**
     * Verbatim from ProductionTrait.computeLowPowerBuildSpeedModifier.
     * 30% penalty at a 15% deficit, clamped by the two rules values.
     */
    private computeLowPowerBuildSpeedModifier(power: number, drain: number, general: any): number {
        const powerRatio = 1 - Math.min(1, power / Math.max(1, drain));
        const penaltyModifier = (0.3 * general.lowPowerPenaltyModifier * powerRatio) / 0.15;
        const min = general.minLowPowerProductionSpeed;
        const max = general.maxLowPowerProductionSpeed;
        return Math.max(min, Math.min(max, 1 - penaltyModifier));
    }

    dispose(): void {
        this.queues.clear();
        this.player = undefined;
    }
}
