import { LandType } from '../../type/LandType';

/**
 * Verbatim from redalert2/src/game/gameobject/unit/ZoneType.ts.
 *
 * A zone is coarser than a land type: Beach counts as Water because a ship can
 * sit on it, while a cliff counts as Ground because a tank's *projectile* can
 * still cross it. Everything that asks "can this thing be hit" reads the zone,
 * never the land type.
 */
export enum ZoneType {
    Ground = 0,
    Air = 1,
    Water = 2,
}

export const getZoneType = (landType: LandType): ZoneType => {
    return [LandType.Water, LandType.Beach].includes(landType)
        ? ZoneType.Water
        : ZoneType.Ground;
};
