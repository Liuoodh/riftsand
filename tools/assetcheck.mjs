/**
 * Asset manifest checker.
 *
 * Validates that a manifest points at images that exist and that the frame layout
 * adds up, so an artist finds out about a wrong canvas size here instead of
 * wondering why a unit renders blank in the game.
 *
 *   node tools/assetcheck.mjs                # check art/manifest.example.json
 *   node tools/assetcheck.mjs art            # check art/manifest.json
 *   node tools/assetcheck.mjs path/to/manifest.json
 *
 * No dependencies: PNG/JPG headers are parsed directly.
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = process.argv[2] || 'art';
const manifestPath = arg.endsWith('.json')
    ? arg
    : fs.existsSync(path.join(arg, 'manifest.json'))
        ? path.join(arg, 'manifest.json')
        : path.join(arg, 'manifest.example.json');

if (!fs.existsSync(manifestPath)) {
    console.error(`找不到 manifest: ${manifestPath}`);
    process.exit(2);
}

const root = path.resolve(path.dirname(manifestPath), '..');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

let errors = 0;
let warnings = 0;
let checked = 0;
const missing = [];

const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => { errors++; console.log(`  FAIL  ${msg}`); };
const warn = (msg) => { warnings++; console.log(`  warn  ${msg}`); };

/** read width/height out of a PNG or JPEG header */
function imageSize(file) {
    const buf = fs.readFileSync(file);
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
        return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png' };
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
        let i = 2;
        while (i < buf.length) {
            if (buf[i] !== 0xff) { i++; continue; }
            const marker = buf[i + 1];
            const len = buf.readUInt16BE(i + 2);
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), type: 'jpg' };
            }
            i += 2 + len;
        }
    }
    return null;
}

function resolveImage(p) {
    const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
    if (fs.existsSync(abs)) return abs;
    const alt = path.resolve(path.dirname(manifestPath), '..', p);
    return fs.existsSync(alt) ? alt : null;
}

function checkImage(label, rel, frame, needFrames) {
    checked++;
    const abs = resolveImage(rel);
    if (!abs) {
        bad(`${label}: 图片不存在 ${rel}`);
        missing.push(rel);
        return;
    }
    const size = imageSize(abs);
    if (!size) { bad(`${label}: 无法识别图片格式（要 PNG 或 JPG）`); return; }
    const fw = frame.w, fh = frame.h;
    const cols = Math.floor(size.w / fw);
    const rows = Math.floor(size.h / fh);
    const frames = cols * rows;
    if (size.w % fw !== 0 || size.h % fh !== 0) {
        bad(`${label}: 画布 ${size.w}x${size.h} 不是 ${fw}x${fh} 的整数倍（会切出半帧）`);
    }
    if (needFrames > frames) {
        bad(`${label}: 需要 ${needFrames} 帧，图集只有 ${frames} 帧（${cols}x${rows}）`);
    } else {
        ok(`${label}: ${size.w}x${size.h} → ${cols}x${rows} = ${frames} 帧，需要 ${needFrames}`);
    }
    if (size.type !== 'png') warn(`${label}: 建议用 PNG（当前 ${size.type}），JPG 没有 alpha`);
    if (fw !== 72 && label.startsWith('unit')) warn(`${label}: 单位单帧标准是 72x72，当前 ${fw}x${fh}`);
    if (fw % 2 || fh % 2) warn(`${label}: 单帧宽高应为偶数，锚点才能落在像素中心`);
}

console.log(`\nmanifest: ${manifestPath}\n`);

/* ---------------- units ---------------- */
for (const [id, u] of Object.entries(manifest.units || {})) {
    const facings = u.facings || 8;
    let maxFrame = 0;
    for (const [name, seq] of Object.entries(u.sequences || {})) {
        // `frames` is the TOTAL image count for the sequence (facings x anim frames)
        const end = (seq.start || 0) + (seq.frames || 0);
        maxFrame = Math.max(maxFrame, end);
        if (seq.frames % facings !== 0 && seq.frames !== 1) {
            warn(`unit ${id}.${name}: frames=${seq.frames} 不能被方向数 ${facings} 整除`);
        }
        if (!seq.rate && name !== 'ready') warn(`unit ${id}.${name}: rate=0，这一序列不会播放`);
    }
    checkImage(`unit ${id}`, u.image, u.frame || { w: 72, h: 72 }, maxFrame);
    if (u.turret) {
        checkImage(`unit ${id} turret`, u.turret.image, u.turret.frame || { w: 72, h: 72 },
            (u.turret.frames || 8) + (u.turret.start || 0));
    }
}

/* ---------------- buildings ---------------- */
for (const [id, b] of Object.entries(manifest.buildings || {})) {
    const states = b.states || {};
    const need = Math.max(0, ...Object.values(states).map((v) => v + 1));
    checkImage(`building ${id}`, b.image, b.frame || { w: 96, h: 96 }, need);
    for (const s of ['normal', 'damaged', 'ruined']) {
        if (states[s] === undefined) warn(`building ${id}: 缺少 ${s} 状态（会回落到 normal）`);
    }
}

/* ---------------- tiles ---------------- */
if (manifest.tiles) {
    const t = manifest.tiles;
    const maxVariant = Math.max(0, ...Object.values(t.variants || {}).flat().map((v) => v + 1));
    checkImage('tiles', t.image, t.frame || { w: 56, h: 28 }, maxVariant);
    if ((t.frame?.w || 56) !== 56) warn(`tiles: 建议 56x28（当前 ${t.frame?.w}x${t.frame?.h}）`);
}

/* ---------------- summary ---------------- */
const unitCount = Object.keys(manifest.units || {}).length;
const bldCount = Object.keys(manifest.buildings || {}).length;
console.log(`\n检查 ${checked} 张图 · 单位 ${unitCount} · 建筑 ${bldCount}`);
if (missing.length) {
    console.log('\n缺少的文件：');
    for (const m of missing) console.log('  - ' + m);
}
console.log(`\n${errors === 0 ? '通过' : '有问题'}：${errors} 个错误，${warnings} 个提醒`);
process.exit(errors === 0 ? 0 : 1);
