/**
 * Port of redalert2/src/game/gameobject/trait/GunnerTrait.ts.
 *
 * The IFV's turret changes with its passenger: an engineer turns it into a
 * repair vehicle, a G.I. into a machine gun, a Tesla trooper into a tesla
 * cannon. The reference reads `turretIndexesByIfvMode` from the vehicle rules
 * and only re-selects when the *presence* of a gunner changes, not every tick.
 *
 * No unit in this roster has `Gunner=`, so the trait is ported and ready but
 * unwired; the UI-name helper is included because the sidebar uses it to label
 * the vehicle `{tip:machinegun} {name:ifv}`.
 */
export class GunnerTrait {
    private lastHadGunner = false;

    /** NotifyTick */
    onTick(unit: any): void {
        const transport = unit.transportTrait;
        if (!transport) return;
        const hasGunner = !!transport.units.length;
        if (hasGunner === this.lastHadGunner) return;
        this.lastHadGunner = hasGunner;
        const ifvMode = transport.units[0]?.rules?.ifvMode ?? 0;
        const turretIndexes: Map<number, number> | undefined = unit.rules?.turretIndexesByIfvMode;
        const turretIndex = turretIndexes?.get(ifvMode) ?? 0;
        if (turretIndex < (unit.rules?.turretCount ?? 1)) {
            unit.turretNo = turretIndex;
            unit.armedTrait?.selectSpecialWeapon?.(ifvMode, unit.level >= 2);
        }
    }

    /** sidebar label for the current passenger */
    getUiNameForIfvMode(mode: number, name?: string): string | undefined {
        switch (mode) {
            case 0:
                return 'tip:rocket';
            case 1:
                return 'tip:repair';
            case 2:
            case 4:
            case 5:
                return 'tip:machinegun';
            default:
                return name ? `name:${name.toLowerCase()}` : undefined;
        }
    }
}
