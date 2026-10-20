/**
 * Port of redalert2/src/game/gameobject/locomotor/LocomotorFactory.ts (40 lines).
 *
 * Maps `Locomotor=` from `rules.ini` onto a locomotor instance. The switch is
 * the only place that mapping exists, so it is worth reading as a table:
 *
 *   Infantry  FootLocomotor      walks, sub-cell aware
 *   Jumpjet   JumpjetLocomotor   VTOL: climbs before it moves horizontally
 *   Vehicle   DriveLocomotor     wheels/tracks, steer curves        — also
 *   Ship      DriveLocomotor       ships use the same driver
 *   Chrono    ChronoLocomotor    teleports; harvester teleporters fall back to
 *                                DriveLocomotor so a chrono miner still drives
 *   Aircraft  WingedLocomotor    planes and helicopters, two facings
 *   Missile   MissileLocomotor   guided projectiles
 *   Hover     HoverLocomotor     needs `[Hover]` acceleration/brake rules
 *
 * The `Chrono` special case is not an optimisation: retail makes a chrono
 * *miner* drive, because the harvester task layer assumes `MoveTask` semantics
 * (a teleporting miner cannot harvest a field cell by cell).
 */
import { LocomotorType } from '../../type/LocomotorType';
import { ChronoLocomotor } from './ChronoLocomotor';
import { DriveLocomotor } from './DriveLocomotor';
import { FootLocomotor } from './FootLocomotor';
import { HoverLocomotor } from './HoverLocomotor';
import { JumpjetLocomotor } from './JumpjetLocomotor';
import { MissileLocomotor } from './MissileLocomotor';
import { WingedLocomotor } from './WingedLocomotor';

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
            case LocomotorType.Jumpjet:
                return new JumpjetLocomotor(this.game);
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
            case LocomotorType.Aircraft:
                return new WingedLocomotor(this.game);
            case LocomotorType.Missile:
                return new MissileLocomotor(this.game, this.game.rules.general.getMissileRules(obj.name));
            case LocomotorType.Hover:
                return new HoverLocomotor(this.game.rules.general.hover);
            default:
                throw new Error(`Unhandled locomotor type ${locomotorType}`);
        }
    }
}
