/**
 * Curve helpers — port of the bit of three.js the reference steer curve uses.
 *
 * Reference files:
 *   redalert2/src/game/math/CurvePath.ts
 *   redalert2/src/game/math/LineCurve.ts
 *   redalert2/src/game/math/QuadraticBezierCurve.ts
 *
 * DriveLocomotor builds exactly this path when a tank has momentum and the path
 * turns by less than 90 degrees at the end:
 *
 *     Line(start -> c1) -> QuadraticBezier(c1, mid, c2) -> Line(c2 -> end)
 *
 * so the hull rolls through a wide arc instead of snapping to the new bearing.
 * We re-implement the three.js arc-length API (`getLength`, `getPointAt`,
 * `getTangentAt`) rather than depending on three.js inside the Cocos project.
 */
import { Vec2 } from './Math2';

export class Curve {
    getPoint(_t: number, _out?: Vec2): Vec2 {
        return new Vec2();
    }
}

export class LineCurve extends Curve {
    v1: Vec2;
    v2: Vec2;

    constructor(v1?: Vec2, v2?: Vec2) {
        super();
        this.v1 = v1 ? v1.clone() : new Vec2();
        this.v2 = v2 ? v2.clone() : new Vec2();
    }

    getPoint(t: number, out?: Vec2): Vec2 {
        const p = out ?? new Vec2();
        return p.copy(this.v1).lerp(this.v2, t);
    }
}

export class QuadraticBezierCurve extends Curve {
    v0: Vec2;
    v1: Vec2;
    v2: Vec2;

    constructor(v0?: Vec2, v1?: Vec2, v2?: Vec2) {
        super();
        this.v0 = (v0 ?? new Vec2()).clone();
        this.v1 = (v1 ?? new Vec2()).clone();
        this.v2 = (v2 ?? new Vec2()).clone();
    }

    getPoint(t: number, out?: Vec2): Vec2 {
        const p = out ?? new Vec2();
        const a = (1 - t) * (1 - t);
        const b = 2 * (1 - t) * t;
        const c = t * t;
        return p.set(
            a * this.v0.x + b * this.v1.x + c * this.v2.x,
            a * this.v0.y + b * this.v1.y + c * this.v2.y,
        );
    }
}

interface Sample {
    p: Vec2;
    /** arc length from the start of the whole path */
    s: number;
}

const SAMPLES_PER_CURVE = 64;

export class CurvePath {
    curves: Curve[] = [];
    private samples: Sample[] | null = null;
    private total = 0;

    add(curve: Curve): this {
        this.curves.push(curve);
        this.samples = null;
        return this;
    }

    private build() {
        if (this.samples) return;
        const out: Sample[] = [];
        let s = 0;
        let prev: Vec2 | null = null;
        for (const curve of this.curves) {
            for (let i = 0; i <= SAMPLES_PER_CURVE; i++) {
                if (out.length && i === 0) continue; // shared endpoint
                const p = curve.getPoint(i / SAMPLES_PER_CURVE);
                if (prev) s += p.distanceTo(prev);
                out.push({ p, s });
                prev = p;
            }
        }
        this.samples = out;
        this.total = s;
    }

    getLength(): number {
        this.build();
        return this.total;
    }

    getPointAt(u: number): Vec2 {
        this.build();
        const s = this.samples!;
        if (s.length === 0) return new Vec2();
        if (s.length === 1 || this.total === 0) return s[0].p.clone();
        const target = Math.max(0, Math.min(1, u)) * this.total;
        // binary search for the segment that contains `target`
        let lo = 0;
        let hi = s.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (s[mid].s < target) lo = mid + 1;
            else hi = mid;
        }
        if (lo === 0) return s[0].p.clone();
        const a = s[lo - 1];
        const b = s[lo];
        const len = b.s - a.s;
        const t = len > 0 ? (target - a.s) / len : 0;
        return a.p.clone().lerp(b.p, t);
    }

    getTangentAt(u: number): Vec2 {
        const e = 1e-3;
        const p1 = this.getPointAt(Math.max(0, u - e));
        const p2 = this.getPointAt(Math.min(1, u + e));
        return p2.sub(p1).normalize();
    }
}
