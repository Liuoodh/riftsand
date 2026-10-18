/**
 * Driving-facing regression: is the hull image stable while it drives?
 *
 * This exists because "the tank keeps wobbling while it walks" survived four
 * rounds of steering fixes, and the final cause was in the sprite selection, not
 * in the movement code. Two things can make a hull shake without moving:
 *
 *   1. the walk sequence is read with the wrong stride, so the four frames it
 *      plays are four different FACINGS (fixed in v0.17 — see ArtPack.ts);
 *   2. the 8-way image index flickers between two neighbours because the path
 *      keeps handing the hull a slightly different bearing (the debounce in
 *      Views.stableDir).
 *
 * Both show up the same way on screen, and neither is visible from the game
 * state, so this probe reads the *drawn* SpriteFrame's atlas index — what the
 * player actually sees — once per rendered frame, for all eight directions.
 *
 * Usage: node tools/dirtest.mjs [url]
 */
import { createRequire } from 'node:module';

const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html?auto=1';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
    if (ok) { pass++; console.log(`PASS  ${name}  · ${detail}`); }
    else { fail++; console.log(`FAIL  ${name}  · ${detail}`); }
}

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 900, height: 600 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__riftsandGame != null', { timeout: 60000 });
await page.evaluate(() => window.__riftsandArtReady);

const rows = await page.evaluate(async () => {
    const g = window.__riftsandGame;
    g.aiEnabled = false;
    const cc = window.cc;
    const scene = cc.director.getScene();
    const { TILE, HALF, MAP_TILES } = window.__riftsandConst;
    const w = (tx, ty) => ({ x: tx * TILE + TILE / 2 - HALF, y: ty * TILE + TILE / 2 - HALF });

    // a clean runway: the flat map's decorations are elsewhere, but clear it so
    // this measures steering and nothing else
    for (let y = 16; y < 74; y++) {
        for (let x = 8; x < 74; x++) {
            const i = y * MAP_TILES + x;
            g.terrain.kind[i] = 0;
            g.terrain.solid[i] = 0;
        }
    }
    g.terrain.rebuildSpeed();
    g.terrain.rebuildHeight();

    const atlasIndex = (sf) => {
        const t = sf.texture, r = sf.rect;
        const fw = r.width, fh = r.height;
        const cols = Math.max(1, Math.floor(t.width / fw));
        return Math.round((t.height - r.y - fh) / fh) * cols + Math.round(r.x / fw);
    };

    const out = [];
    for (let k = 0; k < 8; k++) {
        for (const u of g.units.slice()) {
            if (u.def.id === 'rampart') {
                u.dead = true;
                g.occupancy.remove(u, u.cellX, u.cellY);
                g.units.splice(g.units.indexOf(u), 1);
            }
        }
        const ang = (k * 45) * Math.PI / 180;
        const s = w(30, 40);
        const u = g.spawnUnit(0, window.__riftsandDefs.UNITS.rampart, s.x, s.y);
        u.order = { k: 'idle' };
        u.face = ang;
        u.turretFace = ang;

        // the view is created by the renderer on the next frame
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        let node = null;
        scene.walk((n) => { if (n.name === 'U:' + u.id) node = n; });
        const sprite = node && node.getChildByName('sprite')
            ? node.getChildByName('sprite').getComponent(cc.Sprite) : null;

        const shots = [];
        const faces = [];
        await new Promise((done) => {
            let i = 0;
            const step = () => {
                if (i === 3) g.applyOrder(u, { k: 'move', x: s.x + Math.cos(ang) * 420, y: s.y + Math.sin(ang) * 420 });
                if (sprite && sprite.spriteFrame) shots.push(atlasIndex(sprite.spriteFrame));
                faces.push(+(((u.face * 180 / Math.PI) % 360 + 360) % 360).toFixed(1));
                i++;
                if (i < 210) requestAnimationFrame(step); else done();
            };
            requestAnimationFrame(step);
        });

        // the first 40 frames are the turn from the initial heading onto the path
        const settled = shots.slice(40);
        const blocks = settled.filter((i) => i >= 8).map((i) => Math.floor((i - 8) / 4));
        const uniq = [...new Set(blocks)];
        let flips = 0;
        for (let i = 2; i < blocks.length; i++) {
            if (blocks[i] !== blocks[i - 1] && blocks[i] === blocks[i - 2]) flips++;
        }
        out.push({
            deg: k * 45,
            blocks: uniq,
            flips,
            faces: [...new Set(faces.slice(40))].length,
            moved: Math.round(Math.hypot(u.x - s.x, u.y - s.y)),
        });
    }
    return out;
});

for (const r of rows) {
    check(
        `点击 ${String(r.deg).padStart(3)}° 行驶时朝向图块不来回切`,
        r.blocks.length === 1 && r.flips === 0,
        `图块 ${JSON.stringify(r.blocks)} 来回 ${r.flips} 次，走了 ${r.moved}px`,
    );
}
check('运行无报错', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
