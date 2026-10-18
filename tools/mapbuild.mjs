/**
 * Map compiler.
 *
 *   assets/maps/*.json  →  project/assets/scripts/world/Maps.ts
 *
 * Why a build step instead of loading JSON at runtime: Cocos treats a .json file
 * in `assets/` as a JsonAsset (an async resource), not as a plain module. Level
 * data must be available synchronously when a match starts, and it is content
 * that changes rarely, so it is compiled into a TS module. The JSON stays the
 * single source of truth — the editor writes JSON, this script bundles it.
 *
 * Validation runs here, not only in the engine, so a broken map fails the build
 * instead of shipping. Checks:
 *   - structural (size, packed lengths, land ids, height range)
 *   - spawns on walkable ground, not against the rim
 *   - spawn-to-spawn connectivity with the same 8-way + no-corner-cut rule the
 *     pathfinder uses
 *   - every ore field reachable from BOTH spawns (an unreachable field is a
 *     map that cannot be won)
 *
 * usage: node tools/mapbuild.mjs
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const N = 80;
const SRC = 'assets/maps';
const OUT = 'project/assets/scripts/world/Maps.ts';
const LAND = { clear: 0, rough: 1, road: 2, ore: 3, water: 4, rock: 5 };
const LAND_NAMES = { 0: 'clear', 1: 'rough', 2: 'road', 3: 'ore', 4: 'water', 5: 'rock' };

function unpack(p, len) {
    const out = new Uint8Array(len);
    let at = 0;
    for (let i = 0; i < p.data.length; i += 2) {
        const v = p.data[i], n = p.data[i + 1];
        for (let k = 0; k < n; k++) {
            if (at >= len) break;
            out[at++] = v;
        }
    }
    if (at !== len) throw new Error(`pack decoded ${at} cells, expected ${len}`);
    return out;
}

function floodFrom(land, tx, ty) {
    const ok = (i) => land[i] !== LAND.rock && land[i] !== LAND.water;
    const seen = new Uint8Array(N * N);
    const start = ty * N + tx;
    if (!ok(start)) return seen;
    const st = [start];
    seen[start] = 1;
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (st.length) {
        const c = st.pop();
        const cx = c % N, cy = (c / N) | 0;
        for (const [dx, dy] of DIRS) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            const nid = ny * N + nx;
            if (seen[nid] || !ok(nid)) continue;
            if (dx && dy && (!ok(cy * N + nx) || !ok(ny * N + cx))) continue;
            seen[nid] = 1;
            st.push(nid);
        }
    }
    return seen;
}

function validate(doc, file) {
    const e = [];
    if (doc.format !== 1) e.push(`format ${doc.format} != 1`);
    if (doc.size !== N) e.push(`size ${doc.size} != ${N}`);
    if (!doc.id || !doc.name) e.push('missing id/name');
    const cells = doc.size * doc.size;
    const land = unpack(doc.land, cells);
    const height = doc.height ? unpack(doc.height, cells) : new Uint8Array(cells);
    const tiles = doc.tiles ? unpack(doc.tiles, cells) : new Uint16Array(cells);

    for (let i = 0; i < cells; i++) {
        if (land[i] > LAND.rock) { e.push(`land[${i}]=${land[i]} invalid`); break; }
        if (height[i] > 3) { e.push(`height[${i}]=${height[i]} > 3`); break; }
    }

    const spawns = doc.spawns ?? [];
    if (spawns.length < 2) e.push('need two spawns');
    for (const s of spawns) {
        if (s.tx < 3 || s.ty < 3 || s.tx > N - 4 || s.ty > N - 4) e.push(`spawn ${s.player} too close to the rim`);
        const l = land[s.ty * N + s.tx];
        if (l === LAND.rock || l === LAND.water) e.push(`spawn ${s.player} on ${LAND_NAMES[l]}`);
    }

    if (spawns.length >= 2) {
        const a = floodFrom(land, spawns[0].tx, spawns[0].ty);
        const b = floodFrom(land, spawns[1].tx, spawns[1].ty);
        if (!a[spawns[1].ty * N + spawns[1].tx]) e.push('spawns are not connected');
        for (const o of doc.ore ?? []) {
            const i = o.ty * N + o.tx;
            // ore cells themselves are walkable, but their field may be ringed
            if (!a[i]) e.push(`ore ${o.tx},${o.ty} unreachable from spawn 0`);
            else if (!b[i]) e.push(`ore ${o.tx},${o.ty} unreachable from spawn 1`);
        }
        // a base needs a flat 7-radius apron or structures cannot be placed
        for (const s of spawns) {
            let blocked = 0;
            for (let y = s.ty - 7; y <= s.ty + 7; y++) {
                for (let x = s.tx - 7; x <= s.tx + 7; x++) {
                    if (x < 0 || y < 0 || x >= N || y >= N) { blocked++; continue; }
                    const l = land[y * N + x];
                    if (l === LAND.rock || l === LAND.water) blocked++;
                }
            }
            if (blocked > 0) e.push(`base apron of spawn ${s.player} has ${blocked} blocked cells`);
            if (height[s.ty * N + s.tx] !== 0) e.push(`spawn ${s.player} is not on level ground`);
        }
    }

    if (!doc.ore || !doc.ore.length) e.push('no ore');
    let playable = 0;
    for (let i = 0; i < cells; i++) if (land[i] !== LAND.rock && land[i] !== LAND.water) playable++;
    if (playable < cells * 0.25) e.push('less than 25% driveable');

    return { errors: e, land, height, tiles };
}

/* ---------------- compile ---------------- */
mkdirSync('project/assets/scripts/world', { recursive: true });
const files = readdirSync(SRC).filter((f) => f.endsWith('.json')).sort();
let failed = 0;
const docs = [];

for (const f of files) {
    const doc = JSON.parse(readFileSync(join(SRC, f), 'utf8'));
    const { errors } = validate(doc, f);
    if (errors.length) {
        failed++;
        console.error(`FAIL ${f}`);
        for (const err of errors.slice(0, 8)) console.error('     ' + err);
    } else {
        const ore = doc.ore.reduce((s, o) => s + o.amount, 0);
        console.log(`ok   ${f}  ore=${ore}  spawns=${doc.spawns.length}`);
    }
    docs.push(doc);
}
if (failed) {
    console.error(`\n${failed} map(s) rejected — nothing written`);
    process.exit(1);
}

const banner = `/**
 * GENERATED FILE — do not edit.
 *
 * Source: assets/maps/*.json   Compiler: tools/mapbuild.mjs
 * Edit the JSON (or paint in tools/mapeditor.html and export), then re-run
 * \`node tools/mapbuild.mjs\`.
 */
import type { MapData } from './MapData';

`;
const entries = docs.map((d) => `    '${d.id}': ${JSON.stringify(d)},`).join('\n');
const body = `export const AUTHORED: Record<string, MapData> = {\n${entries}\n};\n\nexport const AUTHORED_IDS: string[] = [${docs.map((d) => `'${d.id}'`).join(', ')}];\n`;
writeFileSync(OUT, banner + body);
console.log(`\nwrote ${OUT}  (${(body.length / 1024).toFixed(1)} KB, ${docs.length} maps)`);
