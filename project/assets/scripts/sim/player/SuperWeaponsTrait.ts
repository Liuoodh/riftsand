/**
 * Port of redalert2/src/game/player/trait/SuperWeaponsTrait.ts.
 *
 * A name-keyed bag of the super weapons a player currently owns. The bag is the
 * authority: `SuperWeaponTrait` (on the building) inserts and removes entries,
 * and the HUD reads `getAll()`. Nothing scans the building list at draw time, so
 * a captured or sold provider is reflected immediately.
 */
export class SuperWeaponsTrait {
    private superWeapons = new Map<string, any>();

    /**
     * Optional flat mirror (this project's `PlayerState.sw`).
     *
     * The HUD walks an array of weapon states every frame; keeping a mirror
     * here means `add` / `remove` update both views in one place, so nothing can
     * end up owned by the trait but invisible to the UI (or the reverse).
     */
    constructor(private mirror?: any[]) {}

    getAll(): any[] {
        return Array.from(this.superWeapons.values());
    }

    add(superWeapon: any): void {
        this.superWeapons.set(superWeapon.name, superWeapon);
        if (this.mirror && !this.mirror.includes(superWeapon)) this.mirror.push(superWeapon);
    }

    has(name: string): boolean {
        return this.superWeapons.has(name);
    }

    get(name: string): any | undefined {
        return this.superWeapons.get(name);
    }

    remove(name: string): void {
        const sw = this.superWeapons.get(name);
        this.superWeapons.delete(name);
        if (this.mirror) {
            const i = sw ? this.mirror.indexOf(sw) : -1;
            if (i >= 0) this.mirror.splice(i, 1);
        }
    }

    clear(): void {
        this.superWeapons.clear();
        if (this.mirror) this.mirror.length = 0;
    }
}
