/**
 * Port of redalert2/src/game/gameobject/trait/AirportBoundTrait.ts.
 *
 * An airport-bound aircraft (`AirportBound=yes` + a `Dock=` list) can only be
 * supported by a building named in that list. When it runs out of ammo the
 * WingedLocomotor sends it to `preferredAirport`; if no pad is free anywhere it
 * crashes.
 *
 * The reference reads `unit.owner.buildings`; here `owner` is a numeric id, so
 * the roster comes from the world adapter.
 */
export interface AirportWorld {
    /** every building the player owns (alive or not — the caller filters) */
    buildingsOf(owner: any): any[];
    /** reference `building.name`; ours is `def.id` */
    nameOf(building: any): string;
    /** the world runs the actual flight; the trait only picks the destination */
    sendToAirport(unit: any, airport: any): void;
    crashAircraft(unit: any): void;
}

export class AirportBoundTrait {
    airportNames: string[];
    preferredAirport?: any;

    constructor(airportNames: string[]) {
        this.airportNames = airportNames;
    }

    /** first pad with a free slot among the named airport types */
    findAvailableAirport(unit: any, world: AirportWorld): any | undefined {
        return world
            .buildingsOf(unit.owner)
            .find(
                (building) =>
                    !building.dead &&
                    !!building.dockTrait &&
                    this.airportNames.includes(world.nameOf(building)) &&
                    building.dockTrait.getAvailableDockCount() > 0,
            );
    }

    /**
     * Reference WingedLocomotor.tickStationary: park on the preferred pad, or
     * find one, or fall out of the sky.
     */
    ensureAirport(unit: any, world: AirportWorld): any | undefined {
        let airport = this.preferredAirport;
        const pad = airport?.dockTrait;
        if (pad && (pad.isDocked(unit) || pad.hasReservedDockForUnit(unit))) {
            // already committed to this pad — keep flying to it
            world.sendToAirport(unit, airport);
            return airport;
        }
        if (pad && pad.getAvailableDockCount() > 0) {
            const dockNumber = pad.getFirstAvailableDockNumber();
            if (dockNumber !== undefined) pad.reserveDockAt(unit, dockNumber);
            world.sendToAirport(unit, airport);
            return airport;
        }
        airport = this.findAvailableAirport(unit, world);
        this.preferredAirport = airport;
        if (!airport) {
            world.crashAircraft(unit);
            return undefined;
        }
        const dockNumber = airport.dockTrait.getFirstAvailableDockNumber();
        if (dockNumber !== undefined) airport.dockTrait.reserveDockAt(unit, dockNumber);
        world.sendToAirport(unit, airport);
        return airport;
    }

    /** reference HelipadTrait.onChange / onUnspawn */
    clearPreferredAirport(): void {
        this.preferredAirport = undefined;
    }
}
