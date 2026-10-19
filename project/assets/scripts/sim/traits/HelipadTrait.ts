/**
 * Port of redalert2/src/game/gameobject/trait/HelipadTrait.ts.
 *
 * A helipad is a dock like any other, but it has one extra duty: when the pad
 * changes hands or is sold, every airport-bound aircraft that had picked it as
 * its home must forget it, so the next landing pass re-scans for a live pad.
 *
 * Without this an aircraft keeps flying to a destroyed pad and, because the
 * reference falls back to `crash()` when no pad is available, hangs in the air
 * forever instead of re-homing.
 */
export interface HelipadWorld {
    /** every airport-bound aircraft owned by this player */
    airportBoundAircraft(owner: any): any[];
}

export class HelipadTrait {
    /** NotifyOwnerChange.onChange */
    onOwnerChange(unit: any, oldOwner: any, world: HelipadWorld): void {
        this.checkAircraftsForPlayer(oldOwner, world);
    }

    /** NotifyUnspawn.onUnspawn */
    onUnspawn(unit: any, world: HelipadWorld): void {
        this.checkAircraftsForPlayer(unit.owner, world);
    }

    private checkAircraftsForPlayer(player: any, world: HelipadWorld): void {
        for (const aircraft of world.airportBoundAircraft(player)) {
            aircraft.airportBoundTrait?.clearPreferredAirport?.();
        }
    }
}
