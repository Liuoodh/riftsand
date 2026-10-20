/**
 * Port of redalert2/src/game/gameobject/task/ParadropTask.ts (33 lines).
 *
 * A paradropped infantryman's fall. It is a task rather than a one-shot
 * teleport because the fall is **visible and interruptible**: the unit drops
 * one constant rate per tick, and the renderer reads `position` directly.
 *
 * The landing test is written the awkward way on purpose:
 *
 *     if (bridgeHeight < Math.max(bridgeHeight, currentHeight - fallRate))
 *
 * which is "the next step would go *below* the bridge deck". `Math.max` is the
 * floor: if the unit is already at or under the deck height (a bridge built
 * after the drop started, or a drop onto a cliff), the comparison is false and
 * the unit lands immediately instead of sinking through the map. Writing it as
 * `currentHeight - fallRate > bridgeHeight` looks equivalent but drops units
 * *onto* water when the deck is above them.
 *
 * `handleElevationChange(currentElevation, game)` is called with the elevation
 * the unit is **leaving**, before the position has been snapped — that is what
 * keeps the shadow and the zone assignment in step. On the final tick
 * `position.tileElevation` is snapped to the bridge and `stance` cleared so the
 * unit can act immediately.
 *
 * A drop onto impassable terrain kills the unit with `InfDeathType.None` —
 * "crushed by the ground", no death animation — which is retail's way of
 * saying "you dropped him in the sea".
 */
import { Coords } from '../../Coords';
import { Vector3 } from '../../math/Vector3';
import { InfDeathType } from '../InfDeathType';
import { StanceType } from '../StanceType';
import { Task } from './system/Task';

export class ParadropTask extends Task {
    private game: any;

    constructor(game: any) {
        super();
        this.game = game;
    }

    onTick(e: any): boolean {
        const fallRate = Math.abs(this.game.rules.general.parachuteMaxFallRate);
        const bridgeElevation = e.tile.onBridgeLandType
            ? this.game.map.tileOccupation.getBridgeOnTile(e.tile).tileElevation
            : 0;
        const bridgeHeight = Coords.tileHeightToWorld(bridgeElevation);
        const currentElevation = e.tileElevation;
        const currentHeight = Coords.tileHeightToWorld(currentElevation);
        if (bridgeHeight < Math.max(bridgeHeight, currentHeight - fallRate)) {
            e.position.moveByLeptons3(new Vector3(0, -fallRate, 0));
            e.moveTrait.handleElevationChange(currentElevation, this.game);
            return false;
        }
        e.position.tileElevation = bridgeElevation;
        e.stance = StanceType.None;
        if (!this.game.map.terrain.getPassableSpeed(e.tile, e.rules.speedType, e.isInfantry(), e.onBridge)) {
            e.infDeathType = InfDeathType.None;
            this.game.destroyObject(e, undefined, true);
        }
        return true;
    }
}
