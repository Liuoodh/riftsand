/**
 * Vector3 / Quaternion / Euler / Matrix4 — self-contained replacements for the
 * three.js base classes the reference inherits from.
 *
 * Why this file exists
 * --------------------
 * The reference's `game/math/{Vector3,Quaternion,Euler,Matrix4}.ts` all extend
 * three.js and only override the handful of methods that must go through
 * `GameMath` (the fixed-point-ish sin/cos/sqrt tables) instead of `Math`. We do
 * not ship three.js, so the base implementations live here — copied from three's
 * algorithms line for line — and every method the reference overrides keeps the
 * exact same body, including the `GameMath.*` calls.
 *
 * The practical consequence: a turret angle, a jumpjet pitch or a slerp between
 * two headings produces the same number here as in the reference, at the same
 * ~0.003 rad table granularity.
 *
 * All four classes live in one module on purpose. They reference each other
 * (Matrix4 ↔ Vector3 ↔ Quaternion), and splitting them would create import
 * cycles that break three.js's pattern of static scratch objects.
 */
import { GameMath } from './GameMath';
import { clamp } from '../util/math';

export type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';

/* ------------------------------------------------------------------ Vector3 */

export class Vector3 {
    readonly isVector3 = true;
    x: number;
    y: number;
    z: number;

    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    set(x: number, y: number, z: number): this {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    setScalar(s: number): this {
        this.x = s;
        this.y = s;
        this.z = s;
        return this;
    }

    setX(x: number): this { this.x = x; return this; }
    setY(y: number): this { this.y = y; return this; }
    setZ(z: number): this { this.z = z; return this; }

    setComponent(index: number, value: number): this {
        switch (index) {
            case 0: this.x = value; break;
            case 1: this.y = value; break;
            case 2: this.z = value; break;
            default: throw new Error(`index is out of range: ${index}`);
        }
        return this;
    }

    getComponent(index: number): number {
        switch (index) {
            case 0: return this.x;
            case 1: return this.y;
            case 2: return this.z;
            default: throw new Error(`index is out of range: ${index}`);
        }
    }

    clone(): Vector3 {
        return new Vector3(this.x, this.y, this.z);
    }

    copy(v: Vector3): this {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        return this;
    }

    add(v: Vector3): this {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        return this;
    }

    addScalar(s: number): this {
        this.x += s;
        this.y += s;
        this.z += s;
        return this;
    }

    addVectors(a: Vector3, b: Vector3): this {
        this.x = a.x + b.x;
        this.y = a.y + b.y;
        this.z = a.z + b.z;
        return this;
    }

    addScaledVector(v: Vector3, s: number): this {
        this.x += v.x * s;
        this.y += v.y * s;
        this.z += v.z * s;
        return this;
    }

    sub(v: Vector3): this {
        this.x -= v.x;
        this.y -= v.y;
        this.z -= v.z;
        return this;
    }

    subScalar(s: number): this {
        this.x -= s;
        this.y -= s;
        this.z -= s;
        return this;
    }

    subVectors(a: Vector3, b: Vector3): this {
        this.x = a.x - b.x;
        this.y = a.y - b.y;
        this.z = a.z - b.z;
        return this;
    }

    multiply(v: Vector3): this {
        this.x *= v.x;
        this.y *= v.y;
        this.z *= v.z;
        return this;
    }

    multiplyScalar(s: number): this {
        this.x *= s;
        this.y *= s;
        this.z *= s;
        return this;
    }

    multiplyVectors(a: Vector3, b: Vector3): this {
        this.x = a.x * b.x;
        this.y = a.y * b.y;
        this.z = a.z * b.z;
        return this;
    }

    divide(v: Vector3): this {
        this.x /= v.x;
        this.y /= v.y;
        this.z /= v.z;
        return this;
    }

    divideScalar(s: number): this {
        return this.multiplyScalar(1 / s);
    }

    min(v: Vector3): this {
        this.x = Math.min(this.x, v.x);
        this.y = Math.min(this.y, v.y);
        this.z = Math.min(this.z, v.z);
        return this;
    }

    max(v: Vector3): this {
        this.x = Math.max(this.x, v.x);
        this.y = Math.max(this.y, v.y);
        this.z = Math.max(this.z, v.z);
        return this;
    }

    negate(): this {
        this.x = -this.x;
        this.y = -this.y;
        this.z = -this.z;
        return this;
    }

    dot(v: Vector3): number {
        return this.x * v.x + this.y * v.y + this.z * v.z;
    }

    cross(v: Vector3): this {
        return this.crossVectors(this, v);
    }

    crossVectors(a: Vector3, b: Vector3): this {
        const ax = a.x, ay = a.y, az = a.z;
        const bx = b.x, by = b.y, bz = b.z;
        this.x = ay * bz - az * by;
        this.y = az * bx - ax * bz;
        this.z = ax * by - ay * bx;
        return this;
    }

    lengthSq(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z;
    }

    /** reference override — GameMath.sqrt, not Math.sqrt */
    length(): number {
        return GameMath.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }

    manhattanLength(): number {
        return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z);
    }

