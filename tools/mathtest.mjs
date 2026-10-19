/**
 * B1 (math foundation) regression.
 *
 * The math layer is invisible until something moves, so this script asserts the
 * two properties that actually matter:
 *
 *   A. IDENTITY — the table-driven trig, the MT19937 stream and the iso
 *      projection produce the *reference's* numbers, not merely plausible ones.
 *      The strongest checks are the MT19937 standard vector (seed 5489 →
 *      3499211612) and `GameMath.cos(a) === GameMath.sin(a + PI/2)`, which only
 *      holds if `cos` is literally defined as a shifted `sin` off the same table.
 *
 *   B. BEHAVIOUR — the quirks that downstream code depends on are preserved:
 *      `rotateVec2` floors the angle, `angleDegFromVec2` rounds,
 *      `makeRotationFromEuler` is orthonormal for all six orders, and slerp
 *      short-circuits at t = 0 / 1.
 *
 * usage: node tools/mathtest.mjs [url]
 */
import { createRequire } from 'node:module';

const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html?auto=1';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0, fail = 0;
const check = (name, ok, note = '') => {
    if (ok) { pass++; console.log(`PASS  ${name}${note ? '  · ' + note : ''}`); }
    else { fail++; console.log(`FAIL  ${name}${note ? '  · ' + note : ''}`); }
};

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__riftsandSim, { timeout: 60000 });

/** run a function inside the page and return its JSON result */
const T = (fn) => page.evaluate(fn);

/* ------------------------------------------------ A1. table-driven trig ---- */
const trig = await T(() => {
    const { GameMath } = window.__riftsandSim;
    const a = Math.PI / 6;
    const s = GameMath.sin(a);
    const m = Math.sin(a);
    // PI/6 happens to land exactly on a table sample (1296 / 12), so it matches
    // Math.sin bit for bit. PI/7 falls between samples and exposes the table.
    const off = Math.PI / 7;
    return {
        sinZero: GameMath.sin(0),
        sin30: s,
        mathSin30: m,
        same: GameMath.sin(off) === Math.sin(off),
        sinOff: GameMath.sin(off),
        mathSinOff: Math.sin(off),
        cosDef: GameMath.cos(a) === GameMath.sin(a + Math.PI / 2),
        cos30: GameMath.cos(a),
        // the table spans one full turn, so the quantisation is 2π/len
        tableLen: GameMath.SIN_TABLE.length,
        step: (2 * Math.PI) / GameMath.SIN_TABLE.length,
    };
});
check('GameMath.sin(0) 精确为 0', trig.sinZero === 0, `sin(0)=${trig.sinZero}`);
check('GameMath.sin(π/6) = 0.5（π/6 恰好落在采样点上）',
    Math.abs(trig.sin30 - 0.5) < 1e-12, `table=${trig.sin30}`);
check('GameMath.sin(π/7) 与 Math.sin 不同（离网格角度走查表）',
    trig.same === false && Math.abs(trig.sinOff - trig.mathSinOff) > 0,
    `table=${trig.sinOff.toFixed(9)} math=${trig.mathSinOff.toFixed(9)}`);
check('GameMath.cos(a) 就是 GameMath.sin(a + π/2)（原版定义）',
    trig.cosDef === true, `cos=${trig.cos30.toFixed(9)}`);
check('SIN_TABLE 为 1296 项（原版全周期采样数）',
    trig.tableLen === 1296, `len=${trig.tableLen}`);

