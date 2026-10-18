/**
 * Starter-map generator.
 *
 * Hand-designing 6400 cells in a text editor is not how anyone makes a map.
 * The workflow this enables is:
 *
 *   1. `node tools/mapgen.mjs`      → writes assets/maps/*.json from shapes
 *   2. open tools/mapeditor.html     → paint on top of them, export back to JSON
 *   3. `node tools/mapbuild.mjs`     → validates + bundles into world/Maps.ts
 *
 * The shapes below are the same vocabulary a level designer uses in a real
 * editor (ridge, lake, plateau, road, ore field, base), so the generated file is
 * a usable starting point rather than noise.
 *
 * usage: node tools/mapgen.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const N = 80;
const LAND = { clear: 0, rough: 1, road: 2, ore: 3, water: 4, rock: 5 };

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
const idx = (x, y) => y * N + x;

function blank() {
    return {
        land: new Uint8Array(N * N),
        height: new Uint8Array(N * N),
        tile: new Uint16Array(N * N),
    };
}

/** deterministic hash so a map always looks the same */
function hash(x, y, s = 0) {
    let h = (x * 374761393 + y * 668265263 + s * 1442695040) >>> 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function fill(m, x0, y0, x1, y1, land, height = null) {
    for (let y = Math.max(0, y0); y <= Math.min(N - 1, y1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(N - 1, x1); x++) {
            m.land[idx(x, y)] = land;
            if (height !== null) m.height[idx(x, y)] = height;
        }
    }
}

/** an oval blob: lake / plateau / ore field */
function blob(m, cx, cy, rx, ry, land, height = null) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            if (x < 0 || y < 0 || x >= N || y >= N) continue;
            const dx = (x - cx) / rx;
            const dy = (y - cy) / ry;
            if (dx * dx + dy * dy > 1) continue;
            m.land[idx(x, y)] = land;
            if (height !== null) m.height[idx(x, y)] = height;
        }
    }
}

/** a thick line of rock: the chokepoint tool */
function ridge(m, x0, y0, x1, y1, w, land = LAND.rock) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    const r = w / 2;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cx = x0 + (x1 - x0) * t;
        const cy = y0 + (y1 - y0) * t;
        for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
            for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
                if (x < 0 || y < 0 || x >= N || y >= N) continue;
                if (Math.hypot(x - cx, y - cy) > r) continue;
                m.land[idx(x, y)] = land;
            }
        }
    }
}

/** an annulus: disc minus inner disc (rings, loop roads) */
function ring(m, cx, cy, rOuter, rInner, land, height = null) {
    for (let y = Math.floor(cy - rOuter); y <= Math.ceil(cy + rOuter); y++) {
        for (let x = Math.floor(cx - rOuter); x <= Math.ceil(cx + rOuter); x++) {
            if (x < 0 || y < 0 || x >= N || y >= N) continue;
            const outer = Math.hypot(x - cx, y - cy);
            if (outer > rOuter || outer <= rInner) continue;
            m.land[idx(x, y)] = land;
            if (height !== null) m.height[idx(x, y)] = height;
        }
    }
}

/** flat, clear bowl for a base: buildings + trucks need this much room */
function baseBowl(m, cx, cy, r = 9) {
    blob(m, cx, cy, r, r, LAND.clear, 0);
    // a little rough ground on the far side gives the base silhouette an edge
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
        const x = Math.round(cx + Math.cos(a) * (r + 1.5));
        const y = Math.round(cy + Math.sin(a) * (r + 1.5));
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        if (m.land[idx(x, y)] === LAND.clear && hash(x, y, 7) > 0.55) m.land[idx(x, y)] = LAND.rough;
    }
}

/** mirror the left half onto the right so both sides get the same ground */
function mirror(m) {
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N / 2; x++) {
            const src = idx(x, y);
            const dst = idx(N - 1 - x, N - 1 - y);
            m.land[dst] = m.land[src];
            m.height[dst] = m.height[src];
        }
    }
}

/** visual tile ids: 4 variants per land type, stable per cell */
function paintTiles(m) {
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const i = idx(x, y);
            const l = m.land[i];
            m.tile[i] = l * 4 + Math.floor(hash(x, y, 31) * 4);
        }
    }
}

function rle(arr) {
    const data = [];
    let cur = arr[0], run = 0;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] === cur) { run++; continue; }
        data.push(cur, run);
        cur = arr[i]; run = 1;
    }
    data.push(cur, run);
    return { enc: 'rle', n: arr.length, data };
}