    normalize(): this {
        return this.divideScalar(this.length() || 1);
    }

    setLength(length: number): this {
        return this.normalize().multiplyScalar(length);
    }

    lerp(v: Vector3, alpha: number): this {
        this.x += (v.x - this.x) * alpha;
        this.y += (v.y - this.y) * alpha;
        this.z += (v.z - this.z) * alpha;
        return this;
    }

    lerpVectors(v1: Vector3, v2: Vector3, alpha: number): this {
        this.x = v1.x + (v2.x - v1.x) * alpha;
        this.y = v1.y + (v2.y - v1.y) * alpha;
        this.z = v1.z + (v2.z - v1.z) * alpha;
        return this;
    }

    distanceToSquared(v: Vector3): number {
        const dx = this.x - v.x;
        const dy = this.y - v.y;
        const dz = this.z - v.z;
        return dx * dx + dy * dy + dz * dz;
    }

    /** reference override — GameMath.sqrt */
    distanceTo(v: Vector3): number {
        return GameMath.sqrt(this.distanceToSquared(v));
    }

    applyQuaternion(q: Quaternion): this {
        const x = this.x, y = this.y, z = this.z;
        const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
        // t = 2 * cross( q.xyz, v )
        const tx = 2 * (qy * z - qz * y);
        const ty = 2 * (qz * x - qx * z);
        const tz = 2 * (qx * y - qy * x);
        // v + q.w * t + cross( q.xyz, t )
        this.x = x + qw * tx + qy * tz - qz * ty;
        this.y = y + qw * ty + qz * tx - qx * tz;
        this.z = z + qw * tz + qx * ty - qy * tx;
        return this;
    }

    /** reference override — routes through Quaternion.setFromEuler */
    applyEuler(euler: Euler): this {
        return this.applyQuaternion(Vector3.scratch.q.setFromEuler(euler));
    }

    /** reference override — routes through Quaternion.setFromAxisAngle */
    applyAxisAngle(axis: Vector3, angle: number): this {
        return this.applyQuaternion(Vector3.scratch.q.setFromAxisAngle(axis, angle));
    }

    projectOnVector(v: Vector3): this {
        const denominator = v.lengthSq();
        if (denominator === 0) return this.set(0, 0, 0);
        const scalar = v.dot(this) / denominator;
        return this.copy(v).multiplyScalar(scalar);
    }

    /** reference override — allocates its own scratch vector */
    projectOnPlane(planeNormal: Vector3): this {
        Vector3.scratch.v.copy(this).projectOnVector(planeNormal);
        return this.sub(Vector3.scratch.v);
    }

    /** reference override */
    reflect(normal: Vector3): this {
        return this.sub(Vector3.scratch.v.copy(normal).multiplyScalar(2 * this.dot(normal)));
    }

    /** reference override — GameMath.acos, clamped */
    angleTo(v: Vector3): number {
        const theta = this.dot(v) / GameMath.sqrt(this.lengthSq() * v.lengthSq());
        return GameMath.acos(clamp(theta, -1, 1));
    }

    setFromSpherical(s: { radius: number; phi: number; theta: number }): this {
        const sinPhiRadius = GameMath.sin(s.phi) * s.radius;
        this.x = sinPhiRadius * GameMath.sin(s.theta);
        this.y = GameMath.cos(s.phi) * s.radius;
        this.z = sinPhiRadius * GameMath.cos(s.theta);
        return this;
    }

    setFromCylindrical(c: { radius: number; theta: number; y: number }): this {
        this.x = c.radius * GameMath.sin(c.theta);
        this.y = c.y;
        this.z = c.radius * GameMath.cos(c.theta);
        return this;
    }

    setFromMatrixPosition(m: Matrix4): this {
        const e = m.elements;
        this.x = e[12];
        this.y = e[13];
        this.z = e[14];
        return this;
    }

    setFromMatrixColumn(matrix: Matrix4, index: number): this {
        return this.fromArray(matrix.elements, index * 4);
    }

    setFromMatrixScale(m: Matrix4): this {
        const sx = this.setFromMatrixColumn(m, 0).length();
        const sy = this.setFromMatrixColumn(m, 1).length();
        const sz = this.setFromMatrixColumn(m, 2).length();
        this.x = sx;
        this.y = sy;
        this.z = sz;
        return this;
    }

    equals(v: Vector3): boolean {
        return v.x === this.x && v.y === this.y && v.z === this.z;
    }

    fromArray(array: ArrayLike<number>, offset = 0): this {
        this.x = array[offset];
        this.y = array[offset + 1];
        this.z = array[offset + 2];
        return this;
    }

