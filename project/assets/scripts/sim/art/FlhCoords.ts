/**
 * Verbatim from redalert2/src/game/art/FlhCoords.ts.
 *
 * FLH = Forward / Lateral / Height, the muzzle offset in leptons, expressed in
 * the *firing unit's* frame. `Weapon.fire` rotates it by the muzzle facing and
 * then flips `lateral` on every other burst round, which is how a dual-barrel
 * tank alternates barrels without any extra art data.
 */
export class FlhCoords {
    public forward: number;
    public lateral: number;
    public vertical: number;

    constructor(coords?: number[]) {
        this.forward = 0;
        this.lateral = 0;
        this.vertical = 0;
        if (coords && coords.length === 3) {
            this.fromArray(coords);
        }
    }

    fromArray(coords: number[]): FlhCoords {
        this.forward = coords[0];
        this.lateral = coords[1];
        this.vertical = coords[2];
        return this;
    }

    clone(): FlhCoords {
        return new FlhCoords([this.forward, this.lateral, this.vertical]);
    }
}
