/**
 * Port of redalert2/src/game/gameobject/trait/CrewedTrait.ts.
 *
 * When a crewed structure dies — or is sold — a few riflemen run out of the
 * rubble. The count is `refundValue / SurvivorDivisor`, so an expensive
 * building coughs up more men than a cheap one, and the *last* one out of a
 * construction yard is always an engineer (that is the reference's "you can
 * rebuild from a sold MCV" affordance).
 *
 * Two guards matter and both are copied verbatim:
 *   - nothing spawns when the killer was the building itself (a suicide weapon)
 *     or when the structure is still `crashing`;
 *   - a moving vehicle spawns at most one survivor, a building at most five.
 *
 * The reference reads `owner.country.side`; this project stores the same fact
 * as `owner.faction` ('BU' | 'DS'), so the side lookup goes through the world.
 */
export interface CrewWorld {
    currentTick: number;
    /** `[General] Allied/SovietCrew` + `*SurvivorDivisor`, keyed by faction */
    crewTypeFor(faction: string): string | undefined;
    survivorDivisorFor(faction: string): number;
    engineerTypeFor(faction: string): string | undefined;
    /** reference `sellTrait.computeRefundValue(target)` */
    refundValue(target: any): number;
    /** every tile of the footprint, already bounds-checked */
    foundationTiles(target: any): any[];
    /** `map.terrain.getPassableSpeed(tile, speedType, isInfantry, onBridge, undefined, true) > 0` */
    canPlaceInfantryOn(tile: any): boolean;
    createUnit(crewType: string, player: any): any;
    spawnObject(obj: any, tile: any): void;
    generateRandomInt(min: number, max: number): number;
    /** reference `new ScatterTask(context, undefined, { ignoredBlockers })` */
    scatter(unit: any, ignored: any[]): void;
    canProduceVeteran(player: any, rules: any): boolean;
    setVeteran(unit: any): void;
    subCellForInfantry(): number;
}

export class CrewedTrait {
    /** NotifySell.onSell */
    onSell(target: any, world: CrewWorld): void {
        this.spawnSurvivors(target, world);
    }

    /** NotifyDestroy.onDestroy */
    onDestroy(target: any, world: CrewWorld, damageInfo: any, isSell: boolean): void {
        if (
            !isSell &&
            !(damageInfo?.obj === target && damageInfo?.weapon?.rules?.suicide) &&
            !(target.isVehicle?.() && !!target.isMoving) &&
            !target.crashableTrait
        ) {
            this.spawnSurvivors(target, world);
        }
    }

    private spawnSurvivors(target: any, world: CrewWorld): void {
        const faction = target.player?.faction ?? target.owner?.faction;
        const crewType = world.crewTypeFor(faction);
        const survivorDivisor = world.survivorDivisorFor(faction);
        if (!crewType || !survivorDivisor) return;

        let survivorCount = world.refundValue(target) / survivorDivisor;
        survivorCount = survivorCount > 0 && survivorCount < 1 ? 1 : Math.floor(survivorCount);
        survivorCount = target.isVehicle() ? Math.min(1, survivorCount) : Math.min(5, survivorCount);

        const crewTypes: string[] = [];
        for (let i = 0; i < survivorCount; i++) {
            crewTypes.push(crewType);
        }
        if (crewTypes.length > 0) {
            if (target.rules?.constructionYard) {
                const engineer = world.engineerTypeFor(faction);
                if (engineer) crewTypes[crewTypes.length - 1] = engineer;
            }
            const validTiles = world.foundationTiles(target);
            if (!validTiles.length) return;
            const availableTiles = [...validTiles];
            for (const type of crewTypes) {
                // the reference gates the whole batch on the *building's* own tile
                if (!world.canPlaceInfantryOn(target.tile)) continue;
                const unit = world.createUnit(type, target.player ?? target.owner);
                if (!unit) continue;
                const pick = availableTiles.length
                    ? availableTiles.splice(world.generateRandomInt(0, availableTiles.length - 1), 1)[0]
                    : undefined;
                const spawnTile = pick || validTiles[world.generateRandomInt(0, validTiles.length - 1)];
                if (unit.isInfantry?.()) {
                    unit.subCell = world.subCellForInfantry();
                    if (unit.position) unit.position.subCell = world.subCellForInfantry();
                }
                if (world.canProduceVeteran(target.player ?? target.owner, unit.rules)) {
                    world.setVeteran(unit);
                }
                world.spawnObject(unit, spawnTile);
                if (!!target.isBuilding) {
                    world.scatter(unit, target.dead ? [] : [target]);
                }
            }
        }
    }
}