    toArray(array: number[] = [], offset = 0): number[] {
        array[offset] = this.x;
        array[offset + 1] = this.y;
        array[offset + 2] = this.z;
        return array;
    }

    round(): this {
        this.x = Math.round(this.x);
        this.y = Math.round(this.y);
        this.z = Math.round(this.z);
        return this;
    }

    floor(): this {
        this.x = Math.floor(this.x);
        this.y = Math.floor(this.y);
        this.z = Math.floor(this.z);
        return this;
    }

    ceil(): this {
        this.x = Math.ceil(this.x);
        this.y = Math.ceil(this.y);
        this.z = Math.ceil(this.z);
        return this;
    }

    clamp(min: Vector3, max: Vector3): this {
        this.x = Math.max(min.x, Math.min(max.x, this.x));
        this.y = Math.max(min.y, Math.min(max.y, this.y));
        this.z = Math.max(min.z, Math.min(max.z, this.z));
        return this;
    }

    /**
     * Scratch objects. Lazy on purpose: a static field initialiser would run
     * while this module is still being evaluated, and `Quaternion` is declared
     * below `Vector3`, so the reference's `private static _quaternion = new
     * Quaternion()` would hit the temporal dead zone.
     */
    private static _scratch?: { q: Quaternion; v: Vector3 };
    private static get scratch(): { q: Quaternion; v: Vector3 } {
        return (Vector3._scratch ??= { q: new Quaternion(), v: new Vector3() });
    }
}

/* --------------------------------------------------------------- Quaternion */

export class Quaternion {
    readonly isQuaternion = true;
    x: number;
    y: number;
    z: number;
    w: number;

