/**
 * Per-player power grid.
 *
 * Port of redalert2/src/game/player/trait/PowerTrait.ts (verbatim structure).
 *
 * Differences, all mechanical:
 *   - `world.events.dispatch(...)` is a callback (`world.onPowerChange`), and the
 *     `NotifyPower` trait filters are the three optional hooks on the world;
 *   - the output of a power plant is scaled by its health *percentage*, so a
 *     damaged reactor browns out the base exactly like the original:
 *       `ceil(power * health / 100)`
 *   - `blackoutFrames` counts *ticks*, as in the reference. The caller feeds it
 *     one tick at a time (Game keeps a 15 Hz accumulator).
 */

export enum PowerLevel {
    Low = 0,
    Normal = 1,
}

export interface PowerWorld {
    onPowerLow?(player: any): void;
    onPowerRestore?(player: any): void;
    onPowerChange?(player: any, power: number, drain: number): void;
}

export class PowerTrait {
    private player: any;
    private power: number;
    private drain: number;
    private level: PowerLevel;
    private blackoutFrames: number;
    private powerByObject: Map<any, number>;

    constructor(player: any) {
        this.player = player;
        this.power = 0;
        this.drain = 0;
        this.level = PowerLevel.Normal;
        this.blackoutFrames = 0;
        this.powerByObject = new Map();
    }

    isLowPower(): boolean {
        return this.level === PowerLevel.Low;
    }

    /** current output (not counting drain) — HUD reads this */
    getPower(): number { return this.power; }
    getDrain(): number { return this.drain; }
    getLevel(): PowerLevel { return this.level; }

    setBlackoutFor(frames: number, world: PowerWorld): void {
        const wasBlackedOut = this.blackoutFrames > 0;
        this.blackoutFrames = frames;
        if (!wasBlackedOut) this.updateLevel(world);
    }

    updateBlackout(world: PowerWorld): void {
        if (this.blackoutFrames > 0) {
            this.blackoutFrames--;
            if (this.blackoutFrames <= 0) this.updateLevel(world);
        }
    }

    getBlackoutDuration(): number {
        return this.blackoutFrames;
    }

    /**
     * Verbatim `updateFrom`.
     *
     * A negative `power` is drain and only moves on add/remove (health does not
     * change how much a consumer draws). A positive one is output and is stored
     * per object so an `update` can emit the *delta* without recomputing the
     * whole grid.
     */
    updateFrom(object: any, action: 'add' | 'update' | 'remove', world: PowerWorld): void {
        const power = object.rules.power;
        if (!power) return;
        if (power < 0) {
            if (action === 'add' || action === 'remove') {
                this.drain += action === 'add' ? -power : power;
            }
        } else {
            // Bio Reactor: each garrisoned infantry acts as a battery on top of
            // the health-scaled base output.
            const occupantBonus = object.rules.occupantsPowerBonus && object.garrisonTrait?.units.length
                ? object.rules.occupantsPowerBonus * object.garrisonTrait.units.length
                : 0;
            let powerDelta = 0;
            if (action === 'add') {
                const powerValue = Math.ceil((power * object.healthTrait.health) / 100) + occupantBonus;
                this.powerByObject.set(object, powerValue);
                powerDelta = powerValue;
            } else if (action === 'update' || action === 'remove') {
                const oldPowerValue = this.powerByObject.get(object);
                if (oldPowerValue === undefined) {
                    // The reference throws here. A structure can be damaged on the
                    // same frame it is sold, and a throw inside the sim kills the
                    // whole frame, so we treat it as "nothing to update".
                    return;
                }
                if (action === 'update') {
                    const newPowerValue = Math.ceil((power * object.healthTrait.health) / 100) + occupantBonus;
                    this.powerByObject.set(object, newPowerValue);
                    powerDelta = newPowerValue - oldPowerValue;
                } else {
                    this.powerByObject.delete(object);
                    powerDelta = -oldPowerValue;
                }
            }
            this.power += powerDelta;
        }
        this.updateLevel(world);
        world.onPowerChange?.(this.player, this.power, this.drain);
    }

    private updateLevel(world: PowerWorld): void {
        const oldLevel = this.level;
        this.level = this.power >= this.drain && !this.blackoutFrames ? PowerLevel.Normal : PowerLevel.Low;
        if (this.level !== oldLevel) {
            if (oldLevel === PowerLevel.Normal && this.level === PowerLevel.Low) {
                world.onPowerLow?.(this.player);
            }
            if (oldLevel === PowerLevel.Low && this.level === PowerLevel.Normal) {
                world.onPowerRestore?.(this.player);
            }
        }
    }

    /** determinism hash, same field order as the reference */
    getHash(): number {
        let h = 2166136261;
        for (const v of [this.power, this.drain]) {
            h ^= v;
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    debugGetState() {
        return { power: this.power, drain: this.drain, level: this.level, blackoutFrames: this.blackoutFrames };
    }

    dispose(): void {
        this.player = undefined;
        this.powerByObject.clear();
    }
}