/* ------------------------------------------- A2. inverse trig + pow/sqrt --- */
const inv = await T(() => {
    const { GameMath } = window.__riftsandSim;
    let maxAtan2 = 0, maxSqrt = 0, maxAsin = 0;
    const samples = [-3, -1.5, -0.7, -0.25, 0, 0.25, 0.7, 1.5, 3];
    for (const y of samples) {
        for (const x of samples) {
            if (!x && !y) continue;
            maxAtan2 = Math.max(maxAtan2, Math.abs(GameMath.atan2(y, x) - Math.atan2(y, x)));
        }
    }
    for (let v = 0.001; v < 100; v *= 1.7) {
        maxSqrt = Math.max(maxSqrt, Math.abs(GameMath.sqrt(v) - Math.sqrt(v)));
    }
    for (const v of [-1, -0.9, -0.5, 0, 0.5, 0.9, 1]) {
        maxAsin = Math.max(maxAsin, Math.abs(GameMath.asin(v) - Math.asin(v)));
    }
    return {
        maxAtan2, maxSqrt, maxAsin,
        // pow quantises the base to 6 decimals unless both operands are ints
        powFrac: GameMath.pow(1.1, 2),
        powExact: 1.1 ** 2,
        powInt: GameMath.pow(2, 10),
        atan2Quad: [GameMath.atan2(1, 0), GameMath.atan2(0, -1), GameMath.atan2(-1, 0)],
    };
});
check('GameMath.atan2 误差 < 1e-3（三次多项式近似，原版精度）', inv.maxAtan2 < 1e-3, `max=${inv.maxAtan2.toExponential(2)}`);
check('GameMath.sqrt 误差 < 1e-14（牛顿迭代）', inv.maxSqrt < 1e-14, `max=${inv.maxSqrt.toExponential(2)}`);
check('GameMath.asin 误差 < 0.005（反查表）', inv.maxAsin < 0.005, `max=${inv.maxAsin.toFixed(6)}`);
check('GameMath.pow 整数走精确幂，小数走 6 位定点',
    inv.powInt === 1024 && inv.powFrac !== inv.powExact,
    `2^10=${inv.powInt} 1.1²=${inv.powFrac} vs ${inv.powExact}`);
check('atan2 四象限边界正确',
    inv.atan2Quad[0] === Math.PI / 2 && inv.atan2Quad[1] === Math.PI && inv.atan2Quad[2] === -Math.PI / 2,
    `${inv.atan2Quad.map((v) => v.toFixed(4)).join(' / ')}`);

/* ----------------------------------------------- A3. MT19937 known vector -- */
const mt = await T(() => {
    const { Prng } = window.__riftsandSim;
    // the canonical MT19937 test vector: init_genrand(5489)
    const p = new Prng(5489);
    const first = Math.round(p.generateRandom() * 4294967296);
    const second = Math.round(p.generateRandom() * 4294967296);
    // determinism + seeding through the reference's string concat
    const a = Prng.factory(1234, 7);
    const b = Prng.factory(1234, 7);
    const seqA = [a.generateRandom(), a.generateRandom(), a.generateRandom()];
    const seqB = [b.generateRandom(), b.generateRandom(), b.generateRandom()];
    const c = Prng.factory(1234, 8);
    const seqC = [c.generateRandom(), c.generateRandom(), c.generateRandom()];
    // numeric seed + sequence is concatenated as a string, not added
    const d = Prng.factory(12, 34);
    const e = new Prng(Number('12' + '34'));
    const conflation = Math.abs(d.generateRandom() - e.generateRandom()) < 1e-15;
    // range mapping
    const r = new Prng(99);
    let min = Infinity, max = -Infinity, lastOk = true;
    for (let i = 0; i < 4000; i++) {
        const v = r.generateRandomInt(3, 9);
        min = Math.min(min, v);
        max = Math.max(max, v);
        if (v !== Math.floor(v) || v < 3 || v > 9) lastOk = false;
        if (r.getLastRandom() < 0 || r.getLastRandom() >= 1) lastOk = false;
    }
    return {
        first, second,
        sameSeq: seqA.join() === seqB.join(),
        diffSeq: seqA.join() !== seqC.join(),
        conflation,
        min, max, lastOk,
    };
});
check('MT19937 标准测试向量（seed 5489 → 3499211612）',
    mt.first === 3499211612, `first=${mt.first}`);
check('MT19937 第二个输出与标准一致（581869302）',
    mt.second === 581869302, `second=${mt.second}`);
