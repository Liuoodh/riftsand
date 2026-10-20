/**
 * Port of redalert2/src/game/gameobject/locomotor/LocomotorFactory.ts (40 lines).
 *
 * Maps `Locomotor=` from `rules.ini` onto a locomotor instance. The switch is
 * the only place that mapping exists, so it is worth reading as a table:
 *
 *   Infantry  FootLocomotor      walks, sub-cell aware
 *   Jumpjet   JumpjetLocomotor   aircraft that must land to rearm      (pending)
 *   Vehicle   DriveLocomotor     wheels/tracks, steer curves             — also
 *   Ship      DriveLocomotor       ships use the same driver
 *   Chrono    ChronoLocomotor    teleports; harvester teleporters fall back to
 *                                DriveLocomotor so a chrono miner still drives
 *   Aircraft  WingedLocomotor    planes and helicopters                  (pending)
 *   Missile   MissileLocomotor   guided projectiles
 *   Hover     HoverLocomotor     needs `[Hover]` acceleration/brake rules
 *
 * **Pending:** `Jumpjet` and `Aircraft` need `MoveToDockTask` plus the docking /
 * airport traits, which arrive with the task batch. Until then this throws a
 * named error instead of silently returning a car driver for a plane — a plane
 * with a DriveLocomotor would "drive" through the air at ground speed and look
 * like a physics bug rather than a missing port.
 */
import { LocomotorType } from '../../type/LocomotorType';
import { ChronoLocomotor } from './ChronoLocomotor';
import { DriveLocomotor } from './DriveLocomotor';
import { FootLocomotor } from './FootLocomotor';
import { HoverLocomotor } from './HoverLocomotor';
import { MissileLocomotor } from './MissileLocomotor';

export class LocomotorFactory {
    private game: any;

    constructor(game: any) {
        this.game = game;
    }

    create(obj: any): any {
        const locomotorType = obj.rules.locomotor;
        switch (locomotorType) {
            case LocomotorType.Infantry:
                return new FootLocomotor(this.game);
            case LocomotorType.Vehicle:
            case LocomotorType.Ship:
                return new DriveLocomotor(this.game);
            case LocomotorType.Chrono:
                // A chrono *miner* is a teleporter in name only: retail makes it
                // drive so it can actually reach ore fields, and the harvester
                // task layer assumes MoveTask semantics.
                return obj.isVehicle() && obj.harvesterTrait && obj.rules.teleporter
                    ? new DriveLocomotor(this.game)
                    : new ChronoLocomotor(this.game);
            case LocomotorType.Missile:
                return new MissileLocomotor(this.game, this.game.rules.general.getMissileRules(obj.name));
            case LocomotorType.Hover:
                return new HoverLocomotor(this.game.rules.general.hover);
            case LocomotorType.Aircraft:
                throw new Error(`Aircraft locomotor is ported with the task batch (object "${obj.name}")`);
            case LocomotorType.Jumpjet:
                throw new Error(`Jumpjet locomotor is ported with the task batch (object "${obj.name}")`);
            default:
                throw new Error(`Unhandled locomotor type ${locomotorType}`);
        }
    }
}
