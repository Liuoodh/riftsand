/**
 * Port of redalert2/src/game/gameobject/trait/SpawnLinkTrait.ts.
 *
 * The child half of a carrier: a `spawner` weapon (an aircraft carrier, a
 * destroyer's Ospreys, a Boomer's missiles) launches a separate object that
 * then has to behave on its own. This trait is the leash.
 *
 * Every tick the child asks one question — "should I attack?" — and the answer
 * is a three-way conjunction copied straight from the reference:
 *
 *   1. I still have ammunition;
 *   2. I am not already doing exactly what my parent is doing (same target, or
 *      no target at all while a *unit* parent is moving/attacking — that is the
 *      "recall the wing while the carrier repositions" case);
 *   3. if there is a parent target, it is inside the spawner weapon's range.
 *
 * When the answer is yes the child attacks the parent's target; when it is no
 * it flies back to the parent's tile with `closeEnough = 0, strict` so it ends
 * up exactly underneath — that strictness is what lets the launcher re-dock it
 * instead of chasing a child parked one cell away forever.
 */
export interface SpawnLinkWorld {
    currentTick: number;
    currentTargetOf(obj: any): any;
    /** reference `new RangeHelper(tileOccupation).isInWeaponRange(...)` */
    isInWeaponRange(source: any, target: any, weapon: any): boolean;
    hasAmmo(obj: any): boolean;
    canTarget(weapon: any, target: any): boolean;
    /** `unitOrderTrait.addTask(attackTrait.createAttackTask(...))` */
    attackTask(child: any, target: any, weapon: any): any;
    cancelAllTasks(child: any): void;
    addTask(child: any, task: any): void;
    getCurrentTask(obj: any): any;
    /** `currentTask.requestTargetUpdate(target)` */
    requestTargetUpdate(task: any, target: any): void;
    cancelTask(task: any): void;
    /** `attackTrait.attackState === AttackState.Idle`, mapped onto the task */
    attackStateIdle(task: any): boolean;
    isAttackTask(task: any): boolean;
    /** `new MoveTask(world, tile, onBridge, { closeEnoughTiles: 0, strictCloseEnough: true })` */
    moveTask(child: any, tile: any, onBridge: boolean): any;
    /** `currentTask.updateTarget(tile, onBridge)` */
    updateMoveTarget(task: any, tile: any, onBridge: boolean): void;
    isMoveTask(task: any): boolean;
}

export class SpawnLinkTrait {
    private parent?: any;

    setParent(parent: any): void {
        this.parent = parent;
    }

    getParent(): any | undefined {
        return this.parent;
    }

    /** NotifyTick.onTick */
    onTick(gameObject: any, world: SpawnLinkWorld): void {
        if (!this.parent) return;
        const parentTarget = world.currentTargetOf(this.parent);
        const childTarget = world.currentTargetOf(gameObject);
        const currentTask = world.getCurrentTask(gameObject);
        const spawnerWeapon =
            this.parent.armedTrait?.getWeapons?.().find((w: any) => w.rules?.spawner) ?? this.parent.spawnerWeapon;
        const parentTask = world.getCurrentTask(this.parent);

        const alreadyMirroring = parentTarget && childTarget
            ? parentTarget === childTarget
            : parentTarget === childTarget ||
              (!parentTarget &&
                  (this.parent.isUnit?.() ?? false) &&
                  (world.isMoveTask(parentTask) || world.isAttackTask(parentTask)));

        const shouldAttack =
            world.hasAmmo(gameObject) &&
            !alreadyMirroring &&
            (!parentTarget || (!!spawnerWeapon && world.isInWeaponRange(this.parent, parentTarget, spawnerWeapon)));

        if (shouldAttack) {
            if (parentTarget && world.canTarget(gameObject.primaryWeapon, parentTarget)) {
                if (!currentTask || world.isMoveTask(currentTask)) {
                    world.cancelAllTasks(gameObject);
                    world.addTask(gameObject, world.attackTask(gameObject, parentTarget, gameObject.primaryWeapon));
                } else if (!world.attackStateIdle(currentTask)) {
                    world.requestTargetUpdate(currentTask, parentTarget);
                }
            } else {
                if (currentTask) {
                    if (world.isMoveTask(currentTask)) {
                        this.tryMoveToParent(gameObject, this.parent, world);
                    } else {
                        world.cancelTask(currentTask);
                    }
                } else {
                    this.tryMoveToParent(gameObject, this.parent, world);
                }
            }
        } else {
            this.tryMoveToParent(gameObject, this.parent, world);
        }
    }

    private tryMoveToParent(gameObject: any, parent: any, world: SpawnLinkWorld): void {
        if (gameObject.tile !== parent.tile) {
            const currentTask = world.getCurrentTask(gameObject);
            const onBridge = (parent.isUnit?.() ?? false) && !!parent.onBridge;
            if (world.isMoveTask(currentTask)) {
                world.updateMoveTarget(currentTask, parent.tile, onBridge);
            } else {
                world.addTask(gameObject, world.moveTask(gameObject, parent.tile, onBridge));
            }
        }
    }
}