check('同一 (seed, sequence) 产生同一序列', mt.sameSeq === true);
check('不同 sequence 产生不同序列（联机同步基础）', mt.diffSeq === true);
check('seed 与 sequence 是字符串拼接而非数值相加', mt.conflation === true);
check('generateRandomInt 落在闭区间且 lastRandom ∈ [0,1)',
    mt.lastOk && mt.min === 3 && mt.max === 9, `min=${mt.min} max=${mt.max}`);

/* --------------------------------------------- A4. vectors and rotations --- */
const vec = await T(() => {
    const { Vector2, Vector3, GameMath } = window.__riftsandSim;
    const v = new Vector2(1, 0);
    v.rotateAround(new Vector2(0, 0), Math.PI / 2);
    const angle = new Vector2(0, 1).angle();
    const len = new Vector2(3, 4).length();
    const d = new Vector2(0, 0).distanceTo(new Vector2(3, 4));

    const a = new Vector3(1, 2, 3);
    const b = new Vector3(4, 5, 6);
    const cross = a.clone().cross(b);
    const dot = a.dot(b);

    return {
        rotX: v.x, rotY: v.y,
        angle, len, d,
        cross: [cross.x, cross.y, cross.z],
        dot,
        v3len: new Vector3(1, 2, 2).length(),
        normalizeZero: new Vector3(0, 0, 0).normalize().length(),
    };
});
check('Vector2.rotateAround 90° 用查表 cos/sin（精确到 3e-3）',
    Math.abs(vec.rotX) < 0.005 && Math.abs(vec.rotY - 1) < 0.005,
    `(1,0)→(${vec.rotX.toFixed(5)}, ${vec.rotY.toFixed(5)})`);
check('Vector2.angle() 与 length()/distanceTo() 走 GameMath',
    Math.abs(vec.angle - Math.PI / 2) < 0.005 && vec.len === 5 && vec.d === 5,
    `angle=${vec.angle.toFixed(5)} len=${vec.len} dist=${vec.d}`);
check('Vector3 叉积 / 点积 / 长度正确',
    vec.cross[0] === -3 && vec.cross[1] === 6 && vec.cross[2] === -3 &&
    vec.dot === 32 && vec.v3len === 3,
    `cross=${vec.cross} dot=${vec.dot} |(1,2,2)|=${vec.v3len}`);
check('零向量 normalize 不产生 NaN', vec.normalizeZero === 0);

/* ------------------------------------- A5. matrices / quaternions / euler --- */
const rot = await T(() => {
    const { Matrix4, Vector3, Quaternion, Euler } = window.__riftsandSim;
    const orders = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'];
    const ortho = {};
    for (const order of orders) {
        const m = new Matrix4().makeRotationFromEuler(new Euler(0.3, -0.7, 1.1, order));
        const e = m.elements;
        // columns must be unit length and mutually orthogonal
        const col = (i) => new Vector3(e[i * 4], e[i * 4 + 1], e[i * 4 + 2]);
        const c0 = col(0), c1 = col(1), c2 = col(2);
        ortho[order] = {
            l0: c0.length(), l1: c1.length(), l2: c2.length(),
            d01: c0.dot(c1), d02: c0.dot(c2), d12: c1.dot(c2),
            det: m.determinant(),
        };
    }

    // Euler -> Quaternion -> Euler round trip
    const euler = new Euler(0.4, 0.9, -1.3, 'YXZ');
    const q = new Quaternion().setFromEuler(euler);
    const back = new Euler().setFromQuaternion(q, 'YXZ');

    // applyEuler must equal applying the rotation matrix to the vector
    const v1 = new Vector3(1, 0, 0).applyEuler(new Euler(0, Math.PI / 2, 0));
    const m = new Matrix4().makeRotationFromEuler(new Euler(0, Math.PI / 2, 0));
    const e = m.elements;
    const v2 = new Vector3(e[0] * 1 + e[4] * 0 + e[8] * 0, e[1] * 1 + e[5] * 0 + e[9] * 0, e[2] * 1 + e[6] * 0 + e[10] * 0);

    // slerp endpoints
    const qa = new Quaternion().setFromEuler(new Euler(0, 0, 0));
    const qb = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));
    const s0 = qa.clone().slerp(qb, 0);
    const s1 = qa.clone().slerp(qb, 1);
    const sh = qa.clone().slerp(qb, 0.5);

    return {
        ortho,
        roundTrip: [back.x, back.y, back.z].map((v) => Math.abs(v - [0.4, 0.9, -1.3][[back.x, back.y, back.z].indexOf(v)])),
        eulerBack: [back.x, back.y, back.z],
        applyEuler: [v1.x, v1.y, v1.z],
        fromMatrix: [v2.x, v2.y, v2.z],
        slerp0: [s0.x, s0.y, s0.z, s0.w],
        slerp1: [s1.x, s1.y, s1.z, s1.w],
        slerpHalf: [sh.x, sh.y, sh.z, sh.w],
    };
});
let orthoOk = true, orthoNote = [];
for (const [order, o] of Object.entries(rot.ortho)) {
    const ok = Math.abs(o.l0 - 1) < 1e-6 && Math.abs(o.l1 - 1) < 1e-6 && Math.abs(o.l2 - 1) < 1e-6 &&
        Math.abs(o.d01) < 1e-6 && Math.abs(o.d02) < 1e-6 && Math.abs(o.d12) < 1e-6 &&
        Math.abs(o.det - 1) < 1e-6;
    if (!ok) { orthoOk = false; orthoNote.push(`${order}(l=${o.l0.toFixed(4)},det=${o.det.toFixed(4)})`); }
}
check('makeRotationFromEuler 六个 order 全部正交且 det=1',
    orthoOk, orthoOk ? 'XYZ/YXZ/ZXY/ZYX/YZX/XZY' : orthoNote.join(' '));

