/**
 * Port of redalert2/src/game/gameobject/trait/PoweredTrait.ts.
 *
 * A powered building is usable only while (a) it is toggled on and (b) its
 * owner's grid is not low. `isCharged` is the OverpoweredTrait path (Yuri's
 * power plants); we do not have chargers, so it is always false.
 */
import { PowerLevel } from '../player/PowerTrait';

export class PoweredTrait {
    private obj: any;
    private turnedOn: boolean;

    constructor(obj: any) {
        this.obj = obj;
        this.turnedOn = true;
    }

    setTurnedOn(turnedOn: boolean): void {
        this.turnedOn = turnedOn;
    }

    isCharged(): boolean {
        return !!this.obj.isBuilding && !!this.obj.overpoweredTrait?.hasChargersToPowerOn?.();
    }

    isPoweredOn(checkCharged = false): boolean {
        // `owner` is a player id here; the ported call sites want the player
        // object the reference keeps on `owner`, so fall back through `player`.
        const owner = this.obj?.player ?? this.obj?.owner;
        return (
            !!this.obj &&
            this.turnedOn &&
            (!(checkCharged || !this.isCharged()) ||
                (!this.obj.rules.power && this.obj.rules.needsEngineer
                    ? !owner?.isNeutral
                    : !!owner?.powerTrait && owner.powerTrait.level !== PowerLevel.Low))
        );
    }

    dispose(): void {
        this.obj = undefined;
    }
}
