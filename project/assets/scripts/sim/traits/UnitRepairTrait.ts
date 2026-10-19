/**
 * Port of redalert2/src/game/gameobject/trait/UnitRepairTrait.ts.
 *
 * The service depot. Any friendly unit parked in the dock ring is healed
 * `RepairStep` hit points per repair tick; a unit that is already full, or that
 * belongs to somebody else, gets undocked and sent to the rally point instead.
 * That second branch is what makes a depot a *turnstile* rather than a parking
 * lot — vehicles drive in, get patched, drive out.
 *
 * `RepairPercent` (retail 0.2) switches the mode from "free fixed step" to
 * "paid percentage": each tick costs `costPerHP * repairStep` credits, and a
 * player who cannot pay simply is not repaired. This is the branch that makes
 * repairing a Battle Fortress genuinely expensive.
 *
 * The cooldown is `BASE_TICKS_PER_SECOND * rate * 60` ticks — the rate is in
 * *minutes* per repair, exactly as in rules.ini.
 */
export interface RepairWorld {
    currentTick: number;
    /** `[General] Repair` block */
    repairRules: {
        reloadRate: number;
        repairPercent: number;
        repairRate: number;
        repairStep: number;
        uRepairRate: number;
        iRepairRate: number;
        iRepairStep: number;
    };
    baseTicksPerSecond: number;
    /** units currently sitting in this building's dock */
    dockedUnits(building: any): any[];
    hasDockedUnits(building: any): boolean;
    undockUnit(building: any, unit: any): void;
    isAirUnit(unit: any): boolean;
    areFriendly(a: any, b: any): boolean;
    isPoweredOn(building: any): boolean;
    /** heal by N hit points, clamped to the maximum */
    healBy(unit: any, amount: number, source: any): void;
    /** `unit.owner.credits` read/write */
    getCredits(player: any): number;
    spendCredits(player: any, amount: number): void;
    purchaseValue(unit: any): number;
    /** reference `rallyTrait.findRallyNodeForUnit(unit, map)` */
    findRallyNode(building: any, unit: any): any;
    /**
     * The `MoveTask` the reference queues after `undockUnit`.
     *
     * Kept as a separate hook because the dock and the rally point live in
     * different layers here: the trait decides *that* the unit leaves, the world
     * decides *where to*.
     */
    sendToRallyPoint?(unit: any, rallyNode: any): void;
    /** reference `rallyTrait.changeRallyPoint(...)` on spawn */
    resetRallyPoint(building: any): void;
    hasFactory(building: any): boolean;
    onRepairStart(unit: any): void;
    onRepairFinish(unit: any, building: any): void;
    /** `gameObject.rules.unitReload` — a pad heals on the reload clock instead */
    usesReloadRate(building: any): boolean;
    isNeutral(player: any): boolean;
    needsEngineer(building: any): boolean;
    hasHelipad(building: any): boolean;
}

export enum RepairStatus {
    Idle = 0,
    Repairing = 1,
}

export class UnitRepairTrait {
    private status: RepairStatus = RepairStatus.Idle;
    private cooldownTicks = 0;
    private lastRepairTickSuccessful = false;

    getStatus(): RepairStatus {
        return this.status;
    }

    /** NotifySpawn.onSpawn */
    onSpawn(gameObject: any, world: RepairWorld): void {
        this.resetRallyPoint(gameObject, world);
    }

    private resetRallyPoint(gameObject: any, world: RepairWorld): void {
        if (!world.hasFactory(gameObject)) {
            world.resetRallyPoint(gameObject);
        }
    }

    /** NotifyTick.onTick */
    onTick(gameObject: any, world: RepairWorld): void {
        if (!gameObject.dockTrait || (world.needsEngineer(gameObject) && world.isNeutral(gameObject.player ?? gameObject.owner))) {
            return;
        }
        if (
            !world.hasDockedUnits(gameObject) ||
            world.dockedUnits(gameObject).some((unit) => world.isAirUnit(unit)) ||
            (gameObject.poweredTrait && !world.isPoweredOn(gameObject))
        ) {
            this.status = RepairStatus.Idle;
            return;
        }
        if (this.cooldownTicks <= 0) {
            const repairRules = world.repairRules;
            const repairRate = world.usesReloadRate(gameObject) ? repairRules.reloadRate : repairRules.uRepairRate;
            this.cooldownTicks += world.baseTicksPerSecond * repairRate * 60;
            let repairSuccessful = false;
            for (const unit of world.dockedUnits(gameObject)) {
                if (world.isAirUnit(unit)) continue;
                if (unit.healthTrait.health < 100 && world.areFriendly(unit, gameObject)) {
                    if (this.tickRepair(unit, world, gameObject)) {
                        repairSuccessful = true;
                    }
                    if (repairSuccessful && this.status === RepairStatus.Idle && !this.lastRepairTickSuccessful && !world.hasHelipad(gameObject)) {
                        world.onRepairStart(unit);
                    }
                } else {
                    const rallyNode = world.findRallyNode(gameObject, unit);
                    if (rallyNode) {
                        world.undockUnit(gameObject, unit);
                        world.sendToRallyPoint?.(unit, rallyNode);
                    }
                    if (!world.hasHelipad(gameObject)) {
                        world.onRepairFinish(unit, gameObject);
                    }
                }
            }
            this.lastRepairTickSuccessful = repairSuccessful;
            this.status = repairSuccessful ? RepairStatus.Repairing : RepairStatus.Idle;
        } else {
            this.cooldownTicks--;
        }
    }

    private tickRepair(unit: any, world: RepairWorld, repairBuilding: any): boolean {
        const repairRules = world.repairRules;
        const repairStep = Math.floor(repairRules.repairStep);
        const repairPercent = repairRules.repairPercent;
        let repairAmount: number;
        if (repairPercent) {
            const costPerHP = (repairPercent * world.purchaseValue(unit)) / unit.healthTrait.getMaxHitPoints();
            const maxCost = Math.min(world.getCredits(unit.player ?? unit.owner), Math.max(1, Math.floor(costPerHP * repairStep)));
            repairAmount = costPerHP && maxCost ? Math.floor(maxCost / costPerHP) : repairStep;
            if (!maxCost) return false;
            world.spendCredits(unit.player ?? unit.owner, maxCost);
        } else {
            repairAmount = repairStep;
        }
        repairAmount = Math.min(repairAmount, unit.healthTrait.getMaxHitPoints() - unit.healthTrait.getHitPoints());
        if (!repairAmount) return false;
        world.healBy(unit, repairAmount, repairBuilding);
        return true;
    }
}
