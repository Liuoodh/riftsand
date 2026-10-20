/**
 * Verbatim from redalert2/src/game/GameSpeed.ts.
 *
 * The simulation clock. `BASE_TICKS_PER_SECOND` is the *unit* of every duration
 * in rules.ini — a `Rate=` of 0.05 means "0.05 minutes at the base rate", not
 * "0.05 of whatever speed the player picked". Game speed scales the number of
 * ticks the host runs per real second, never the tick length itself, which is
 * why a replay recorded at speed 3 plays back identically at speed 6.
 *
 * `computeGameSpeed` returns the *multiplier* the loop uses:
 *
 *   speed 1 → 12 ticks/s  → ×0.8
 *   speed 6 → 60 ticks/s  → ×4.0
 *
 * Note the `else` branch: any speed other than 5 or 6 falls into
 * `60 / (6 - speed)`, so speed 1 gives 12 and speed 3 gives 20. Speeds 5 and 6
 * are special-cased only because `60/(6-5) = 60` and `60/(6-6)` would divide by
 * zero.
 */
export class GameSpeed {
    static BASE_TICKS_PER_SECOND = 15;

    static computeGameSpeed(speed: number): number {
        let ticksPerSecond: number;
        if (speed === 6) {
            ticksPerSecond = 60;
        } else if (speed === 5) {
            ticksPerSecond = 45;
        } else {
            ticksPerSecond = 60 / (6 - speed);
        }
        return ticksPerSecond / GameSpeed.BASE_TICKS_PER_SECOND;
    }
}
