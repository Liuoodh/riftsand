/**
 * Curves — the three.js curve classes the reference extends.
 *
 * Reference: redalert2/src/game/math/{CurvePath,LineCurve,QuadraticBezierCurve,
 * CubicBezierCurve3}.ts — all of them bare subclasses that only fix the default
 * target type. The actually used behaviour is three's:
 *
 *   - DriveLocomotor builds a steer curve out of LineCurve + QuadraticBezierCurve
 *     and walks it by arc length (`getPointAt`), which is what makes a vehicle
 *     swing into a turn instead of rotating on the spot.
 *   - MissileLocomotor builds a CubicBezierCurve3 for its terminal dive.
 *
 * So arc-length parameterisation has to be real, not approximate: `getPointAt(u)`
 * maps a *distance fraction* to a curve parameter through the cached length
 * table, exactly like three.
 */
import { Vector2 } from './Vector2';
import { Vector3 } from './Vector3';

const ARC_LENGTH_DIVISIONS = 200;

export abstract class Curve<T extends { distanceTo(other: T): number }> {
    arcLengthDivisions = ARC_LENGTH_DIVISIONS;
    cacheArcLengths: number[] | null = null;
    needsUpdate = false;

    abstract getPoint(t: number, optionalTarget?: T): T;

    getPointAt(u: number, optionalTarget?: T): T {
        const t = this.getUtoTmapping(u);
        return this.getPoint(t, optionalTarget);
    }

    getLengths(divisions = this.arcLengthDivisions): number[] {
        if (this.cacheArcLengths && this.cacheArcLengths.length === divisions + 1 && !this.needsUpdate) {
            return this.cacheArcLengths;
        }
        this.needsUpdate = false;
        const cache: number[] = [];
        let last = this.getPoint(0);
        let sum = 0;
        cache.push(0);
        for (let p = 1; p <= divisions; p++) {
            const current = this.getPoint(p / divisions);
            sum += current.distanceTo(last);
            cache.push(sum);
            last = current;
        }
        this.cacheArcLengths = cache;
        return cache;
    }

    getLength(): number {
        const lengths = this.getLengths();
        return lengths[lengths.length - 1];
    }

    /**
     * Unit tangent at arc-length fraction `u`. Not in the reference's curve file
     * (which relied on a three.js build that had it) but required by
     * `DriveLocomotor`'s steer-curve branch, where the vehicle's facing follows
     * the curve instead of the straight line to the waypoint.
     *
     * Numeric derivative with a fixed delta, exactly like three.js
     * `Curve.getTangent`: two samples one ten-thousandth of the curve apart,
     * normalised.
     */
    getTangentAt(u: number, optionalTarget?: T): T {
        const delta = 0.0001;
        const t1 = Math.max(0, u - delta);
        const t2 = Math.min(1, u + delta);
        const point1 = this.getPointAt(t1);
        const point2 = this.getPointAt(t2);
        const tangent = (optionalTarget ?? this.getPointAt(u)) as any;
        tangent.copy(point2);
        tangent.sub(point1 as any);
        tangent.normalize();
        return tangent as T;
    }

    updateArcLengths(): void {
        this.needsUpdate = true;
        this.cacheArcLengths = null;
        this.getLengths();
    }

    /** three's binary search over the cached length table */
    getUtoTmapping(u: number, distance?: number): number {
        const arcLengths = this.getLengths();
        let i = 0;
        const il = arcLengths.length;
        const targetArcLength = distance ?? u * arcLengths[il - 1];

        let low = 0;
        let high = il - 1;
        let comparison = 0;
        while (low <= high) {
            i = Math.floor(low + (high - low) / 2);
            comparison = arcLengths[i] - targetArcLength;
            if (comparison < 0) {
                low = i + 1;
            } else if (comparison > 0) {
                high = i - 1;
            } else {
                high = i;
                break;
            }
        }

        i = high;
        if (arcLengths[i] === targetArcLength) {
            return i / (il - 1);
        }

        const lengthBefore = arcLengths[i];
        const lengthAfter = arcLengths[i + 1];
        const segmentLength = lengthAfter - lengthBefore;
        const segmentFraction = (targetArcLength - lengthBefore) / segmentLength;
        return (i + segmentFraction) / (il - 1);
    }
}

export class LineCurve extends Curve<Vector2> {
    v1: Vector2;
    v2: Vector2;

    constructor(v1?: Vector2, v2?: Vector2) {
        super();
        this.v1 = v1 || new Vector2();
        this.v2 = v2 || new Vector2();
    }

