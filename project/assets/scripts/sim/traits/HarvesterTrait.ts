/**
 * Port of redalert2/src/game/gameobject/trait/HarvesterTrait.ts.
 *
 * The trait is mostly a state machine *label*: the tasks do the work, but the
 * retry timers live here so a harvester whose ore field vanished does not spin
 * on A* every tick.
 *
 * `ore` / `gems` count *bails*, not credits. A bail is worth `TiberiumRules`
 * (25 for ore, 50 for gems in retail); the refinery converts on unload.
 */
import { Task } from '../Task';
import { TICKS_PER_SECOND } from '../Constants';

export enum HarvesterStatus {
    Idle = 0,
    LookingForOreSite = 1,
    MovingToOreSite = 2,
    Harvesting = 3,
    LookingForRefinery = 4,
    MovingToRefinery = 5,
    Docking = 6,
    PreparingToUnload = 7,
    Unloading = 8,
}

export class HarvesterTrait {
    storage: number;
    ore = 0;
    gems = 0;
    status: HarvesterStatus = HarvesterStatus.Idle;
    lastGatherExplicit = false;
    autoGatherOnNextIdle = false;
    ticksSinceLastRefineryCheck = 0;
    ticksSinceLastOreCheck = 0;
    lastOreSite: any = undefined;

    /** task factories are injected so this file does not import the task layer */
    makeGatherTask: ((world: any, target?: any, explicit?: boolean) => Task) | null = null;
    makeReturnTask: ((world: any, forceTarget?: any) => Task) | null = null;

    constructor(storage: number) {
        this.storage = storage;
    }

    /** NotifySpawn: a fresh harvester starts gathering on its own */
    onSpawn(unit: any, world: any): void {
        if (!this.makeGatherTask) return;
        world.afterTick?.(() => {
            unit.orders.addTask(this.makeGatherTask!(world));
        });
    }

    /**
     * NotifyTick — the three timers from the reference:
     *   LookingForRefinery: retry every 5 s, pause the timer while busy;
     *   LookingForOreSite:  retry every 20 s when idle;
     *   Idle on ore:        resume gathering without an order.
     */
    onTick(unit: any, world: any): void {
        if (this.status === HarvesterStatus.LookingForRefinery) {
            if (this.ticksSinceLastRefineryCheck++ > 5 * TICKS_PER_SECOND) {
                this.ticksSinceLastRefineryCheck = 0;
                if (unit.orders.hasTasks()) {
                    this.ticksSinceLastRefineryCheck = -25 * TICKS_PER_SECOND;
                } else if (this.hasRefinery(unit, world) || this.lastGatherExplicit) {
                    unit.orders.addTask(this.makeReturnTask!(world));
                } else {
                    this.status = HarvesterStatus.Idle;
                }
            }
        } else if (this.status === HarvesterStatus.LookingForOreSite) {
            if (this.ticksSinceLastOreCheck++ > 20 * TICKS_PER_SECOND) {
                this.ticksSinceLastOreCheck = 0;
                if (!unit.orders.hasTasks()) {
                    unit.orders.addTask(this.makeGatherTask!(world));
                }
            }
        } else if (
            this.status === HarvesterStatus.Idle &&
            this.autoGatherOnNextIdle &&
            unit.orders.isIdle() &&
            world.isOreTile?.(unit.tile)
        ) {
            this.autoGatherOnNextIdle = false;
            unit.orders.addTask(this.makeGatherTask!(world, unit.tile, true));
        }
    }

    /**
     * The reference reads `unit.owner.buildings`; here `owner` is a player id,
     * so the question goes to the world adapter (which owns the roster).
     */
    private hasRefinery(unit: any, world: any): boolean {
        if (world?.hasRefinery) return !!world.hasRefinery(unit);
        const buildings = unit.owner?.buildings;
        return Array.isArray(buildings) && buildings.some((building: any) => building.def?.dropoff);
    }

    isFull(): boolean {
        return this.ore + this.gems >= this.storage;
    }

    isEmpty(): boolean {
        return !this.ore && !this.gems;
    }

    getHash(): number {
        return 100 * this.ore + this.gems;
    }

    debugGetState() {
        return { ore: this.ore, gems: this.gems, status: this.status };
    }
}
