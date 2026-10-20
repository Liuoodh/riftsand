import { Vector2 } from '../../math/Vector2';
import * as geometry from '../../math/geometry';

/**
 * Verbatim from redalert2/src/game/gameobject/unit/FacingUtil.ts.
 *
 * Facing is in degrees, clockwise on the isometric map. `fromMapCoords` is the
 * one that gets called from the damage path: `Warhead.detonate` computes the
 * knock-back direction of a rocked vehicle with it.
 */
export class FacingUtil {
    static tick(currentFacing: number, targetFacing: number, turnRate: number): { facing: number; delta: number } {
        if (currentFacing === targetFacing) {
            return { facing: currentFacing, delta: 0 };
        }
        const clockwiseDelta = (currentFacing - targetFacing + 360) % 360;
        const counterClockwiseDelta = (targetFacing - currentFacing + 360) % 360;
        if (Math.min(clockwiseDelta, counterClockwiseDelta) < turnRate) {
            return { facing: targetFacing, delta: 0 };
        }
        const delta = (counterClockwiseDelta <= clockwiseDelta ? 1 : -1) * turnRate;
        return { facing: (currentFacing + delta + 360) % 360, delta };
    }

    static fromMapCoords(vector: Vector2): number {
        return (-geometry.angleDegFromVec2(vector) - 90 + 720) % 360;
    }

    static toMapCoords(angle: number): Vector2 {
        return geometry
            .rotateVec2(new Vector2(1000, 0), FacingUtil.toWorldDeg(angle))
            .round()
            .normalize();
    }

    static toWorldDeg(angle: number): number {
        return -(angle + 90);
    }
}
