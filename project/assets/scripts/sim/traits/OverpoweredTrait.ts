/**
 * Port of redalert2/src/game/gameobject/trait/OverpoweredTrait.ts.
 *
 * The "overcharge" mechanic on a base defence: two friendly power-consuming
 * units (in retail, Tesla troopers) target the structure and it flips to its
 * `secondaryWeapon` — the Tesla coil's boosted mode — for as long as they keep
 * holding the beam.
 *
 * The charge count is what matters, not who is shooting:
 *   - one charger is enough while the structure itself is powered;
 *   - two are needed when it is dark, because a brown-out has to be paid for.
 *
 * Every tick the charger set is pruned: a charger that died, started crashing,
 * changed hands or retargeted is dropped, and the weapon is swapped back. That
 * pruning is the whole safety story — there is no timer, so a stale entry would
 * leave the structure permanently overcharged.
 */
export interface OverpoweredWorld {
    /** `attackTrait.currentTarget?.obj` */
    currentTargetOf(charger: any): any;
    /** the task the structure is currently running, if any */
    getCurrentTask(obj: any): any;
    /** reference `AttackTask.setWeapon(weapon)` / `AttackTask.cancel()` */
    setTaskWeapon(task: any, weapon: any): void;
    cancelTask(task: any): void;
    /** `poweredTrait.isPoweredOn(true)` */
    isPoweredOn(obj: any): boolean;
}

export class OverpoweredTrait {
    private obj: any;
    private chargers = new Set<any>();

    constructor(obj: any) {
        this.obj = obj;
    }

    getChargerCount(): number {
        return this.chargers.size;
    }

    isOverpowered(world: OverpoweredWorld): boolean {
        let requiredChargers = 1;
        if (!world.isPoweredOn(this.obj)) {
            requiredChargers += 2;
        }
        return this.chargers.size >= requiredChargers;
    }

    hasChargersToPowerOn(): boolean {
        return this.chargers.size >= 2;
    }

    chargeFrom(charger: any, world: OverpoweredWorld): void {
        this.chargers.add(charger);
        this.swapAttackTaskWeapon(world);
    }

    /** NotifyTick.onTick */
    onTick(gameObject: any, world: OverpoweredWorld): void {
        if (this.chargers.size > 0) {
            let needsUpdate = false;
            this.chargers.forEach((charger) => {
                if (
                    charger.isDestroyed ||
                    charger.dead ||
                    charger.isCrashing ||
                    charger.owner !== gameObject.owner ||
                    world.currentTargetOf(charger) !== gameObject
                ) {
                    this.chargers.delete(charger);
                    needsUpdate = true;
                }
            });
            if (needsUpdate) {
                this.swapAttackTaskWeapon(world);
            }
        }
    }

    private swapAttackTaskWeapon(world: OverpoweredWorld): void {
        const currentTask = world.getCurrentTask(this.obj);
        if (currentTask && currentTask.isAttackTask) {
            const weapon = this.getWeapon(world);
            if (weapon) {
                world.setTaskWeapon(currentTask, weapon);
            } else {
                world.cancelTask(currentTask);
            }
        }
    }

    private getWeapon(world: OverpoweredWorld): any {
        return this.isOverpowered(world) ? this.obj?.secondaryWeapon : this.obj?.primaryWeapon;
    }

    dispose(): void {
        this.obj = undefined;
        this.chargers.clear();
    }
}