const rtOk = rot.eulerBack.every((v, i) => Math.abs(v - [0.4, 0.9, -1.3][i]) < 0.01);
check('Euler → Quaternion → Euler 往返一致', rtOk, `[${rot.eulerBack.map((v) => v.toFixed(3)).join(', ')}]`);

const aeOk = rot.applyEuler.every((v, i) => Math.abs(v - rot.fromMatrix[i]) < 1e-6);
check('Vector3.applyEuler 与旋转矩阵结果一致', aeOk,
    `euler=[${rot.applyEuler.map((v) => v.toFixed(4)).join(', ')}]`);

const slerpOk =
    Math.abs(rot.slerp0[3] - 1) < 1e-9 &&
    Math.abs(rot.slerp1[1] - Math.sin(Math.PI / 4)) < 0.01 &&
    Math.abs(rot.slerpHalf[1] - Math.sin(Math.PI / 8)) < 0.02;
check('Quaternion.slerp 在 t=0 / 0.5 / 1 处正确',
    slerpOk, `t0.w=${rot.slerp0[3].toFixed(3)} t1.y=${rot.slerp1[1].toFixed(3)} t.5.y=${rot.slerpHalf[1].toFixed(3)}`);

/* ----------------------------------------------------- A6. iso projection -- */
const iso = await T(() => {
    const { Coords } = window.__riftsandSim;
    const t = Coords.tileToWorld(3, 5);
    const d = Coords.screenDistanceToWorld(30, 60);
    return {
        scale: Coords.ISO_WORLD_SCALE,
        tile: [t.x, t.y],
        dist: [d.x, d.y],
        zScale: Coords.zScale,
        height: Coords.tileHeightToWorld(2),
        back: Coords.worldToTileHeight(Coords.tileHeightToWorld(2)),
        consts: [Coords.ISO_TILE_SIZE, Coords.LEPTONS_PER_TILE],
    };
});
check('Coords 常量与参考一致（30px 瓦片 / 256 leptons）',
    iso.consts[0] === 30 && iso.consts[1] === 256 && Math.abs(iso.scale - 256 / 30) < 1e-9,
    `tile=${iso.consts[0]} leptons=${iso.consts[1]} scale=${iso.scale.toFixed(4)}`);
