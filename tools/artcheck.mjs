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
}

check('运行无报错', errors.length === 0, errors.slice(0, 2).join(' | '));
console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
