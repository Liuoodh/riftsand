/**
 * Port of redalert2/src/game/gameobject/unit/CrateBonuses.ts (10 lines).
 *
 * Three multiplicative bonuses from picked-up crates, all starting at 1 — i.e.
 * the *identities*. Using 0 as the default (the obvious-looking choice for a
 * fresh object) would make every unit that never touched a crate fire blanks.
 */
export class CrateBonuses {
    firepower: number;
    armor: number;
    speed: number;

    constructor() {
        this.firepower = 1;
        this.armor = 1;
        this.speed = 1;
    }
}
