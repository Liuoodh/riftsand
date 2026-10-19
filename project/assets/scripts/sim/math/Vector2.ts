/**
 * Vector2 — three's Vector2 with the reference's four overrides.
 *
 * Reference: redalert2/src/game/math/Vector2.ts
 *
 * The overrides matter: `length()` / `distanceTo()` go through `GameMath.sqrt`
 * (Newton iteration), and `angle()` / `rotateAround()` use the table-based
 * `GameMath.atan2` / `cos` / `sin`. A caller that compares a computed facing
 * against an exact literal gets the same bit pattern as in the reference.
 */
import { GameMath } from './GameMath';

export class Vector2 {
    readonly isVector2 = true;
    x: number;
    y: number;

    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    get width(): number { return this.x; }
    set width(value: number) { this.x = value; }

    get height(): number { return this.y; }
    set height(value: number) { this.y = value; }

    set(x: number, y: number): this {
        this.x = x;
        this.y = y;
        return this;
    }

    setScalar(s: number): this {
        this.x = s;
        this.y = s;
        return this;
    }

    setX(x: number): this { this.x = x; return this; }
    setY(y: number): this { this.y = y; return this; }

    setComponent(index: number, value: number): this {
        switch (index) {
            case 0: this.x = value; break;
            case 1: this.y = value; break;
            default: throw new Error(`index is out of range: ${index}`);
        }
        return this;
    }

    getComponent(index: number): number {
        switch (index) {
            case 0: return this.x;
            case 1: return this.y;
            default: throw new Error(`index is out of range: ${index}`);
        }
    }

    clone(): Vector2 {
        return new Vector2(this.x, this.y);
    }

    copy(v: Vector2): this {
        this.x = v.x;
        this.y = v.y;
        return this;
    }

    add(v: Vector2): this {
        this.x += v.x;
        this.y += v.y;
        return this;
    }

    addScalar(s: number): this {
        this.x += s;
        this.y += s;
        return this;
    }

    addVectors(a: Vector2, b: Vector2): this {
        this.x = a.x + b.x;
        this.y = a.y + b.y;
        return this;
    }

    addScaledVector(v: Vector2, s: number): this {
        this.x += v.x * s;
        this.y += v.y * s;
        return this;
    }

    sub(v: Vector2): this {
        this.x -= v.x;
        this.y -= v.y;
        return this;
    }

    subScalar(s: number): this {
        this.x -= s;
        this.y -= s;
        return this;
    }

    subVectors(a: Vector2, b: Vector2): this {
        this.x = a.x - b.x;
        this.y = a.y - b.y;
        return this;
    }

    multiply(v: Vector2): this {
        this.x *= v.x;
        this.y *= v.y;
        return this;
    }

    multiplyScalar(s: number): this {
        this.x *= s;
        this.y *= s;
        return this;
    }

    divide(v: Vector2): this {
        this.x /= v.x;
        this.y /= v.y;
        return this;
    }

    divideScalar(s: number): this {
        return this.multiplyScalar(1 / s);
    }

    min(v: Vector2): this {
        this.x = Math.min(this.x, v.x);
        this.y = Math.min(this.y, v.y);
        return this;
    }

    max(v: Vector2): this {
        this.x = Math.max(this.x, v.x);
        this.y = Math.max(this.y, v.y);
        return this;
    }

    clamp(min: Vector2, max: Vector2): this {
        this.x = Math.max(min.x, Math.min(max.x, this.x));
        this.y = Math.max(min.y, Math.min(max.y, this.y));
        return this;
    }

    clampScalar(minVal: number, maxVal: number): this {
        this.x = Math.max(minVal, Math.min(maxVal, this.x));
        this.y = Math.max(minVal, Math.min(maxVal, this.y));
        return this;
    }

    clampLength(min: number, max: number): this {
        const length = this.length();
        return this.divideScalar(length || 1).multiplyScalar(Math.max(min, Math.min(max, length)));
    }

    floor(): this {
        this.x = Math.floor(this.x);
        this.y = Math.floor(this.y);
        return this;
    }

    ceil(): this {
        this.x = Math.ceil(this.x);
        this.y = Math.ceil(this.y);
        return this;
    }

    round(): this {
        this.x = Math.round(this.x);
        this.y = Math.round(this.y);
        return this;
    }

    roundToZero(): this {
        this.x = this.x < 0 ? Math.ceil(this.x) : Math.floor(this.x);
        this.y = this.y < 0 ? Math.ceil(this.y) : Math.floor(this.y);
        return this;
    }

    negate(): this {
        this.x = -this.x;
        this.y = -this.y;
        return this;
    }

    dot(v: Vector2): number {
        return this.x * v.x + this.y * v.y;
    }

    cross(v: Vector2): number {
        return this.x * v.y - this.y * v.x;
    }

    lengthSq(): number {
        return this.x * this.x + this.y * this.y;
    }

    /** reference override — GameMath.sqrt */
    length(): number {
        return GameMath.sqrt(this.x * this.x + this.y * this.y);
    }

    manhattanLength(): number {
        return Math.abs(this.x) + Math.abs(this.y);
    }

    normalize(): this {
        return this.divideScalar(this.length() || 1);
    }

    /** reference override — GameMath.atan2, wrapped to [0, 2π) */
    angle(): number {
        const angle = GameMath.atan2(this.y, this.x);
        return angle < 0 ? angle + 2 * Math.PI : angle;
    }

    setLength(length: number): this {
        return this.normalize().multiplyScalar(length);
    }

    lerp(v: Vector2, alpha: number): this {
        this.x += (v.x - this.x) * alpha;
        this.y += (v.y - this.y) * alpha;
        return this;
    }

    lerpVectors(v1: Vector2, v2: Vector2, alpha: number): this {
        this.x = v1.x + (v2.x - v1.x) * alpha;
        this.y = v1.y + (v2.y - v1.y) * alpha;
        return this;
    }

    distanceToSquared(v: Vector2): number {
        const dx = this.x - v.x;
        const dy = this.y - v.y;
        return dx * dx + dy * dy;
    }

    /** reference override — GameMath.sqrt */
    distanceTo(v: Vector2): number {
        return GameMath.sqrt(this.distanceToSquared(v));
    }

    manhattanDistanceTo(v: Vector2): number {
        return Math.abs(this.x - v.x) + Math.abs(this.y - v.y);
    }

    /** reference override — GameMath.cos / sin */
    rotateAround(center: Vector2, angle: number): this {
        const cos = GameMath.cos(angle);
        const sin = GameMath.sin(angle);

        const x = this.x - center.x;
        const y = this.y - center.y;

        this.x = x * cos - y * sin + center.x;
        this.y = x * sin + y * cos + center.y;

        return this;
    }

    equals(v: Vector2): boolean {
        return v.x === this.x && v.y === this.y;
    }

    fromArray(array: ArrayLike<number>, offset = 0): this {
        this.x = array[offset];
        this.y = array[offset + 1];
        return this;
    }

    toArray(array: number[] = [], offset = 0): number[] {
        array[offset] = this.x;
        array[offset + 1] = this.y;
        return array;
    }

    /** reads the x/y of anything position-shaped (ours or a reference object) */
    static from(v: { x: number; y: number }): Vector2 {
        return new Vector2(v.x, v.y);
    }
}