/** connectivity check on the finished map, so a broken layout never ships */
function check(name, m, spawns, ore) {
    const passable = (i) => m.land[i] !== LAND.rock && m.land[i] !== LAND.water;
    const seen = new Uint8Array(N * N);
    const st = [idx(spawns[0].tx, spawns[0].ty)];
    seen[st[0]] = 1;
    while (st.length) {
        const c = st.pop();
        const cx = c % N, cy = (c / N) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            const nid = idx(nx, ny);
            if (seen[nid] || !passable(nid)) continue;
            if (dx && dy && (!passable(idx(cx + dx, cy)) || !passable(idx(cx, cy + dy)))) continue;
            seen[nid] = 1; st.push(nid);
        }
    }
    const problems = [];
    for (const s of spawns) {
        if (!passable(idx(s.tx, s.ty))) problems.push(`spawn ${s.player} is on blocked land`);
    }
    const other = spawns[1];
    if (!seen[idx(other.tx, other.ty)]) problems.push('spawns are not connected');
    for (const o of ore) {
        if (!seen[idx(o.tx, o.ty)]) problems.push(`ore ${o.tx},${o.ty} is not reachable`);
    }
    if (problems.length) throw new Error(`${name}: ${problems.join('; ')}`);
    return seen;
}

/* ------------------------------------------------------------------ */
/* 0. FLAT — the temporary test plane                                   */
/* ------------------------------------------------------------------ */
function flat() {
    const m = blank();
    /*
     * A completely empty 80x80 plane: no rock, no water, no height.
     *
     * This is the temporary battlefield while the real maps are being authored:
     * it isolates unit/art/AI behaviour from terrain, so "the tank cannot get
     * there" or "the truck is stuck" can only ever be a unit bug.
     */
    const ore = [
        { tx: 28, ty: 36, amount: 4000 },
        { tx: 28, ty: 44, amount: 4000 },
        { tx: 40, ty: 40, amount: 6000 },
        { tx: 51, ty: 36, amount: 4000 },
        { tx: 51, ty: 44, amount: 4000 },
    ];
    // same base positions the old default map used, so the camera starts where
    // the input tests (and the player) expect it to
    const spawns = [{ tx: 18, ty: 40, player: 0 }, { tx: 61, ty: 39, player: 1 }];
    paintTiles(m);
    check('flat', m, spawns, ore);
    return { m, ore, spawns };
}
function twinGates() {
    const m = blank();
    // a rock belt splitting north from south, with two 6-wide gates
    ridge(m, 6, 26, 34, 26, 7);
    ridge(m, 6, 54, 34, 54, 7);
    // gates
    blob(m, 24, 26, 3.5, 3.5, LAND.clear, 0);
    blob(m, 24, 54, 3.5, 3.5, LAND.clear, 0);
    // centre plateau, reachable from both gates by a ramp ring
    blob(m, 40, 40, 11, 11, LAND.rough, 1);
    blob(m, 40, 40, 8, 8, LAND.rough, 2);
    // sand ramps cut into the plateau on the four cardinals
    blob(m, 40, 28, 3, 4, LAND.clear, 0);
    blob(m, 40, 52, 3, 4, LAND.clear, 0);
    blob(m, 27, 40, 4, 3, LAND.clear, 0);
    blob(m, 53, 40, 4, 3, LAND.clear, 0);
    // base bowls in the two outer corners
    baseBowl(m, 13, 40, 9);
    baseBowl(m, 66, 39, 9);
    // a road linking base -> gate so columns have a fast lane
    ridge(m, 14, 40, 24, 26, 3, LAND.road);
    ridge(m, 14, 40, 24, 54, 3, LAND.road);
    mirror(m);
    paintTiles(m);

    const ore = [
        { tx: 18, ty: 36, amount: 4200 },
        { tx: 18, ty: 44, amount: 3600 },
        { tx: 34, ty: 33, amount: 5200 },
        { tx: 34, ty: 47, amount: 5200 },
        { tx: 40, ty: 40, amount: 7000 },
        // the outer lanes are why the two gates exist — without a reason to go
        // through them the ridges were decorative
        { tx: 26, ty: 19, amount: 3200 },
        { tx: 53, ty: 60, amount: 3200 },
        { tx: 26, ty: 60, amount: 3200 },
        { tx: 53, ty: 19, amount: 3200 },
    ];
    const spawns = [{ tx: 12, ty: 40, player: 0 }, { tx: 67, ty: 39, player: 1 }];
    check('twin-gates', m, spawns, ore);
    return { m, ore, spawns };
}

