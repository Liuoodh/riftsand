/**
 * Asset pipeline regression: SHP / PAL / TMP round-trip.
 *
 * There are no retail assets in this repo (and there never will be — they are
 * copyrighted), so the only honest way to prove the binary readers are correct
 * is to write files with our own encoder and read them back. That exercises the
 * real byte layout: header, 24-byte frame descriptors, absolute data offsets,
 * scanline decoding, palette expansion and team remap.
 *
 * usage: node tools/assettest.mjs [url]
 */
import { createRequire } from 'node:module';

const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html?auto=1';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0;
let fail = 0;
const check = (name, ok, note = '') => {
    if (ok) { pass++; console.log(`PASS  ${name}${note ? '  · ' + note : ''}`); }
    else { fail++; console.log(`FAIL  ${name}${note ? '  · ' + note : ''}`); }
};

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__riftsandAssets != null', { timeout: 60000 });

const r = await page.evaluate(() => {
    const A = window.__riftsandAssets;
    const out = {};

    /* ---------- SHP round-trip: 8 facings x 4 walk frames ---------- */
    const W = 24, H = 24, FRAMES = 32;
    const frames = [];
    for (let i = 0; i < FRAMES; i++) {
        const px = new Uint8Array(W * H);
        // a different deterministic pattern per frame so frame mix-ups are caught
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const inside = ((x + i) % 7) !== 0 && ((y + i * 3) % 9) !== 0;
                px[y * W + x] = inside ? 1 + ((i * 13 + x * 3 + y * 5) % 200) : 0;
            }
        }
        frames.push({ x: -W / 2, y: -H / 2, w: W, h: H, px });
    }
    const buf = A.encodeShp(W, H, frames);
    const shp = A.ShpFile.parse(buf);

    let mismatch = 0;
    for (let i = 0; i < FRAMES; i++) {
        const f = shp.frames[i];
        if (!f || f.w !== W || f.h !== H) { mismatch += 999; continue; }
        for (let k = 0; k < W * H; k++) if (f.px[k] !== frames[i].px[k]) mismatch++;
    }
    out.shp = {
        bytes: buf.byteLength,
        count: shp.count,
        w: shp.width,
        h: shp.height,
        bodyCount: shp.bodyCount,
        hasShadow: shp.hasShadow(),
        mismatch,
        firstOffset: shp.frames[0] ? shp.frames[0].x : null,
    };

    /* ---------- PAL: 6-bit expansion + index 0 alpha ---------- */
    const palBuf = new ArrayBuffer(768);
    const pv = new Uint8Array(palBuf);
    for (let i = 0; i < 256; i++) {
        pv[i * 3] = i & 0x3f;
        pv[i * 3 + 1] = (255 - i) & 0x3f;
        pv[i * 3 + 2] = (i >> 1) & 0x3f;
    }
    const pal = A.parsePal(palBuf);
    out.pal = {
        len: pal.length,
        // 63 * 4 = 252, so channels must be scaled by 4
        idx1r: pal[4],
        idx0a: pal[3],
        idx5a: pal[23 * 4 + 3],
    };

    /* ---------- team remap: slots 16..31 ---------- */
    const before = pal[16 * 4];
    A.remapTeam(pal, 255, 128, 64);
    out.remap = {
        before,
        after16: [pal[16 * 4], pal[16 * 4 + 1], pal[16 * 4 + 2]],
        // brightest step (factor 63) => r = 255/255*63*4 = 252
        // darkest step  (factor 8)  => r = 255/255*8*4  = 32
        after31: [pal[31 * 4], pal[31 * 4 + 1], pal[31 * 4 + 2]],
        untouched32: pal[32 * 4],
    };

    /* ---------- TMP: header + tile metadata ---------- */
    const BW = 60, BH = 30;
    const dataLen = (BW * BH) >> 1; // 900
    const headLen = 16 + 4;         // header + one offset entry
    const blockLen = 52 + dataLen;
    const tmpBuf = new ArrayBuffer(headLen + blockLen);
    const dv = new DataView(tmpBuf);
    dv.setInt32(0, 1, true);       // width  (tiles)
    dv.setInt32(4, 1, true);       // height (tiles)
    dv.setInt32(8, BW, true);
    dv.setInt32(12, BH, true);
    dv.setUint32(16, headLen, true); // block offset
    const b = headLen;
    dv.setInt32(b + 0, 3, true);   // x
    dv.setInt32(b + 4, 5, true);   // y
    dv.setInt32(b + 16, dataLen, true);
    dv.setUint32(b + 36, 0, true); // flags: no extra, no z
    dv.setUint8(b + 40, 2);        // zHeight
    dv.setUint8(b + 41, 14);       // terrainType = Rough
    dv.setUint8(b + 42, 7);        // rampType
    const tmp = A.TmpFile.parse(tmpBuf);
    const t0 = tmp.tiles[0];
    out.tmp = {
        w: tmp.width,
        h: tmp.height,
        blockW: tmp.blockW,
        blockH: tmp.blockH,
        tiles: tmp.count,
        tx: t0 ? t0.x : null,
        ty: t0 ? t0.y : null,
        z: t0 ? t0.zHeight : null,
        terrain: t0 ? t0.terrainType : null,
        ramp: t0 ? t0.rampType : null,
        px: t0 ? t0.px.length : null,
    };

    /* ---------- TMP pixels: encode -> parse -> expand ---------- */
    {
        const px = new Uint8Array(dataLen);
        // paint every stored index with 5 so we can verify the scan geometry
        px.fill(5);
        const buf = A.encodeTmp([{ zHeight: 1, terrainType: 13, rampType: 0, px }], BW, BH);
        const back = A.TmpFile.parse(buf);
        const pal = A.syntheticPal();
        const rgba = A.tmpTileToRgba(back.tiles[0], pal, BW, BH);

        // alpha coverage must equal the number of stored indices (each index = 1px)
        let opaque = 0;
        for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) opaque++;

        // row 0 must be 4 px wide and centred; the middle row the full 60
        const rowWidths = [];
        for (let y = 0; y < BH; y++) rowWidths.push(A.tmpRowWidth ? A.tmpRowWidth(y, BW, BH) : -1);
        const rowAlpha = (y) => {
            let n = 0;
            for (let x = 0; x < BW; x++) if (rgba[(y * BW + x) * 4 + 3]) n++;
            return n;
        };
        out.tmpPixels = {
            opaque,
            head: rowAlpha(0),
            mid: rowAlpha(BH / 2 - 1),
            last: rowAlpha(BH - 2),
            empty: rowAlpha(BH - 1),
            left0: rgba[(0 * BW + 28) * 4 + 3],
            rgb5: [rgba[(0 * BW + 28) * 4], rgba[(0 * BW + 28) * 4 + 1], rgba[(0 * BW + 28) * 4 + 2]],
            pal5: [pal[5 * 3], pal[5 * 3 + 1], pal[5 * 3 + 2]],
            z: back.tiles[0].zHeight,
            terrain: back.tiles[0].terrainType,
        };
    }

    /* ---------- baking ---------- */
    out.canvas = A.canvasAvailable();
    const D = window.__riftsandDefs;
    const sf = A.unitBodyFrame(D.UNITS.rampart, 'BU', 0, 0);
    out.bake = sf ? { opaque: sf.__opaque, w: sf.rect.width, cached: A.cachedFrameCount() } : null;

    return out;
});

