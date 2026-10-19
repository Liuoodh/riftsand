/**
 * Port of redalert2/src/game/gameobject/trait/SuperWeaponTrait.ts.
 *
 * The building half of a super weapon. Spawning the provider adds the weapon to
 * the owner's `SuperWeaponsTrait`; unspawning it removes the entry again — but
 * only after checking that *no other* owned building provides the same weapon,
 * which is what lets you keep a charged Iron Curtain after selling one of two
 * aegis anchors.
 *
 * A `gift` super weapon (handed out by a script) is never removed by this path.
 */
export interface SuperWeaponWorld {
    /** reference `world.createSuperWeapon(name, player)` */
    createSuperWeapon(name: string, player: any): any;
    /** every building the player owns (for the "another provider still stands" test) */
    getOwnedBuildings(player: any): any[];
    /** pause a freshly added weapon when the grid is already brown */
    pauseIfLowPower(player: any, superWeapon: any): void;
}

export class SuperWeaponTrait {
    private name: string;

    constructor(name: string) {
        this.name = name;
    }

    getName(): string {
        return this.name;
    }

    getSuperWeapon(gameObject: any) {
        return (gameObject.player ?? gameObject.owner)?.superWeaponsTrait?.get(this.name);
    }

    /** NotifySpawn.onSpawn */
    onSpawn(gameObject: any, world: SuperWeaponWorld): void {
        this.addSuperWeaponToPlayerIfNeeded(gameObject.player ?? gameObject.owner, world);
    }

    /** NotifyUnspawn.onUnspawn */
    onUnspawn(gameObject: any, world: SuperWeaponWorld): void {
        this.removeSuperWeaponFromPlayerIfNeeded(gameObject.player ?? gameObject.owner, world, gameObject);
    }

    /** NotifyOwnerChange.onChange */
    onChange(gameObject: any, oldOwner: any, _newOwner: any, world: SuperWeaponWorld): void {
        this.removeSuperWeaponFromPlayerIfNeeded(oldOwner, world, gameObject);
        this.addSuperWeaponToPlayerIfNeeded(gameObject.player ?? gameObject.owner, world);
    }

    private addSuperWeaponToPlayerIfNeeded(player: any, world: SuperWeaponWorld): void {
        if (player?.superWeaponsTrait && !player.superWeaponsTrait.has(this.name)) {
            const superWeapon = world.createSuperWeapon(this.name, player);
            if (!superWeapon) return;
            player.superWeaponsTrait.add(superWeapon);
            world.pauseIfLowPower(player, superWeapon);
        }
    }

    private removeSuperWeaponFromPlayerIfNeeded(player: any, world: SuperWeaponWorld, self?: any): void {
        const superWeaponsTrait = player?.superWeaponsTrait;
        if (!superWeaponsTrait) return;
        const hasBuildingWithSuperWeapon = world
            .getOwnedBuildings(player)
            .some((building) => building !== self && building.superWeaponTrait?.getName() === this.name);
        if (!hasBuildingWithSuperWeapon) {
            const superWeapon = superWeaponsTrait.get(this.name);
            if (superWeapon && !superWeapon.isGift) {
                superWeaponsTrait.remove(this.name);
            }
        }
    }
}