/* ------------------------------------------------------------------ */
/* 2. RING LAKE — central water forces everyone onto a ring road        */
/* ------------------------------------------------------------------ */
function ringLake() {
    const m = blank();
    /*
     * Draw order matters: the ring road has to survive the rock rim, and the
     * lake has to survive everything. (First attempt painted a filled disc for
     * the road and then cleared a 26-radius disc on top of the water — the lake
     * vanished and the map shipped with zero water. The validator in
     * tools/mapbuild.mjs now checks the land mix for exactly this.)
     */
    ring(m, 40, 40, 24, 22, LAND.road, 0);      // loop road around the basin
    blob(m, 40, 40, 17, 15, LAND.rock, 0);      // rocky rim
    blob(m, 40, 40, 13, 11, LAND.water, 0);     // the lake itself
    /*
     * Two beaches where the loop road crosses the rim. They are drawn as full
     * crossing bands and then the lake is re-stamped on top — painting them after
     * the water put two 8-wide roads straight across the lake and turned it into
     * a dirt cross (caught by looking at the in-game screenshot, not by the
     * validator: the land mix was still legal).
     */
    blob(m, 40, 40, 24, 4, LAND.road, 0);
    blob(m, 40, 40, 4, 24, LAND.road, 0);
    blob(m, 40, 40, 12.5, 10.5, LAND.water, 0);
    // dune shoulders north and south of the ring
    blob(m, 40, 14, 10, 5, LAND.rough, 1);
    blob(m, 40, 66, 10, 5, LAND.rough, 1);
    baseBowl(m, 13, 40, 9);
    baseBowl(m, 66, 39, 9);
    mirror(m);
    paintTiles(m);

    const ore = [
        { tx: 18, ty: 33, amount: 4600 },
        { tx: 18, ty: 47, amount: 4600 },
        { tx: 40, ty: 22, amount: 6200 },
        { tx: 40, ty: 58, amount: 6200 },
        { tx: 27, ty: 40, amount: 3800 },
        { tx: 53, ty: 40, amount: 3800 },
    ];
    const spawns = [{ tx: 12, ty: 40, player: 0 }, { tx: 67, ty: 39, player: 1 }];
    check('ring-lake', m, spawns, ore);
    return { m, ore, spawns };
}

/* ------------------------------------------------------------------ */
/* 3. MESA — one big defensible plateau with three ramps                */
/* ------------------------------------------------------------------ */
function mesa() {
    const m = blank();
    blob(m, 40, 40, 17, 15, LAND.rough, 2);
    blob(m, 40, 40, 13, 11, LAND.rough, 3);
    // three ramps: west (main), north, south-east
    blob(m, 26, 40, 5, 4, LAND.clear, 1);
    blob(m, 40, 26, 4, 5, LAND.clear, 1);
    blob(m, 50, 52, 4, 4, LAND.clear, 1);
    // rock skirt so the plateau is not simply walk-around-able everywhere
    ridge(m, 8, 16, 30, 16, 6);
    ridge(m, 8, 64, 30, 64, 6);
    baseBowl(m, 13, 40, 10);
    baseBowl(m, 66, 39, 10);
    ridge(m, 15, 40, 26, 40, 3, LAND.road);
    mirror(m);
    paintTiles(m);

    const ore = [
        { tx: 17, ty: 34, amount: 4400 },
        { tx: 17, ty: 46, amount: 4400 },
        { tx: 40, ty: 40, amount: 9000 },
        { tx: 33, ty: 40, amount: 4000 },
    ];
    const spawns = [{ tx: 12, ty: 40, player: 0 }, { tx: 67, ty: 39, player: 1 }];
    check('mesa', m, spawns, ore);
    return { m, ore, spawns };
}

/* ------------------------------------------------------------------ */
/* emit                                                                */
/* ------------------------------------------------------------------ */
const MAPS = [
    { id: 'flat', name: '测试平面', en: 'FLAT TEST', theater: 'desert', note: '纯平面测试场，等真实地图做好后替换', gen: flat },
    { id: 'twin-gates', name: '双峡口', en: 'TWIN GATES', theater: 'desert', note: '南北岩脊把战场切成三条路', gen: twinGates },
    { id: 'ring-lake', name: '环湖', en: 'RING LAKE', theater: 'desert', note: '中央水域逼出环形绕行', gen: ringLake },
    { id: 'mesa', name: '台地', en: 'MESA', theater: 'desert', note: '中央高地三条坡道，居高临下', gen: mesa },
];

mkdirSync('assets/maps', { recursive: true });
for (const def of MAPS) {
    const { m, ore, spawns } = def.gen();
    const doc = {
        format: 1,
        id: def.id,
        name: def.name,
        en: def.en,
        theater: def.theater,
        note: def.note,
        size: N,
        land: rle(m.land),
        height: rle(m.height),
        tiles: rle(m.tile),
        ore,
        spawns,
    };
    const path = `assets/maps/${def.id}.json`;
    writeFileSync(path, JSON.stringify(doc));
    console.log(`wrote ${path}  (${(JSON.stringify(doc).length / 1024).toFixed(1)} KB)`);
}