    constructor(x = 0, y = 0, z = 0, w = 1) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }

    set(x: number, y: number, z: number, w: number): this {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        return this;
    }

    clone(): Quaternion {
        return new Quaternion(this.x, this.y, this.z, this.w);
    }

    copy(q: Quaternion): this {
        this.x = q.x;
        this.y = q.y;
        this.z = q.z;
        this.w = q.w;
        return this;
    }

    identity(): this {
        return this.set(0, 0, 0, 1);
    }

    setFromEuler(euler: Euler, update = true): this {
        const x = euler.x, y = euler.y, z = euler.z;
        const order = euler.order;
        const cx = GameMath.cos(x / 2);
        const cy = GameMath.cos(y / 2);
        const cz = GameMath.cos(z / 2);
        const sx = GameMath.sin(x / 2);
        const sy = GameMath.sin(y / 2);
        const sz = GameMath.sin(z / 2);

        if (order === 'XYZ') {
            this.x = sx * cy * cz + cx * sy * sz;
            this.y = cx * sy * cz - sx * cy * sz;
            this.z = cx * cy * sz + sx * sy * cz;
            this.w = cx * cy * cz - sx * sy * sz;
        } else if (order === 'YXZ') {
            this.x = sx * cy * cz + cx * sy * sz;
            this.y = cx * sy * cz - sx * cy * sz;
            this.z = cx * cy * sz - sx * sy * cz;
            this.w = cx * cy * cz + sx * sy * sz;
        } else if (order === 'ZXY') {
            this.x = sx * cy * cz - cx * sy * sz;
            this.y = cx * sy * cz + sx * cy * sz;
            this.z = cx * cy * sz + sx * sy * cz;
            this.w = cx * cy * cz - sx * sy * sz;
        } else if (order === 'ZYX') {
            this.x = sx * cy * cz - cx * sy * sz;
            this.y = cx * sy * cz + sx * cy * sz;
            this.z = cx * cy * sz - sx * sy * cz;
            this.w = cx * cy * cz + sx * sy * sz;
        } else if (order === 'YZX') {
            this.x = sx * cy * cz + cx * sy * sz;
            this.y = cx * sy * cz + sx * cy * sz;
            this.z = cx * cy * sz - sx * sy * cz;
            this.w = cx * cy * cz - sx * sy * sz;
        } else if (order === 'XZY') {
            this.x = sx * cy * cz - cx * sy * sz;
            this.y = cx * sy * cz - sx * cy * sz;
            this.z = cx * cy * sz + sx * sy * cz;
            this.w = cx * cy * cz + sx * sy * sz;
        }

        if (update !== false) this._onChangeCallback();
        return this;
    }

    setFromAxisAngle(axis: Vector3, angle: number): this {
        const halfAngle = angle / 2;
        const s = GameMath.sin(halfAngle);
        this.x = axis.x * s;
        this.y = axis.y * s;
        this.z = axis.z * s;
        this.w = GameMath.cos(halfAngle);
        this._onChangeCallback();
        return this;
    }

    setFromRotationMatrix(m: Matrix4): this {
        const te = m.elements;
        const m11 = te[0], m12 = te[4], m13 = te[8];
        const m21 = te[1], m22 = te[5], m23 = te[9];
        const m31 = te[2], m32 = te[6], m33 = te[10];
        const trace = m11 + m22 + m33;

        if (trace > 0) {
            const s = 0.5 / GameMath.sqrt(trace + 1.0);
            this.w = 0.25 / s;
            this.x = (m32 - m23) * s;
            this.y = (m13 - m31) * s;
            this.z = (m21 - m12) * s;
        } else if (m11 > m22 && m11 > m33) {
            const s = 2.0 * GameMath.sqrt(1.0 + m11 - m22 - m33);
            this.w = (m32 - m23) / s;
            this.x = 0.25 * s;
            this.y = (m12 + m21) / s;
            this.z = (m13 + m31) / s;
        } else if (m22 > m33) {
            const s = 2.0 * GameMath.sqrt(1.0 + m22 - m11 - m33);
            this.w = (m13 - m31) / s;
            this.x = (m12 + m21) / s;
            this.y = 0.25 * s;
            this.z = (m23 + m32) / s;
        } else {
            const s = 2.0 * GameMath.sqrt(1.0 + m33 - m11 - m22);
            this.w = (m21 - m12) / s;
            this.x = (m13 + m31) / s;
            this.y = (m23 + m32) / s;
            this.z = 0.25 * s;
        }

        this._onChangeCallback();
        return this;
    }

    setFromUnitVectors(vFrom: Vector3, vTo: Vector3): this {
        let r = vFrom.dot(vTo) + 1;
        if (r < Number.EPSILON) {
            r = 0;
            if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
                this.x = -vFrom.y;
                this.y = vFrom.x;
                this.z = 0;
                this.w = r;
            } else {
                this.x = 0;
                this.y = -vFrom.z;
                this.z = vFrom.y;
                this.w = r;
            }
        } else {
            this.x = vFrom.y * vTo.z - vFrom.z * vTo.y;
            this.y = vFrom.z * vTo.x - vFrom.x * vTo.z;
            this.z = vFrom.x * vTo.y - vFrom.y * vTo.x;
            this.w = r;
        }
        return this.normalize();
    }

    angleTo(q: Quaternion): number {
        return 2 * Math.acos(Math.abs(clamp(this.dot(q), -1, 1)));
    }

    dot(q: Quaternion): number {
        return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
    }

    lengthSq(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    }

    /** reference override — GameMath.sqrt */
    length(): number {
        return GameMath.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    }

    normalize(): this {
        let l = this.length();
        if (l === 0) {
            this.x = 0;
            this.y = 0;
            this.z = 0;
            this.w = 1;
        } else {
            l = 1 / l;
            this.x = this.x * l;
            this.y = this.y * l;
            this.z = this.z * l;
            this.w = this.w * l;
        }
        this._onChangeCallback();
        return this;
    }

    multiply(q: Quaternion): this {
        return this.multiplyQuaternions(this, q);
    }

    premultiply(q: Quaternion): this {
        return this.multiplyQuaternions(q, this);
    }

    multiplyQuaternions(a: Quaternion, b: Quaternion): this {
        const qax = a.x, qay = a.y, qaz = a.z, qaw = a.w;
        const qbx = b.x, qby = b.y, qbz = b.z, qbw = b.w;
        this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
        this.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
        this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
        this.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
        this._onChangeCallback();
        return this;
    }

    /** reference override — every branch of three's slerp, GameMath trig */
    slerp(qb: Quaternion, t: number): this {
        if (t === 0) return this;
        if (t === 1) return this.copy(qb);

        const x = this.x, y = this.y, z = this.z, w = this.w;
        let cosHalfTheta = w * qb.w + x * qb.x + y * qb.y + z * qb.z;

        if (cosHalfTheta < 0) {
            this.w = -qb.w;
            this.x = -qb.x;
            this.y = -qb.y;
            this.z = -qb.z;
            cosHalfTheta = -cosHalfTheta;
        } else {
            this.copy(qb);
        }

        if (cosHalfTheta >= 1.0) {
            this.w = w;
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }

        const sqrSinHalfTheta = 1.0 - cosHalfTheta * cosHalfTheta;
        if (sqrSinHalfTheta <= Number.EPSILON) {
            const s = 1 - t;
            this.w = s * w + t * this.w;
            this.x = s * x + t * this.x;
            this.y = s * y + t * this.y;
            this.z = s * z + t * this.z;
            return this.normalize();
        }

        const sinHalfTheta = GameMath.sqrt(sqrSinHalfTheta);
        const halfTheta = GameMath.atan2(sinHalfTheta, cosHalfTheta);
        const ratioA = GameMath.sin((1 - t) * halfTheta) / sinHalfTheta;
        const ratioB = GameMath.sin(t * halfTheta) / sinHalfTheta;
        this.w = w * ratioA + this.w * ratioB;
        this.x = x * ratioA + this.x * ratioB;
        this.y = y * ratioA + this.y * ratioB;
        this.z = z * ratioA + this.z * ratioB;
        this._onChangeCallback();
        return this;
    }

    invert(): this {
        return this.conjugate();
    }

    conjugate(): this {
        this.x *= -1;
        this.y *= -1;
        this.z *= -1;
        this._onChangeCallback();
        return this;
    }

    equals(q: Quaternion): boolean {
        return q.x === this.x && q.y === this.y && q.z === this.z && q.w === this.w;
    }

    fromArray(array: ArrayLike<number>, offset = 0): this {
        this.x = array[offset];
        this.y = array[offset + 1];
        this.z = array[offset + 2];
        this.w = array[offset + 3];
        return this;
    }

    toArray(array: number[] = [], offset = 0): number[] {
        array[offset] = this.x;
        array[offset + 1] = this.y;
        array[offset + 2] = this.z;
        array[offset + 3] = this.w;
        return array;
    }

    /** three.js hook; the reference never registers a listener on game math */
    _onChangeCallback(): void { /* no-op */ }
}