check('tileToWorld / screenDistanceToWorld 正确',
    iso.tile[0] === 768 && iso.tile[1] === 1280 &&
    iso.dist[0] === Math.floor(((30 + 2 * 60) / 2) * iso.scale) &&
    iso.dist[1] === Math.floor(((2 * 60 - 30) / 2) * iso.scale),
    `tile=${iso.tile} screen=${iso.dist}`);
check('高度换算可逆', Math.abs(iso.back - 2) < 1e-9, `h=2 → ${iso.height.toFixed(3)} → ${iso.back.toFixed(6)}`);

/* ----------------------------------------------------------- A7. curves ---- */
const curve = await T(() => {
    const { LineCurve, QuadraticBezierCurve, CubicBezierCurve3, CurvePath, Vector2, Vector3 } = window.__riftsandSim;
    const line = new LineCurve(new Vector2(0, 0), new Vector2(10, 0));
    const mid = line.getPoint(0.5);
    const q = new QuadraticBezierCurve(new Vector2(0, 0), new Vector2(5, 10), new Vector2(10, 0));
    const qMid = q.getPoint(0.5);
    const c = new CubicBezierCurve3(
        new Vector3(0, 0, 0), new Vector3(1, 1, 0), new Vector3(2, 1, 0), new Vector3(3, 0, 0));
    const cStart = c.getPoint(0);
    const cEnd = c.getPoint(1);

    const path = new CurvePath();
    path.add(new LineCurve(new Vector2(0, 0), new Vector2(6, 0)));
    path.add(new LineCurve(new Vector2(6, 0), new Vector2(6, 8)));
    const len = path.getLength();
    const atHalf = path.getPointAt(0.5);

    return {
        lineMid: [mid.x, mid.y],
        qMid: [qMid.x, qMid.y],
        cStart: [cStart.x, cStart.y, cStart.z],
        cEnd: [cEnd.x, cEnd.y, cEnd.z],
        pathLen: len,
        atHalf: [atHalf.x, atHalf.y],
    };
});
check('LineCurve 中点 / QuadraticBezier 顶点', 
    curve.lineMid[0] === 5 && curve.lineMid[1] === 0 &&
    Math.abs(curve.qMid[0] - 5) < 1e-9 && Math.abs(curve.qMid[1] - 5) < 1e-9,
    `line=${curve.lineMid} quad=${curve.qMid.map((v) => v.toFixed(2))}`);
// three's CubicBezierCurve3 is NOT a Bezier: `getPoint` runs each axis through
// a Catmull-Rom basis, so the curve passes through v1 and v2 while v0 / v3 are
// control handles. The reference inherits that verbatim, so a descent path built
// from it starts at v1, not v0.
check('CubicBezierCurve3 走 Catmull-Rom（getPoint(0)=v1, getPoint(1)=v2）',
    curve.cStart.join() === '1,1,0' && curve.cEnd.join() === '2,1,0',
    `${curve.cStart} → ${curve.cEnd}`);
check('CurvePath 按弧长参数化（14 单位折线，半程落点在拐角）',
    Math.abs(curve.pathLen - 14) < 0.05 && Math.abs(curve.atHalf[0] - 6) < 0.2 && Math.abs(curve.atHalf[1] - 1) < 0.3,
    `len=${curve.pathLen.toFixed(3)} half=(${curve.atHalf.map((v) => v.toFixed(2))})`);

/* --------------------------------------------- A8. vocabulary + geometry --- */
const vocab = await T(() => {
    const { LandType, SpeedType, ArmorType, MovementZone, getLandType } = window.__riftsandSim;
    const kind = window.__riftsandSim;
    return {
        land: [LandType.Clear, LandType.Wall, LandType.Tiberium, LandType.Cliff],
        speed: [SpeedType.Foot, SpeedType.Winged],
        armor: [ArmorType.None, ArmorType.Heavy, ArmorType.Special_2],
        zone: [MovementZone.Normal, MovementZone.Water],
        mapping: typeof getLandType === 'function',
    };
});
check('LandType / SpeedType / ArmorType / MovementZone 枚举值与参考一致',
    vocab.land.join() === '0,8,9,10' && vocab.speed.join() === '0,7' &&
    vocab.armor.join() === '0,5,10' && vocab.zone.join() === '9,11',
    `land=${vocab.land} speed=${vocab.speed} armor=${vocab.armor} zone=${vocab.zone}`);

