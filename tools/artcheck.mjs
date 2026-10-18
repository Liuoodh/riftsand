/**
 * Art pipeline check.
 *
 * Boots the real game, waits for the runtime manifest to load, and prints what the
 * engine actually resolved:
 *
 *   - which atlases loaded (and why the others did not)
 *   - the facing table: "engine facing N -> atlas frame M" for body and turret
 *   - the walk cycle: how many phases a moving unit gets, and that they differ
 *
 * Catches the three classic batch mistakes without eyeballing screenshots:
 * a mirrored facing order, an offset starting angle, and a walk sequence whose
 * frame count is not a multiple of the facing count.
 *
 * usage: node tools/artcheck.mjs [url] [unitId]
 */
import { createRequire } from 'node:module';

const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html?auto=1';
const UNIT = process.argv[3] || 'rampart';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0, fail = 0;
const check = (name, ok, note = '') => {
    if (ok) { pass++; console.log(`PASS  ${name}${note ? '  · ' + note : ''}`); }
    else { fail++; console.log(`FAIL  ${name}${note ? '  · ' + note : ''}`); }
};

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__riftsandGame != null', { timeout: 60000 });
await page.evaluate(() => window.__riftsandArtReady);

const info = await page.evaluate(() => window.__riftsandArtInfo);
console.log('art packs:', JSON.stringify(info.ids));
if (info.error) console.log('load notes:', info.error);
for (const d of info.describe) console.log('  ' + d);

check(`${UNIT} 图集已加载`, info.ids.includes(UNIT), info.ids.join(',') || '(none)');

if (info.ids.includes(UNIT)) {
    const table = await page.evaluate((id) => {
        const A = window.__riftsandArt;
        const body = [], turret = [], walk = [], walk1 = [];
        for (let d = 0; d < 8; d++) {
            body.push(A.bodyIndex(id, d, 0, false));
            turret.push(A.turretIndex(id, d));
        }
        for (let f = 0; f < 4; f++) walk.push(A.bodyIndex(id, 0, f, true));
        for (let f = 0; f < 4; f++) walk1.push(A.bodyIndex(id, 1, f, true));
        return { body, turret, walk, walk1 };
    }, UNIT);

    console.log('   facing  body  turret');
    table.body.forEach((b, i) => console.log(`      ${i}     ${b}      ${table.turret[i]}`));

    // 1. every facing must resolve to a distinct atlas frame
    check('8 个朝向对应 8 张不同帧', new Set(table.body).size === 8, table.body.join(','));
    // 2. and they must be consecutive (a mirrored batch would be 0,7,6,5…)
    const consecutive = table.body.every((v, i) => v === table.body[0] + i);
    check('朝向在图集里连续排列（没有镜像）', consecutive, table.body.join(','));
    // 3. turret alignment mirrors the body
    check('炮塔朝向与车体一致', JSON.stringify(table.turret) === JSON.stringify(table.body),
        table.turret.join(','));
    // 4. walk phases exist and are distinct
    check('行走循环有 4 个不同相位', new Set(table.walk).size === 4, table.walk.join(','));
    /*
     * 5. the four walk frames of ONE facing must be consecutive cells.
     *
     * The atlas puts each facing's phases side by side, so the stride between
     * phases is 1 and the stride between facings is the phase count. Reading it
     * the other way round (phase-major) also yields four distinct indices — which
     * is why "4 distinct phases" passed while the unit was actually being shown
     * four different facings, and every step looked like the hull swinging
     * sideways. These two assertions pin the layout down.
     */
    check('同朝向的行走帧连续（每帧是同一模型的相位）',
        table.walk.every((v, i) => i === 0 || v === table.walk[i - 1] + 1), table.walk.join(','));
    check('朝向之间按相位数量跨块',
        table.walk1[0] - table.walk[0] === table.walk.length,
        `facing0=${table.walk[0]} facing1=${table.walk1[0]} stride=${table.walk.length}`);

    /*
     * 6. no vertical bob between walk phases.
     *
     * A walk cycle must not lift the whole hull: the four frames have to share one
     * ground line and only the treads/wheels may move. A 1.5 px bounce at 9 fps is
     * a permanent shake, and it is worst when the hull drives sideways across the
     * screen (the eye tracks the silhouette while the jitter runs perpendicular to
     * it). This is what "the tank keeps turning and shaking" turned out to be — the
     * Blender script had `bob = [0, .016, 0, -.016]` on `hull.location.z`.
     *
     * Measured from the atlas pixels: the bottom edge of the silhouette per phase.
     */
    const bobs = await page.evaluate((id) => {
        const CANVAS = document.createElement('canvas');
        const ctx = CANVAS.getContext('2d');
        const cache = new Map();
        const baseOf = (sf) => {
            const tex = sf.texture;
            const img = tex && tex.image && tex.image.data;
            if (!img) return null;
            if (!cache.has(tex)) {
                const c = document.createElement('canvas');
                c.width = tex.width; c.height = tex.height;
                c.getContext('2d').drawImage(img, 0, 0);
                cache.set(tex, c.getContext('2d'));
            }
            const src = cache.get(tex);
            const r = sf.rect;
            // PNG rows run top-down, SpriteFrame rects bottom-up
            const top = tex.height - r.y - r.height;
            const d = src.getImageData(r.x, top, r.width, r.height).data;
            let bottom = -1;
            for (let y = r.height - 1; y >= 0 && bottom < 0; y--) {
                for (let x = 0; x < r.width; x++) {
                    if (d[(y * r.width + x) * 4 + 3] > 40) { bottom = top + y; break; }
                }
            }
            return bottom;
        };
        const out = [];
        for (let f = 0; f < 8; f++) {
            const rows = [];
            for (let ph = 0; ph < 4; ph++) {
                const sf = window.__riftsandArt.bodyFrame(id, f, ph, true);
                rows.push(sf ? baseOf(sf) : null);
            }
            out.push(rows);
        }
        void CANVAS; void ctx;
        return out;
    }, UNIT);

    const spread = bobs.map((r) => {
        const v = r.filter((x) => x !== null);
        return v.length ? Math.max(...v) - Math.min(...v) : 0;
    });
    check('行走四帧共用同一条地面线（车体不上下颠）',
        spread.every((s) => s <= 1),
        `每朝向底边跨度 ${JSON.stringify(spread)}`);
}

check('运行无报错', errors.length === 0, errors.slice(0, 2).join(' | '));
console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