/* -------------------------------------------------------------------- Euler */

export class Euler {
    readonly isEuler = true;
    x: number;
    y: number;
    z: number;
    order: EulerOrder;

    constructor(x = 0, y = 0, z = 0, order: EulerOrder = 'XYZ') {
        this.x = x;
        this.y = y;
        this.z = z;
        this.order = order;
    }

    set(x: number, y: number, z: number, order: EulerOrder = this.order): this {
        this.x = x;
        this.y = y;
        this.z = z;
        this.order = order;
        return this;
    }

    clone(): Euler {
        return new Euler(this.x, this.y, this.z, this.order);
    }

    copy(e: Euler): this {
        this.x = e.x;
        this.y = e.y;
        this.z = e.z;
        this.order = e.order;
        return this;
    }

    setFromRotationMatrix(matrix: Matrix4, order?: EulerOrder, update = true): this {
        const elements = matrix.elements;
        const m11 = elements[0], m12 = elements[4], m13 = elements[8];
        const m21 = elements[1], m22 = elements[5], m23 = elements[9];
        const m31 = elements[2], m32 = elements[6], m33 = elements[10];
        order = order || this.order;

        if (order === 'XYZ') {
            this.y = GameMath.asin(clamp(m13, -1, 1));
            if (Math.abs(m13) < 0.99999) {
                this.x = GameMath.atan2(-m23, m33);
                this.z = GameMath.atan2(-m12, m11);
            } else {
                this.x = GameMath.atan2(m32, m22);
                this.z = 0;
            }
        } else if (order === 'YXZ') {
            this.x = GameMath.asin(-clamp(m23, -1, 1));
            if (Math.abs(m23) < 0.99999) {
                this.y = GameMath.atan2(m13, m33);
                this.z = GameMath.atan2(m21, m22);
            } else {
                this.y = GameMath.atan2(-m31, m11);
                this.z = 0;
            }
        } else if (order === 'ZXY') {
            this.x = GameMath.asin(clamp(m32, -1, 1));
            if (Math.abs(m32) < 0.99999) {
                this.y = GameMath.atan2(-m31, m33);
                this.z = GameMath.atan2(-m12, m22);
            } else {
                this.y = 0;
                this.z = GameMath.atan2(m21, m11);
            }
        } else if (order === 'ZYX') {
            this.y = GameMath.asin(-clamp(m31, -1, 1));
            if (Math.abs(m31) < 0.99999) {
                this.x = GameMath.atan2(m32, m33);
                this.z = GameMath.atan2(m21, m11);
            } else {
                this.x = 0;
                this.z = GameMath.atan2(-m12, m22);
            }
        } else if (order === 'YZX') {
            this.z = GameMath.asin(clamp(m21, -1, 1));
            if (Math.abs(m21) < 0.99999) {
                this.x = GameMath.atan2(-m23, m22);
                this.y = GameMath.atan2(-m31, m11);
            } else {
                this.x = 0;
                this.y = GameMath.atan2(m13, m33);
            }
        } else if (order === 'XZY') {
            this.z = GameMath.asin(-clamp(m12, -1, 1));
            if (Math.abs(m12) < 0.99999) {
                this.x = GameMath.atan2(m32, m22);
                this.y = GameMath.atan2(m13, m11);
            } else {
                this.x = GameMath.atan2(-m23, m33);
                this.y = 0;
            }
        } else {
            console.warn(`Euler: .setFromRotationMatrix() given unsupported order: ${order}`);
        }

        this.order = order;
        if (update !== false) this._onChangeCallback();
        return this;
    }

    setFromQuaternion(q: Quaternion, order?: EulerOrder, update = true): this {
        Euler.scratch.makeRotationFromQuaternion(q);
        return this.setFromRotationMatrix(Euler.scratch, order, update);
    }