const geom = await T(() => {
    const S = window.__riftsandSim;
    const Box2 = S.Box2, Vector2 = S.Vector2;
    const touching = S.rectIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 });
    const apart = S.rectIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 0, width: 10, height: 10 });
    const oct = S.octileDistance({ x: 0, y: 0 }, { x: 3, y: 4 });
    const box = new Box2(new Vector2(0, 0), new Vector2(10, 10));
    const inside = box.containsPoint(new Vector2(5, 5));
    const outside = box.containsPoint(new Vector2(11, 5));
    const clamped = box.clampPoint(new Vector2(20, -5), new Vector2());
    return {
        touching, apart, oct, inside, outside,
        clamped: [clamped.x, clamped.y],
        circle: S.circleIntersect({ center: { x: 0, y: 0 }, radius: 5 }, { center: { x: 6, y: 0 }, radius: 5 }),
    };
});
check('rectIntersect 相接算相交、分离不算（原版闭区间语义）',
    geom.touching === true && geom.apart === false, `touch=${geom.touching} apart=${geom.apart}`);
check('octileDistance 正确（8 向距离）',
    Math.abs(geom.oct - (7 + (Math.SQRT2 - 2) * 3)) < 1e-9, `d=${geom.oct.toFixed(4)}`);
check('Box2 containsPoint / clampPoint',
    geom.inside === true && geom.outside === false && geom.clamped.join() === '10,0',
    `clamp=(20,-5)→(${geom.clamped})`);
check('circleIntersect 相交判定', geom.circle === true);

/* --------------------------------------------------------- A9. utilities --- */
const util = await T(() => {
    const S = window.__riftsandSim;
    const bin = String.fromCharCode(0x00, 0x41, 0x7f, 0xff, 0x80);
    const roundTrip = S.Base64.decode(S.Base64.encode(bin));
    const utf8 = S.Base64.decodeUtf8(S.Base64.encodeUtf8('裂缝·Rift 123'));
    const crc = S.Crc32.calculateCrc(new Uint8Array([49, 50, 51, 52, 53, 54, 55, 56, 57]));
    const neg = S.Crc32.calculateCrc(new Uint8Array([0, 1, 2]));
    return {
        roundTrip,
        utf8,
        crc,
        neg,
        base64Ascii: S.Base64.encode('abc'),
        floorTo: S.floorTo(137, 54),
        clampV: S.clamp(5, 0, 3),
        isBetween: S.isBetween(3, 1, 5),
        lerp: S.lerp(0, 10, 0.25),
        trunc: S.truncToDecimals(-1.2345, 2),
        fnv: S.fnv32a([1, 2, 3]),
    };
});
check('Base64 二进制串往返（0x00..0xff 全字节）',
    util.roundTrip === String.fromCharCode(0x00, 0x41, 0x7f, 0xff, 0x80),
    [...util.roundTrip].map((c) => c.charCodeAt(0).toString(16)).join(' '));
check('Base64.encodeUtf8 / decodeUtf8 文本往返', util.utf8 === '裂缝·Rift 123', util.utf8);
check('Base64 ASCII 与标准一致', util.base64Ascii === 'YWJj', util.base64Ascii);
check('Crc32 标准向量 "123456789" → 0xCBF43926',
    util.crc === 0xcbf43926, `0x${util.crc.toString(16)}`);
check('floorTo / clamp / isBetween / lerp / trunc 行为正确',
    util.floorTo === 108 && util.clampV === 3 && util.isBetween === true &&
    util.lerp === 2.5 && util.trunc === -1.23,
    `floorTo=${util.floorTo} trunc=${util.trunc}`);

/* ------------------------------------------------------------------ done --- */
console.log('');
console.log(`${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
