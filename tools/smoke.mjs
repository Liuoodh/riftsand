/**
 * Dev smoke test: opens the built web-mobile game in headless Chrome,
 * captures console errors and a few screenshots.
 *
 * usage: node tools/smoke.mjs [url] [outDir]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// puppeteer-core is installed in the agent's shared node workspace, not in this repo
const req = createRequire(
    (process.env.SMOKE_NODE_MODULES || 'C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules') + '/',
);
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = process.argv[3] || '.shots';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
        '--no-sandbox',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--window-size=1280,720',
        '--hide-scrollbars',
    ],
    defaultViewport: { width: 1280, height: 720 },
});

const page = await browser.newPage();
const errors = [];
page.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) console.log('[http' + r.status() + ']', r.url()); });
page.on('console', (m) => {
    const t = m.type();
    const text = m.text();
    if (t === 'error') errors.push('[console.error] ' + text);
    if (t === 'warning' && /error|fail/i.test(text)) errors.push('[console.warn] ' + text);
    console.log(`[${t}] ${text}`);
    if (t === 'error') {
        Promise.all(m.args().map((a) => a.evaluate((v) => {
            try { return v && v.stack ? v.stack : String(v); } catch (err) { return '<unserializable>'; }
        }).catch(() => '<eval-fail>'))).then((parts) => console.log('   >>', parts.join(' | '))).catch(() => {});
    }
});
page.on('pageerror', (e) => {
    errors.push('[pageerror] ' + e.message);
    console.log('[pageerror]', e.message);
});

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });

// wait for the game to self-bootstrap
await page.waitForFunction('window.__RIFTSAND_BOOTED__ === true', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: path.join(OUT, '01-menu.png') });

const shot = async (name, ms = 0) => {
    if (ms) await new Promise((r) => setTimeout(r, ms));
    await page.screenshot({ path: path.join(OUT, name) });
    console.log('shot', name);
};

// start match (design y = -238 -> screen y = 598)
await page.mouse.click(640, 598);
await shot('02-start.png', 2500);

// probe internal state
const state = await page.evaluate(() => {
    const cc = window.cc;
    const scene = cc && cc.director && cc.director.getScene();
    const canvas = scene && scene.getChildByName('Canvas');
    const world = canvas && canvas.getChildByName('World');
    return {
        booted: !!window.__RIFTSAND_BOOTED__,
        scene: scene ? scene.name : null,
        hasWorld: !!world,
        worldChildren: world ? world.children.map((c) => c.name) : [],
        unitNodes: world ? (world.getChildByName('WorldRoot')?.getChildByName('L2_Units')?.children.length ?? -1) : -1,
        buildingNodes: world ? (world.getChildByName('WorldRoot')?.getChildByName('L1_Buildings')?.children.length ?? -1) : -1,
    };
});
console.log('STATE', JSON.stringify(state));

await shot('03-early.png', 6000);
await shot('04-mid.png', 12000);

// pan the camera a bit to check input
await page.mouse.move(700, 400);
await page.mouse.down();
await page.mouse.move(500, 400, { steps: 12 });
await page.mouse.up();
await shot('05-pan.png', 800);

const state2 = await page.evaluate(() => {
    const cc = window.cc;
    const scene = cc.director.getScene();
    const canvas = scene.getChildByName('Canvas');
    const world = canvas.getChildByName('World');
    const root = world.getChildByName('WorldRoot');
    return {
        units: root.getChildByName('L2_Units')?.children.length ?? -1,
        buildings: root.getChildByName('L1_Buildings')?.children.length ?? -1,
        fps: Math.round(cc.game.frameRate),
    };
});
console.log('STATE2', JSON.stringify(state2));

console.log('ERRORS', errors.length);
for (const e of errors) console.log(e);

await browser.close();