    setFromVector3(v: Vector3, order: EulerOrder = this.order): this {
        return this.set(v.x, v.y, v.z, order);
    }

    reorder(newOrder: EulerOrder): this {
        const quaternion = new Quaternion();
        quaternion.setFromEuler(this);
        return this.setFromQuaternion(quaternion, newOrder);
    }

    equals(e: Euler): boolean {
        return e.x === this.x && e.y === this.y && e.z === this.z && e.order === this.order;
    }

    toVector3(optionalTarget?: Vector3): Vector3 {
        if (optionalTarget) return optionalTarget.set(this.x, this.y, this.z);
        return new Vector3(this.x, this.y, this.z);
    }

    _onChangeCallback(): void { /* no-op */ }

    private static _m?: Matrix4;
    private static get scratch(): Matrix4 {
        return (Euler._m ??= new Matrix4());
    }
}

/* ------------------------------------------------------------------ Matrix4 */

/**
 * 4x4 matrix in three's column-major `elements` layout. Only the operations the
 * reference actually reaches for are implemented; `set()` takes arguments in
 * row-major order exactly like three.
 */
export class Matrix4 {
    readonly isMatrix4 = true;
    elements: number[] = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ];

    set(
        n11: number, n12: number, n13: number, n14: number,
        n21: number, n22: number, n23: number, n24: number,
        n31: number, n32: number, n33: number, n34: number,
        n41: number, n42: number, n43: number, n44: number,
    ): this {
        const te = this.elements;
        te[0] = n11; te[4] = n12; te[8] = n13; te[12] = n14;
        te[1] = n21; te[5] = n22; te[9] = n23; te[13] = n24;
        te[2] = n31; te[6] = n32; te[10] = n33; te[14] = n34;
        te[3] = n41; te[7] = n42; te[11] = n43; te[15] = n44;
        return this;
    }

    identity(): this {
        return this.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    }

    clone(): Matrix4 {
        const m = new Matrix4();
        m.elements = this.elements.slice();
        return m;
    }

    copy(m: Matrix4): this {
        const te = this.elements;
        const me = m.elements;
        for (let i = 0; i < 16; i++) te[i] = me[i];
        return this;
    }

    copyPosition(m: Matrix4): this {
        const te = this.elements;
        const me = m.elements;
        te[12] = me[12];
        te[13] = me[13];
        te[14] = me[14];
        return this;
    }

    multiply(m: Matrix4): this {
        return this.multiplyMatrices(this, m);
    }

    premultiply(m: Matrix4): this {
        return this.multiplyMatrices(m, this);
    }

    multiplyMatrices(a: Matrix4, b: Matrix4): this {
        const ae = a.elements;
        const be = b.elements;
        const te = this.elements;

        const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
        const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
        const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
        const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];

        const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
        const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
        const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
        const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];

        te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
        te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
        te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
        te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;

        te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
        te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
        te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
        te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;

        te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
        te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
        te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
        te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;

        te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
        te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
        te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
        te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;

        return this;
    }

    determinant(): number {
        const te = this.elements;
        const n11 = te[0], n12 = te[4], n13 = te[8], n14 = te[12];
        const n21 = te[1], n22 = te[5], n23 = te[9], n24 = te[13];
        const n31 = te[2], n32 = te[6], n33 = te[10], n34 = te[14];
        const n41 = te[3], n42 = te[7], n43 = te[11], n44 = te[15];

        return (
            n41 * (+n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) +
            n42 * (+n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) +
            n43 * (+n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) +
            n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31)
        );
    }

    transpose(): this {
        const te = this.elements;
        let tmp: number;
        tmp = te[1]; te[1] = te[4]; te[4] = tmp;
        tmp = te[2]; te[2] = te[8]; te[8] = tmp;
        tmp = te[6]; te[6] = te[9]; te[9] = tmp;
        tmp = te[3]; te[3] = te[12]; te[12] = tmp;
        tmp = te[7]; te[7] = te[13]; te[13] = tmp;
        tmp = te[11]; te[11] = te[14]; te[14] = tmp;
        return this;
    }

    invert(): this {
        const te = this.elements;
        const n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3];
        const n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7];
        const n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11];
        const n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15];

        const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
        const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
        const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
        const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

        const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
        if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

        const detInv = 1 / det;
        te[0] = t11 * detInv;
        te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * detInv;
        te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * detInv;
        te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * detInv;

        te[4] = t12 * detInv;
        te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * detInv;
        te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * detInv;
        te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * detInv;

        te[8] = t13 * detInv;
        te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * detInv;
        te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * detInv;
        te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * detInv;

        te[12] = t14 * detInv;
        te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * detInv;
        te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * detInv;
        te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * detInv;

        return this;
    }

    /* ---- reference overrides below: same bodies, GameMath instead of Math --- */

    extractRotation(matrix: Matrix4): this {
        const elements = this.elements;
        const matrixElements = matrix.elements;

        const scaleX = 1 / Matrix4.scratch.v1.setFromMatrixColumn(matrix, 0).length();
        const scaleY = 1 / Matrix4.scratch.v1.setFromMatrixColumn(matrix, 1).length();
        const scaleZ = 1 / Matrix4.scratch.v1.setFromMatrixColumn(matrix, 2).length();

        elements[0] = matrixElements[0] * scaleX;
        elements[1] = matrixElements[1] * scaleX;
        elements[2] = matrixElements[2] * scaleX;
        elements[3] = 0;

        elements[4] = matrixElements[4] * scaleY;
        elements[5] = matrixElements[5] * scaleY;
        elements[6] = matrixElements[6] * scaleY;
        elements[7] = 0;

        elements[8] = matrixElements[8] * scaleZ;
        elements[9] = matrixElements[9] * scaleZ;
        elements[10] = matrixElements[10] * scaleZ;
        elements[11] = 0;

        elements[12] = 0;
        elements[13] = 0;
        elements[14] = 0;
        elements[15] = 1;

        return this;
    }

    makeRotationFromEuler(euler: Euler): this {
        const elements = this.elements;
        const x = euler.x, y = euler.y, z = euler.z;
        const a = GameMath.cos(x);
        const b = GameMath.sin(x);
        const c = GameMath.cos(y);
        const d = GameMath.sin(y);
        const e = GameMath.cos(z);
        const f = GameMath.sin(z);

        if (euler.order === 'XYZ') {
            const ae = a * e, af = a * f, be = b * e, bf = b * f;
            elements[0] = c * e;
            elements[4] = -c * f;
            elements[8] = d;
            elements[1] = af + be * d;
            elements[5] = ae - bf * d;
            elements[9] = -b * c;
            elements[2] = bf - ae * d;
            elements[6] = be + af * d;
            elements[10] = a * c;
        } else if (euler.order === 'YXZ') {
            const ce = c * e, cf = c * f, de = d * e, df = d * f;
            elements[0] = ce + df * b;
            elements[4] = de * b - cf;
            elements[8] = a * d;
            elements[1] = a * f;
            elements[5] = a * e;
            elements[9] = -b;
            elements[2] = cf * b - de;
            elements[6] = df + ce * b;
            elements[10] = a * c;
        } else if (euler.order === 'ZXY') {
            const ce = c * e, cf = c * f, de = d * e, df = d * f;
            elements[0] = ce - df * b;
            elements[4] = -a * f;
            elements[8] = de + cf * b;
            elements[1] = cf + de * b;
            elements[5] = a * e;
            elements[9] = df - ce * b;
            elements[2] = -a * d;
            elements[6] = b;
            elements[10] = a * c;
        } else if (euler.order === 'ZYX') {
            const ae = a * e, af = a * f, be = b * e, bf = b * f;
            elements[0] = c * e;
            elements[4] = be * d - af;
            elements[8] = ae * d + bf;
            elements[1] = c * f;
            elements[5] = bf * d + ae;
            elements[9] = af * d - be;
            elements[2] = -d;
            elements[6] = b * c;
            elements[10] = a * c;
        } else if (euler.order === 'YZX') {
            const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
            elements[0] = c * e;
            elements[4] = bd - ac * f;
            elements[8] = bc * f + ad;
            elements[1] = f;
            elements[5] = a * e;
            elements[9] = -b * e;
            elements[2] = -d * e;
            elements[6] = ad * f + bc;
            elements[10] = ac - bd * f;
        } else if (euler.order === 'XZY') {
            const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
            elements[0] = c * e;
            elements[4] = -f;
            elements[8] = d * e;
            elements[1] = ac * f + bd;
            elements[5] = a * e;
            elements[9] = ad * f - bc;
            elements[2] = bc * f - ad;
            elements[6] = b * e;
            elements[10] = bd * f + ac;
        }

        elements[3] = 0;
        elements[7] = 0;
        elements[11] = 0;
        elements[12] = 0;
        elements[13] = 0;
        elements[14] = 0;
        elements[15] = 1;

        return this;
    }

    makeRotationFromQuaternion(q: Quaternion): this {
        return this.compose(Matrix4.scratch.zero, q, Matrix4.scratch.one);
    }

    lookAt(eye: Vector3, target: Vector3, up: Vector3): this {
        const x = Matrix4.scratch.v1;
        const y = Matrix4.scratch.v2;
        const z = Matrix4.scratch.v3;
        const elements = this.elements;

        z.subVectors(eye, target);
        if (z.lengthSq() === 0) z.z = 1;
        z.normalize();

        x.crossVectors(up, z);
        if (x.lengthSq() === 0) {
            if (Math.abs(up.z) === 1) {
                z.x += 0.0001;
            } else {
                z.z += 0.0001;
            }
            z.normalize();
            x.crossVectors(up, z);
        }
        x.normalize();
        y.crossVectors(z, x);

        elements[0] = x.x; elements[4] = y.x; elements[8] = z.x;
        elements[1] = x.y; elements[5] = y.y; elements[9] = z.y;
        elements[2] = x.z; elements[6] = y.z; elements[10] = z.z;

        return this;
    }

    getMaxScaleOnAxis(): number {
        const elements = this.elements;
        const scaleXSq = elements[0] * elements[0] + elements[1] * elements[1] + elements[2] * elements[2];
        const scaleYSq = elements[4] * elements[4] + elements[5] * elements[5] + elements[6] * elements[6];
        const scaleZSq = elements[8] * elements[8] + elements[9] * elements[9] + elements[10] * elements[10];
        return GameMath.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
    }

    makeRotationX(theta: number): this {
        const c = GameMath.cos(theta);
        const s = GameMath.sin(theta);
        this.set(1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1);
        return this;
    }

    makeRotationY(theta: number): this {
        const c = GameMath.cos(theta);
        const s = GameMath.sin(theta);
        this.set(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1);
        return this;
    }

    makeRotationZ(theta: number): this {
        const c = GameMath.cos(theta);
        const s = GameMath.sin(theta);
        this.set(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
        return this;
    }

    makeRotationAxis(axis: Vector3, angle: number): this {
        const c = GameMath.cos(angle);
        const s = GameMath.sin(angle);
        const t = 1 - c;
        const x = axis.x, y = axis.y, z = axis.z;
        const tx = t * x, ty = t * y;

        this.set(
            tx * x + c, tx * y - s * z, tx * z + s * y, 0,
            tx * y + s * z, ty * y + c, ty * z - s * x, 0,
            tx * z - s * y, ty * z + s * x, t * z * z + c, 0,
            0, 0, 0, 1,
        );
        return this;
    }

    compose(position: Vector3, quaternion: Quaternion, scale: Vector3): this {
        const te = this.elements;

        const x = quaternion.x, y = quaternion.y, z = quaternion.z, w = quaternion.w;
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2;
        const yy = y * y2, yz = y * z2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;

        const sx = scale.x, sy = scale.y, sz = scale.z;

        te[0] = (1 - (yy + zz)) * sx;
        te[1] = (xy + wz) * sx;
        te[2] = (xz - wy) * sx;
        te[3] = 0;

        te[4] = (xy - wz) * sy;
        te[5] = (1 - (xx + zz)) * sy;
        te[6] = (yz + wx) * sy;
        te[7] = 0;

        te[8] = (xz + wy) * sz;
        te[9] = (yz - wx) * sz;
        te[10] = (1 - (xx + yy)) * sz;
        te[11] = 0;

        te[12] = position.x;
        te[13] = position.y;
        te[14] = position.z;
        te[15] = 1;

        return this;
    }

    decompose(position: Vector3, quaternion: Quaternion, scale: Vector3): this {
        const elements = this.elements;

        let sx = Matrix4.scratch.v1.set(elements[0], elements[1], elements[2]).length();
        const sy = Matrix4.scratch.v1.set(elements[4], elements[5], elements[6]).length();
        const sz = Matrix4.scratch.v1.set(elements[8], elements[9], elements[10]).length();

        if (this.determinant() < 0) sx = -sx;

        position.x = elements[12];
        position.y = elements[13];
        position.z = elements[14];

        Matrix4.scratch.m.copy(this);

        const invSX = 1 / sx;
        const invSY = 1 / sy;
        const invSZ = 1 / sz;

        Matrix4.scratch.m.elements[0] *= invSX;
        Matrix4.scratch.m.elements[1] *= invSX;
        Matrix4.scratch.m.elements[2] *= invSX;

        Matrix4.scratch.m.elements[4] *= invSY;
        Matrix4.scratch.m.elements[5] *= invSY;
        Matrix4.scratch.m.elements[6] *= invSY;

        Matrix4.scratch.m.elements[8] *= invSZ;
        Matrix4.scratch.m.elements[9] *= invSZ;
        Matrix4.scratch.m.elements[10] *= invSZ;

        quaternion.setFromRotationMatrix(Matrix4.scratch.m);

        scale.x = sx;
        scale.y = sy;
        scale.z = sz;

        return this;
    }

    /** lazy scratch objects, mirroring three's private statics */
    private static _scratch?: {
        v1: Vector3;
        v2: Vector3;
        v3: Vector3;
        m: Matrix4;
        zero: Vector3;
        one: Vector3;
    };
    private static get scratch() {
        return (Matrix4._scratch ??= {
            v1: new Vector3(),
            v2: new Vector3(),
            v3: new Vector3(),
            m: new Matrix4(),
            zero: new Vector3(),
            one: new Vector3(1, 1, 1),
        });
    }
}
