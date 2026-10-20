/**
 * Port of redalert2/src/game/gameobject/Building.ts (193 lines).
 *
 * A building is a `Techno` with a footprint and a three-state lifecycle:
 *
 *     BuildUp ──(buildup timer)──▶ Ready ──(selling)──▶ BuildDown
 *
 * `BuildStatus` is not cosmetic. `update()` disables `attackTrait` for anything
 * that is not `Ready`, and a powered-off building is also not `Ready` for firing
 * purposes — that is why the condition reads
 * `buildStatus !== Ready || (poweredTrait && !isPoweredOn())`. A defence that is
 * merely unpowered still renders, still takes damage, and still counts as
 * `Ready` for every *other* system.
 *
 * `lastBuildStatus` exists so `setBuildStatus` can fire `NotifyBuildStatus` only
 * on a real transition. Without it, re-entering `Ready` every tick would restart
 * the "construction complete" voice line and the radar flash forever.
 *
 * `factory` (trait assembly) ships with the trait batch; see `PORT-MATRIX.md`.
 */
import { ObjectType } from '../type/ObjectType';
import { Coords } from '../Coords';
import { Vector2 } from '../math/Vector2';
import { Techno } from './Techno';
import { NotifyBuildStatus } from './trait/interface/NotifyBuildStatus';
import { BuildStatusChangeEvent } from '../event/BuildStatusChangeEvent';
import { Task } from '../Task';
import { WaitForBuildUpTask } from './task/WaitForBuildUpTask';

export enum BuildStatus {
    BuildUp = 0,
    Ready = 1,
    BuildDown = 2,
}

export class Building extends Techno {
    showWeaponRange = false;
    direction = 0;
    private _buildStatus: BuildStatus;
    lastBuildStatus: BuildStatus;

    garrisonTrait?: any;
    c4ChargeTrait?: any;
    delayedKillTrait?: any;
    cabHutTrait?: any;
    crewedTrait?: any;
    turretTrait?: any;
    overpoweredTrait?: any;
    poweredTrait?: any;
    factoryTrait?: any;
    superWeaponTrait?: any;
    dockTrait?: any;
    helipadTrait?: any;
    unitRepairTrait?: any;
    unitReloadTrait?: any;
    hospitalTrait?: any;
    rallyTrait?: any;
    wallTrait?: any;
    gapGeneratorTrait?: any;
    psychicDetectorTrait?: any;
    tankBunkerTrait?: any;

    constructor(type: ObjectType, name: string, rules: any, art: any) {
        super(type, name, rules, art);
        this._buildStatus = BuildStatus.BuildUp;
        this.lastBuildStatus = this.buildStatus;
    }

    isBuilding(): boolean {
        return true;
    }

    get buildStatus(): BuildStatus {
        return this._buildStatus;
    }

    getFoundation(): any {
        return this.art.foundation;
    }

    getFoundationCenterOffset(): Vector2 {
        const foundation = this.getFoundation();
        return new Vector2(
            (foundation.width / 2) * Coords.LEPTONS_PER_TILE,
            (foundation.height / 2) * Coords.LEPTONS_PER_TILE,
        );
    }

    update(context: any): void {
        if (this.buildStatus === BuildStatus.BuildUp && !this.unitOrderTrait.hasTasks()) {
            this.unitOrderTrait.addTask(
                new WaitForBuildUpTask(context.rules.general.buildupTime, context) as unknown as Task,
            );
        }
        this.attackTrait?.setDisabled(
            this.buildStatus !== BuildStatus.Ready || (!!this.poweredTrait && !this.poweredTrait.isPoweredOn()),
        );
        super.update(context);
    }

    setBuildStatus(status: BuildStatus, context: any): void {
        this._buildStatus = status;
        // Note the comparison order: `lastBuildStatus` holds the value *before*
        // this call, and is only advanced when the status actually moved.
        const oldStatus = this.lastBuildStatus;
        if (this.buildStatus !== oldStatus) {
            this.lastBuildStatus = this.buildStatus;
            this.traits.filter(NotifyBuildStatus).forEach((trait: any) => {
                trait[NotifyBuildStatus.onStatusChange](oldStatus, this, context);
            });
            context.events.dispatch(new BuildStatusChangeEvent(this, this.buildStatus));
        }
    }
}
