/**
 * Port of redalert2/src/game/gameobject/trait/TransportTrait.ts.
 *
 * Passenger bookkeeping only — the reference keeps the load/unload *tasks* in
 * `EnterTransportTask` / `LeaveTransportTask`, which are not ported because no
 * unit in this roster has `Passengers=`.
 *
 * The two rules that matter and are easy to get wrong:
 *   - capacity is measured in `Size`, not in unit count, so one 6-slot APC takes
 *     three size-2 G.I.s or one size-6 Tesla trooper;
 *   - a destroy with passengers aboard spawns survivors on the transport's own
 *     cell only if they can stand there, otherwise they die with it.
 */
export interface TransportWorld {
    /** can this passenger stand on that tile? */
    canSurviveOn(unit: any, tile: any): boolean;
    /** put the survivor back on the map and make it scatter */
    unloadSurvivor(unit: any, tile: any): void;
    /** the survivor has nowhere to go — kill it with the wreck */
    destroyPassenger(unit: any): void;
}

export class TransportTrait {
    units: any[] = [];
    private loadQueue: any[] = [];
    private obj: any;

    constructor(obj: any) {
        this.obj = obj;
    }

    unitFitsInside(unit: any): boolean {
        return unit.rules.size <= this.obj.rules.sizeLimit && unit.rules.size <= this.getAvailableCapacity();
    }

    getOccupiedCapacity(): number {
        return this.units.reduce((sum, unit) => sum + unit.rules.size, 0);
    }

    getMaxCapacity(): number {
        return this.obj.rules.passengers;
    }

    getAvailableCapacity(): number {
        return this.getMaxCapacity() - this.getOccupiedCapacity();
    }

    addToLoadQueue(unit: any): number {
        this.loadQueue.push(unit);
        return this.loadQueue.length - 1;
    }

    unitIsFirstInLoadQueue(unit: any): boolean {
        return this.loadQueue[0] === unit;
    }

    removeFromLoadQueue(unit: any): void {
        const index = this.loadQueue.indexOf(unit);
        if (index !== -1) this.loadQueue.splice(index, 1);
    }

    /** NotifyTick: drop dead/destroyed passengers from the boarding queue */
    onTick(): void {
        this.loadQueue = this.loadQueue.filter((unit) => !unit.dead && !unit.isCrashing);
    }

    /**
     * NotifyDestroy. `forceDestroy` (a scripted kill) and airborne transports
     * take their passengers down with them; a normal ground kill spills them out.
     */
    onDestroy(forceDestroy: boolean, world: TransportWorld): void {
        if (forceDestroy) {
            for (const unit of this.units) world.destroyPassenger(unit);
        } else {
            this.spawnSurvivors(world);
        }
        this.units = [];
    }

    private spawnSurvivors(world: TransportWorld): void {
        const transport = this.obj;
        for (const unit of this.units) {
            if (!transport) {
                world.destroyPassenger(unit);
                continue;
            }
            if (world.canSurviveOn(unit, transport.tile)) {
                world.unloadSurvivor(unit, transport.tile);
            } else {
                world.destroyPassenger(unit);
            }
        }
    }

    getHash(): number {
        let hash = 2166136261;
        for (const unit of this.units) {
            hash = (hash ^ ((unit.id ?? 0) & 0xff)) >>> 0;
            hash = Math.imul(hash, 16777619) >>> 0;
        }
        return hash >>> 0;
    }

    dispose(): void {
        this.obj = undefined;
    }
}
