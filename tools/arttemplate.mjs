/**
 * Generate blank, correctly-sized art templates.
 *
 * Every template is a PNG with the exact canvas the game expects, plus a grid so
 * an artist can see where each frame goes. Fill the cells, drop the files into
 * art/, and `tools/assetcheck.mjs` will confirm the layout.
 *
 *   node tools/arttemplate.mjs                 # writes art/templates/
 *   node tools/arttemplate.mjs out/dir
 *
 * The roster is read straight out of core/Core.ts so the templates can never
 * drift from the definition table.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const outDir = process.argv[2] || 'art/templates';
fs.mkdirSync(outDir, { recursive: true });

const corePath = 'project/assets/scripts/core/Core.ts';
const src = fs.readFileSync(corePath, 'utf8');

/** pull `id`, `kind` and `size` out of the UNITS / BUILDINGS tables */
function scanTable(startMarker) {
    const start = src.indexOf(startMarker);
    if (start < 0) return [];
    // the table ends at the first line that closes it at column 0
    const rest = src.slice(start);
    const end = rest.indexOf('\n};');
    const body = rest.slice(0, end < 0 ? rest.length : end);
    const out = [];
    const re = /\{\s*\n?\s*id:\s*'([a-zA-Z0-9_]+)'[\s\S]*?(?=\n    \}),/g;
    // split on entries: `    name: {` for buildings, `    name: U({` for units
    const entries = body.split(/\n    (?=[a-zA-Z0-9_]+:\s*(?:[UB]\(\{|\{))/);
    for (const e of entries) {
        const id = /id:\s*'([a-zA-Z0-9_]+)'/.exec(e);
        if (!id) continue;
        const kind = /kind:\s*'([a-z]+)'/.exec(e);
        const size = /size:\s*(\d)/.exec(e);
        out.push({ id: id[1], kind: kind ? kind[1] : null, size: size ? +size[1] : null });
    }
    void re;
    return out;
}

const units = scanTable('export const UNITS: Record<string, UnitDef> = {');
const buildings = scanTable('export const BUILDINGS: Record<string, BuildingDef> = {');

/* ---------------- minimal PNG writer ---------------- */

function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
        c ^= buf[i];
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
}

function writePng(file, w, h, pixel) {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 4 + 1)] = 0;
        for (let x = 0; x < w; x++) {
            const i = y * (w * 4 + 1) + 1 + x * 4;
            const c = pixel(x, y);
            raw[i] = c[0]; raw[i + 1] = c[1]; raw[i + 2] = c[2]; raw[i + 3] = c[3];
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
    fs.writeFileSync(file, png);
}

/** translucent template with frame grid + a faint diamond footprint */
function makeSheet(file, cols, rows, fw, fh, opts = {}) {
    const w = cols * fw;
    const h = rows * fh;
    writePng(file, w, h, (x, y) => {
        const cx = x % fw, cy = y % fh;
        const onGrid = cx === 0 || cy === 0 || cx === fw - 1 || cy === fh - 1;
        // cell centre cross
        const midX = Math.abs(cx - fw / 2) < 1;
        const midY = Math.abs(cy - fh / 2) < 1;
        if (opts.diamond) {
            // 2:1 diamond outline, the unit's actual footprint
            const hw = fw * 0.30, hh = fh * 0.15;
            const nx = (cx - fw / 2) / hw;
            const ny = (cy - fh / 2) / hh;
            const d = Math.abs(nx) + Math.abs(ny);
            if (d > 0.94 && d < 1.06) return [120, 200, 255, 150];
        }
        if (onGrid) return [90, 120, 150, 150];
        if (midX || midY) return [90, 120, 150, 70];
        return [0, 0, 0, 0];
    });
    return { w, h };
}

/* ---------------- generate ---------------- */

const made = [];
const noteLines = [];
noteLines.push('# 素材模板说明');
noteLines.push('');
noteLines.push('这些 PNG 只有格线与脚底菱形，用来对齐尺寸和帧位。画完把同名文件放进 `art/` 对应目录。');
noteLines.push('');

// units: 8 directions x (1 ready + 4 walk) minimum, 40 frames laid out 8 per row
for (const u of units) {
    if (!u.kind) continue;
    const inf = u.kind === 'infantry';
    const cols = 8;
    const rows = 5;                       // ready + 4 walk frames
    const fw = 72, fh = 72;
    const file = path.join(outDir, `unit_${u.id}.png`);
    const size = makeSheet(file, cols, rows, fw, fh, { diamond: true });
    made.push({ file, ...size, note: `单位 ${u.id}（${u.kind}）：行=序列，列=方向 0..7` });
    noteLines.push(`- \`unit_${u.id}.png\` ${size.w}×${size.h}｜${u.kind}｜行 0 = Ready，行 1–4 = Walk 1–4；列 = 方向 0..7`);

    if (!inf && u.kind !== 'air') {
        const tfile = path.join(outDir, `unit_${u.id}_turret.png`);
        const ts = makeSheet(tfile, 8, 1, fw, fh, { diamond: false });
        made.push({ file: tfile, ...ts, note: `炮塔 ${u.id}` });
    }
}

// buildings: 4 states stacked vertically
for (const b of buildings) {
    if (!b.size) continue;
    const size = b.size;
    const frame = size <= 1 ? 64 : size === 2 ? 96 : size === 3 ? 128 : 160;
    const file = path.join(outDir, `building_${b.id}.png`);
    const s = makeSheet(file, 1, 4, frame, frame);
    made.push({ file, ...s, note: `建筑 ${b.id}（${size}x${size}）` });
    noteLines.push(`- \`building_${b.id}.png\` ${s.w}×${s.h}｜${size}×${size} 格｜4 行 = normal / damaged / ruined / buildup`);
}

// terrain tile sheet: 8 tiles in a row
{
    const file = path.join(outDir, 'terrain_tiles.png');
    const s = makeSheet(file, 8, 1, 56, 28);
    made.push({ file, ...s, note: '地形瓦片 56x28 x8' });
    noteLines.push(`- \`terrain_tiles.png\` ${s.w}×${s.h}｜瓦片 56×28 ×8（沙地 0-3 / 沙丘 4-5 / 岩石 6-7）`);
}

// effects: one row per effect
for (const [name, frames, w, h] of [['explosion', 8, 128, 128], ['small_explosion', 6, 64, 64],
    ['smoke', 6, 64, 64], ['debris', 4, 16, 16], ['muzzle', 3, 24, 24]]) {
    const file = path.join(outDir, `fx_${name}.png`);
    const s = makeSheet(file, frames, 1, w, h);
    made.push({ file, ...s, note: `特效 ${name}` });
    noteLines.push(`- \`fx_${name}.png\` ${s.w}×${s.h}｜${frames} 帧 × ${w}×${h}`);
}

fs.writeFileSync(path.join(outDir, 'README.md'), noteLines.join('\n') + '\n');

console.log(`生成 ${made.length} 个模板 → ${outDir}`);
console.log(`单位 ${units.filter((u) => u.kind).length} 个 · 建筑 ${buildings.filter((b) => b.size).length} 个`);
for (const m of made.slice(0, 6)) console.log(`  ${path.basename(m.file)}  ${m.w}x${m.h}  ${m.note}`);
console.log('  …');
