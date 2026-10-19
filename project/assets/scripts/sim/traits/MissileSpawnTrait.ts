/**
 * Port of redalert2/src/game/gameobject/trait/MissileSpawnTrait.ts.
 *
 * A spawned missile that damages only on impact. The launcher hands over a
 * warhead, a damage figure and itself; when the missile is destroyed — by
 * running out of range, by hitting the ground, by being shot — the warhead
 * detonates at the missile's *current* tile with `CollisionType.None`, meaning
 * no further collision pass (the missile is already the collision).
 *
 * Without this a V3 rocket that gets intercepted simply disappears. The whole
 * point of the trait is that shooting one down near your own base hurts.
 */
export interface MissileSpawnWorld {
    /** `warhead.detonate(world, damage, tile, elevation, worldPos, zone, collisionType, target, attackerInfo, ...)` */
    detonate(
        world: any,
        damage: number,
        tile: any,
        elevation: number,
        worldPosition: any,
        zone: any,
        collisionType: number,
        target: any,
        attackerInfo: any,
        isCrash: boolean,
    ): void;
    createTarget(obj: any, tile: any): any;
    /** `CollisionType.None` */
    collisionNone: number;
}

export class MissileSpawnTrait {
    private warhead?: any;
    private damage?: number;
    private launcher?: any;

    setWarhead(warhead: any): this {
        this.warhead = warhead;
        return this;
    }

    setDamage(damage: number): this {
        this.damage = damage;
        return this;
    }

    setLauncher(launcher: any): this {
        this.launcher = launcher;
        return this;
    }

    hasPayload(): boolean {
        return !!(this.warhead && this.damage && this.launcher);
    }

    /** NotifyDestroy.onDestroy */
    onDestroy(gameObject: any, world: any, w: MissileSpawnWorld): void {
        if (this.warhead && this.damage && this.launcher) {
            w.detonate(
                world,
                this.damage,
                gameObject.tile,
                gameObject.tileElevation ?? 0,
                gameObject.position?.worldPosition,
                gameObject.zone,
                w.collisionNone,
                w.createTarget(undefined, gameObject.tile),
                { player: gameObject.player ?? gameObject.owner, obj: this.launcher, weapon: undefined },
                false,
            );
        }
    }

    dispose(): void {
        this.launcher = undefined;
    }
}