    getPoint(t: number, optionalTarget?: Vector2): Vector2 {
        const point = optionalTarget || new Vector2();
        const { v1, v2 } = this;
        if (t === 1) {
            point.copy(v2);
        } else {
            point.copy(v2).sub(v1);
            point.multiplyScalar(t).add(v1);
        }
        return point;
    }
}

function quadraticBezier(t: number, p0: number, p1: number, p2: number): number {
    const t2 = t * t;
    return (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t2 * p2;
}

function cubicBezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
    const v0 = (p2 - p0) * 0.5;
    const v1 = (p3 - p1) * 0.5;
    const t2 = t * t;
    const t3 = t * t2;
    return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}

export class QuadraticBezierCurve extends Curve<Vector2> {
    v0: Vector2;
    v1: Vector2;
    v2: Vector2;

    constructor(v0?: Vector2, v1?: Vector2, v2?: Vector2) {
        super();
        this.v0 = v0 || new Vector2();
        this.v1 = v1 || new Vector2();
        this.v2 = v2 || new Vector2();
    }

    getPoint(t: number, optionalTarget?: Vector2): Vector2 {
        const point = optionalTarget || new Vector2();
        const { v0, v1, v2 } = this;
        point.set(
            quadraticBezier(t, v0.x, v1.x, v2.x),
            quadraticBezier(t, v0.y, v1.y, v2.y),
        );
        return point;
    }
}

export class CubicBezierCurve3 extends Curve<Vector3> {
    v0: Vector3;
    v1: Vector3;
    v2: Vector3;
    v3: Vector3;

    constructor(v0?: Vector3, v1?: Vector3, v2?: Vector3, v3?: Vector3) {
        super();
        this.v0 = v0 || new Vector3();
        this.v1 = v1 || new Vector3();
        this.v2 = v2 || new Vector3();
        this.v3 = v3 || new Vector3();
    }

    getPoint(t: number, optionalTarget?: Vector3): Vector3 {
        const point = optionalTarget || new Vector3();
        const { v0, v1, v2, v3 } = this;
        point.set(
            cubicBezier(t, v0.x, v1.x, v2.x, v3.x),
            cubicBezier(t, v0.y, v1.y, v2.y, v3.y),
            cubicBezier(t, v0.z, v1.z, v2.z, v3.z),
        );
        return point;
    }
}

export class CurvePath<T extends { distanceTo(other: T): number }> extends Curve<T> {
    curves: Curve<T>[] = [];
    autoClose = false;
    /** cumulative length at the end of each curve — three's `cacheLengths` */
    private cacheLengths: number[] | null = null;

    add(curve: Curve<T>): this {
        this.curves.push(curve);
        this.cacheLengths = null;
        return this;
    }

    /** reference override — closes the path with a straight segment if open */
    closePath(): this {
        const start = this.curves[0].getPoint(0);
        const end = this.curves[this.curves.length - 1].getPoint(1);
        if (!(start as any).equals(end)) {
            this.curves.push(new LineCurve(end as any, start as any) as unknown as Curve<T>);
            this.cacheLengths = null;
        }
        return this;
    }

    /**
     * Per-segment cumulative length. Distinct from `getLengths()`, which is the
     * *sampled* table `getUtoTmapping` binary-searches: that one has
     * `divisions + 1` entries and indexes curve parameters, this one has exactly
     * one entry per curve and indexes curves. Confusing the two makes
     * `getPoint()` walk off the end of `curves`.
     */
    getCurveLengths(): number[] {
        if (this.cacheLengths && this.cacheLengths.length === this.curves.length) {
            return this.cacheLengths;
        }
        let sum = 0;
        const lengths: number[] = [];
        for (const curve of this.curves) {
            sum += curve.getLength();
            lengths.push(sum);
        }
        this.cacheLengths = lengths;
        return lengths;
    }

    getLength(): number {
        const lengths = this.getCurveLengths();
        return lengths.length ? lengths[lengths.length - 1] : 0;
    }

    /** three's `CurvePath.getPoint`: pick the segment, then the offset inside it */
    getPoint(t: number, optionalTarget?: T): T {
        const d = t * this.getLength();
        const curveLengths = this.getCurveLengths();
        let i = 0;
        while (i < curveLengths.length) {
            if (curveLengths[i] >= d) {
                const diff = curveLengths[i] - d;
                const curve = this.curves[i];
                const segmentLength = curve.getLength();
                const u = segmentLength === 0 ? 0 : 1 - diff / segmentLength;
                return curve.getPointAt(u, optionalTarget);
            }
            i++;
        }
        return this.curves.length
            ? this.curves[this.curves.length - 1].getPoint(1, optionalTarget)
            : (undefined as unknown as T);
    }
}
