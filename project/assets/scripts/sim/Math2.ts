/**
 * Vector / angle helpers — a 1:1 port of the reference math layer.
 *
 * Reference files:
 *   redalert2/src/game/math/Vector2.ts
 *   redalert2/src/game/math/geometry.ts
 *   redalert2/src/game/gameobject/unit/FacingUtil.ts
 *
 * Nothing here is "improved": the facing convention in particular has to match
 * the reference bit for bit, because every turn / waypoint / turret decision is
 * expressed in it.
 *
 *   facing 0 = north, 90 = west, 180 = south, 270 = east
 *   => atan2(dy, dx) degrees = -facing - 90
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export class Vec2 {
    x: number;
    y: number;

    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    clone(): Vec2 {
        return new Vec2(this.x, this.y);
    }

    copy(v: Vec2): this {
        this.x = v.x;
        this.y = v.y;
        return this;
    }

    set(x: number, y: number): this {
        this.x = x;
        this.y = y;
        return this;
    }

    add(v: Vec2): this {
        this.x += v.x;
        this.y += v.y;
        return this;
    }

    sub(v: Vec2): this {
        this.x -= v.x;
        this.y -= v.y;
        return this;
    }

    multiplyScalar(s: number): this {
        this.x *= s;
        this.y *= s;
        return this;
    }

    length(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    setLength(l: number): this {
        const old = this.length();
        return old === 0 ? this : this.multiplyScalar(l / old);
    }

    normalize(): this {
        return this.setLength(1);
    }

    round(): this {
        this.x = Math.round(this.x);
        this.y = Math.round(this.y);
        return this;
    }

    equals(v: Vec2): boolean {
        return this.x === v.x && this.y === v.y;
    }

    distanceTo(v: Vec2): number {
        const dx = this.x - v.x;
        const dy = this.y - v.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    lerp(v: Vec2, t: number): this {
        this.x += (v.x - this.x) * t;
        this.y += (v.y - this.y) * t;
        return this;
    }
}

/** geometry.angleDegFromVec2 — degrees, (-180, 180] */
export function angleDegFromVec2(v: Vec2): number {
    return Math.atan2(v.y, v.x) * RAD;
}

/** geometry.rotateVec2 — counter-clockwise rotation in degrees */
export function rotateVec2(v: Vec2, deg: number): Vec2 {
    const rad = deg * DEG;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return new Vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

export function angleBetweenVecs(a: Vec2, b: Vec2): number {
    const la = a.length();
    const lb = b.length();
    if (!la || !lb) return 0;
    let cos = (a.x * b.x + a.y * b.y) / (la * lb);
    cos = Math.max(-1, Math.min(1, cos));
    return Math.acos(cos) * RAD;
}

/**
 * FacingUtil — reference: redalert2/src/game/gameobject/unit/FacingUtil.ts
 *
 * tick() is the *only* place a hull is allowed to rotate while driving. Note the
 * snap: when the remaining angle is smaller than one step the result is exactly
 * the target, so a sprite parked on an 8-way boundary cannot flicker between two
 * images forever.
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

    static fromMapCoords(vector: Vec2): number {
        return (-angleDegFromVec2(vector) - 90 + 720) % 360;
    }

    static toMapCoords(angle: number): Vec2 {
        return rotateVec2(new Vec2(1000, 0), FacingUtil.toWorldDeg(angle)).round().normalize();
    }

    static toWorldDeg(angle: number): number {
        return -(angle + 90);
    }
}

/**
 * facing (degrees, reference convention) -> world atan2 angle (radians).
 *
 * Wrapped into (-PI, PI]: the raw formula produces values down to -450 deg
 * (-360 for due east), and the sprite index formula in render/Frames.ts turns
 * anything below -315 into a NEGATIVE index, i.e. "no image".
 */
export function facingToRad(facing: number): number {
    return wrapRad((-facing - 90) * DEG);
}

/** world atan2 angle (radians) -> facing (degrees, reference convention) */
export function radToFacing(rad: number): number {
    return ((-rad * RAD) - 90 + 720) % 360;
}

export function wrapRad(a: number): number {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a <= -Math.PI) a += Math.PI * 2;
    return a;
}

export function clamp(v: number, lo: number, hi: number) {
    return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}