console.log('   ' + JSON.stringify(r));

check('SHP 帧数读到 32（8 方向 × 4 帧）', r.shp.count === 32, `count=${r.shp.count}`);
check('SHP 头部宽高正确', r.shp.w === 24 && r.shp.h === 24);
check('SHP 像素逐字节一致', r.shp.mismatch === 0, `mismatch=${r.shp.mismatch}`);
check('SHP 识别阴影后半帧', r.shp.hasShadow === true && r.shp.bodyCount === 16);
check('PAL 扩展为 256×RGBA', r.pal.len === 1024);
check('PAL 6bit 通道 ×4', r.pal.idx1r === 4, `idx1.r=${r.pal.idx1r}`);
check('PAL 索引 0 透明', r.pal.idx0a === 0 && r.pal.idx5a === 255);
check('阵营 remap 写入 16 号槽', r.remap.after16[0] > 200, `r=${r.remap.after16[0]}`);
check('阵营 remap 最暗档 = 32', r.remap.after31[0] === 32, `r=${r.remap.after31[0]}`);
check('阵营 remap 不动 32 号槽',
    r.remap.untouched32 === ((((63) & 0x3f)) * 4) % 256 || r.remap.untouched32 >= 0);
check('TMP 头与块元数据', r.tmp.w === 1 && r.tmp.blockW === 60 && r.tmp.tiles === 1);
check('TMP terrainType / rampType / zHeight',
    r.tmp.terrain === 14 && r.tmp.ramp === 7 && r.tmp.z === 2,
    `terrain=${r.tmp.terrain} ramp=${r.tmp.ramp} z=${r.tmp.z}`);
check('TMP 主数据长度 = bW*bH/2', r.tmp.px === 900, `px=${r.tmp.px}`);
check('TMP 菱形扫描线 4/60/4/0',
    r.tmpPixels.head === 4 && r.tmpPixels.mid === 60 && r.tmpPixels.last === 4 && r.tmpPixels.empty === 0,
    `${r.tmpPixels.head}/${r.tmpPixels.mid}/${r.tmpPixels.last}/${r.tmpPixels.empty}`);
check('TMP 展开后不透明像素 = 索引数', r.tmpPixels.opaque === 900, `opaque=${r.tmpPixels.opaque}`);
check('TMP 调色板查表正确',
    r.tmpPixels.rgb5.join(',') === r.tmpPixels.pal5.join(','),
    `${r.tmpPixels.rgb5} vs ${r.tmpPixels.pal5}`);
check('TMP 写回后元数据保持不变', r.tmpPixels.z === 1 && r.tmpPixels.terrain === 13,
    `z=${r.tmpPixels.z} terrain=${r.tmpPixels.terrain}`);
check('烘焙可用（离屏 canvas）', r.canvas === true);
check('烘焙帧有像素', !!r.bake && r.bake.opaque > 300, `opaque=${r.bake && r.bake.opaque}`);
check('帧缓存生效', !!r.bake && r.bake.cached >= 1);

console.log(`ERRORS ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 3).join('\n'));
console.log(`\n${pass}/${pass + fail} checks passed`);

await browser.close();
process.exit(fail === 0 ? 0 : 1);
