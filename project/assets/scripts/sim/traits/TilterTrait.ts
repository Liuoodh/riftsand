/**
 * Port of redalert2/src/game/gameobject/trait/TilterTrait.ts.
 *
 * Vehicles on a ramp tilt with the slope. The reference maps the *TMP ramp
 * type* (0..16) to a pitch/yaw pair:
 *
 *   rampType 0 or >= 17        flat
 *   rampType 1..4              pitch 25, yaw -90 * rampType      (N/E/S/W slopes)
 *   rampType 5..16             pitch 25, yaw 225 - ((r-1) % 4)*90 (diagonals)
 *
 * `Tile.rampType` is optional here: this project stores a height level per cell
 * rather than a TMP ramp id, so the trait is inert until a map provides one.
 * The mapping is kept verbatim so the day a TMP-derived rampType exists the
 * tilt is already correct.
 */
export class TilterTrait {
    private tilt: { pitch: number; yaw: number } = { pitch: 0, yaw: 0 };

    /** NotifySpawn */
    onSpawn(target: any): void {
        this.tilt = this.computeTilt(target.tile?.rampType ?? 0);
    }

    /** NotifyTileChange */
    onTileChange(target: any): void {
        this.tilt = this.computeTilt(target.tile?.rampType ?? 0);
    }

    private computeTilt(rampType: number): { pitch: number; yaw: number } {
        let pitch: number;
        let yaw: number;
        if (rampType === 0 || rampType >= 17) {
            pitch = 0;
            yaw = 0;
        } else if (rampType <= 4) {
            pitch = 25;
            yaw = -90 * rampType;
        } else {
            pitch = 25;
            yaw = 225 - ((rampType - 1) % 4) * 90;
        }
        return { pitch, yaw };
    }

    getPitch(): number {
        return this.tilt.pitch;
    }

    getYaw(): number {
        return this.tilt.yaw;
    }

    debugGetState() {
        return { ...this.tilt };
    }
}
