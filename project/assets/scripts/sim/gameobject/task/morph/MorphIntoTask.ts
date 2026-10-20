/**
 * Port of redalert2/src/game/gameobject/task/morph/MorphIntoTask.ts (81 lines).
 *
 * The shared body of deploy / undeploy / pack: destroy the current object and
 * create its counterpart **in place**, carrying health, selection, control group
 * and purchase value across the swap.
 *
 * `morphInto` is not a constructor argument — subclasses (`DeployIntoTask`,
 * `UndeployIntoTask`) resolve it in `onStart` from `rules.deploysInto` /
 * `rules.undeploysInto`. That is why `onStart` throws if it is still unset: a
 * missing `DeploysInto=` in the INI must be a loud failure, not a silent no-op
 * that consumes the order.
 *
 * Two preparatory children run before the swap:
 *
 *   - **`PackBuildingTask`** when a *building* is morphing into a non-building
 *     and is not already packed down. Deploying a construction yard back into an
 *     MCV is visually "the yard folds up" — that animation is the pack timer,
 *     and skipping it makes the MCV appear mid-air.
 *   - **`TurnTask(180)`** when a *vehicle* is morphing into a building, so the
 *     deployed structure faces the direction retail faces it.
 *
 * The swap itself is destructive: `unspawnObject` then `dispose()`. Everything
 * that must survive has to be copied *after* the new object exists but the old
 * one must already be gone — hence `newObject.healthTrait.health = unit.healthTrait.health`
 * reads a disposed object. That is safe only because `dispose()` clears traits
 * and subscriptions, not plain fields.
 *
 * The infantry branch is the interesting one: move tasks are **carried over** to
 * the new object (`moveTasks.forEach(...)`), because deploy-while-moving is
 * legal and dropping the order would strand a unit mid-field. Buildings get no
 * such treatment: a building cannot move.
 *
 * `unit.replacedBy = newObject` is the link that lets an attacker's `AttackTask`
 * follow a target through a deploy (`targetObj.replacedBy`). Break it and every
 * shot in flight at a deploying unit is wasted.
 */
import { Task } from '../system/Task';
import { ObjectType } from '../../../type/ObjectType';
import { BuildStatus } from '../../Building';
import { MoveTask } from '../move/MoveTask';
import { ObjectMorphEvent } from '../../../event/ObjectMorphEvent';
import { BuildingPlaceEvent } from '../../../event/BuildingPlaceEvent';
import { TurnTask } from '../TurnTask';
import { PackBuildingTask } from './PackBuildingTask';

export class MorphIntoTask extends Task {
    protected game: any;
    protected morphInto: any;

    constructor(game: any) {
        super();
        this.game = game;
    }

    onStart(unit: any): void {
        if (!this.morphInto) throw new Error('morphInto not set');
        if (unit.isBuilding() && unit.buildStatus !== BuildStatus.BuildDown && this.morphInto.type !== ObjectType.Building) {
            this.children.push(new PackBuildingTask(this.game));
        }
        if (unit.isVehicle() && this.morphInto.type === ObjectType.Building) {
            this.children.push(new TurnTask(180));
        }
    }

    onTick(unit: any): boolean {
        if (!this.morphInto) throw new Error('morphInto not set');
        const selection = this.game.getUnitSelection();
        const isSelected = selection.isSelected(unit);
        const controlGroup = selection.getOrCreateSelectionModel(unit).getControlGroupNumber();
        const morphTarget = this.morphInto;
        let newObject: any;
        if (morphTarget.type === ObjectType.Building) {
            if (unit.isVehicle() && unit.parasiteableTrait?.isInfested() && !unit.parasiteableTrait.beingBoarded) {
                return true;
            }
            const tile = unit.tile;
            const constructionWorker = this.game.getConstructionWorker(unit.owner);
            if (
                !constructionWorker.canPlaceAt(this.morphInto.name, tile, {
                    ignoreAdjacent: true,
                    ignoreObjects: [unit],
                })
            ) {
                return true;
            }
            this.game.unspawnObject(unit);
            unit.dispose();
            [newObject] = constructionWorker.placeAt(this.morphInto.name, tile);
            newObject.healthTrait.health = unit.healthTrait.health;
            // Deploying plays the same slam as sidebar placement (retail).
            this.game.events.dispatch(new BuildingPlaceEvent(newObject));
        } else {
            const moveTasks = unit.unitOrderTrait.getTasks().filter((task: any) => task instanceof MoveTask);
            this.game.unspawnObject(unit);
            unit.dispose();
            newObject = this.game.createUnitForPlayer(this.morphInto, unit.owner);
            newObject.direction = 180;
            newObject.healthTrait.health = unit.healthTrait.health;
            const foundationCenter = unit.art.foundationCenter;
            this.game.spawnObject(
                newObject,
                this.game.map.tiles.getByMapCoords(unit.tile.rx + foundationCenter.x, unit.tile.ry + foundationCenter.y),
            );
            moveTasks.forEach((task: any) => newObject.unitOrderTrait.addTask(task));
        }
        newObject.purchaseValue = unit.purchaseValue;
        unit.replacedBy = newObject;
        if (isSelected) {
            selection.addToSelection(newObject);
        }
        if (controlGroup !== undefined) {
            selection.addUnitsToGroup(controlGroup, [newObject], false);
        }
        this.game.events.dispatch(new ObjectMorphEvent(unit, newObject));
        return true;
    }
}
