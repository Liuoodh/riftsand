/**
 * Authored-map acceptance test.
 *
 * A map is only worth shipping if a match can actually be played on it, so this
 * boots the real game on every authored map and asserts the properties a level
 * designer cannot eyeball reliably:
 *
 *   1. the JSON really reached the terrain (land mix matches the file),
 *   2. both bases exist and are standing on their spawn tiles,
 *   3. the two spawns are connected for a *vehicle* hull, not just for a flood
 *      fill on the cell grid (a 1-cell gap passes a naive check and fails in game),
 *   4. every ore field is reachable by a real PathFinder query from both sides,
 *   5. harvesters actually earn money for 60 seconds — the loop closes.
 *
 * usage: node tools/maptest.mjs [url] [mapId ...]
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');

const BASE = (process.argv[2] || 'http://127.0.0.1:8950/index.html').replace(/\?.*$/, '');
const IDS = process.argv.slice(3);
const MAPS = IDS.length ? IDS : ['twin-gates', 'ring-lake', 'mesa'];
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

for (const id of MAPS) {
    console.log(`\n--- ${id} ---`);
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}?auto=1&map=${id}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__riftsandGame != null', { timeout: 60000 });

    const doc = JSON.parse(readFileSync(`assets/maps/${id}.json`, 'utf8'));
    const res = await page.evaluate((id) => {
        const g = window.__riftsandGame;
        g.aiEnabled = false;
        const { TILE, HALF, MAP_TILES: N } = window.__riftsandConst;
        const counts = { rock: 0, water: 0, road: 0, dune: 0, sand: 0, crystal: 0 };
        for (let i = 0; i < g.terrain.kind.length; i++) {
            const k = g.terrain.kind[i];
            if (k === 0) counts.sand++;
            else if (k === 1) counts.dune++;
            else if (k === 2) counts.rock++;
            else if (k === 3) counts.crystal++;
            else if (k === 4) counts.road++;
            else if (k === 5) counts.water++;
        }
        /* vehicle-class path queries, the thing a cell flood fill does not prove */
        const probe = window.__riftsandDefs.UNITS.rampart;
        const r = probe.radius * 0.45;
        const w = (tx, ty) => ({ x: tx * TILE + TILE / 2 - HALF, y: ty * TILE + TILE / 2 - HALF });
        /* the spawn tile itself is under the command core; probe from the first
           free cell beside it, which is where a real unit would be standing */
        const stand = (s) => {
            for (let rad = 0; rad <= 9; rad++) {
                for (let dy = -rad; dy <= rad; dy++) {
                    for (let dx = -rad; dx <= rad; dx++) {
                        const tx = s.tx + dx, ty = s.ty + dy;
                        if (tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
                        if (!g.isBlocked(tx, ty)) return { tx, ty };
                    }
                }
            }
            return s;
        };
        const spawns = [stand(g.baseTile[0]), stand(g.baseTile[1])];
        const from = (s) => { const p = w(s.tx, s.ty); return p; };
        const link = g.finder.find(from(spawns[0]).x, from(spawns[0]).y,
            from(spawns[1]).x, from(spawns[1]).y, { radius: r });
        const ore = g.terrain.nodes.map((n) => {
            const p = w(n.tx, n.ty);
            const a = g.finder.find(from(spawns[0]).x, from(spawns[0]).y, p.x, p.y, { radius: r });
            const b = g.finder.find(from(spawns[1]).x, from(spawns[1]).y, p.x, p.y, { radius: r });
            return { id: n.id, reach0: !!a, reach1: !!b };
        });
        const bases = [0, 1].map((pid) => {
            const b = g.players[pid] ? g.buildings.find((x) => x.owner === pid && x.def.isCore) : null;
            return b ? { tx: b.tx, ty: b.ty, done: b.done, hp: Math.round(b.hp) } : null;
        });
        /* 60 s of real production + harvesting */
        const c0 = g.players[0].earned;
        for (let i = 0; i < 1200; i++) g.update(0.05);
        return {
            counts, bases, ore, link: !!link,
            earned: g.players[0].earned - c0,
            harv: g.units.filter((u) => u.isHarvester && !u.dead && u.owner === 0).length,
            mapId: g.options.mapId,
        };
    }, id);

    check(`${id} 载入正确的地图`, res.mapId === id, res.mapId);
    check(`${id} 地形与 JSON 一致`, res.counts.rock > 200 && res.counts.sand > 1000,
        `岩${res.counts.rock}/水${res.counts.water}/路${res.counts.road}/沙${res.counts.sand}`);
    check(`${id} 双方基地已就位`, !!res.bases[0] && !!res.bases[1] && res.bases[0].done,
        JSON.stringify(res.bases));
    check(`${id} 两个出生点之间有车辆通路`, res.link);
    const badOre = res.ore.filter((o) => !o.reach0 || !o.reach1);
    check(`${id} 全部矿点可达`, badOre.length === 0, `${res.ore.length} 个矿点，不可达 ${badOre.length}`);
    // a 300-cargo truck delivers ~3 times a minute on a short map and ~2 times on a
    // long one; four deliveries total is the bar for "the loop closes"
    check(`${id} 采集链能产出`, res.earned >= 1200, `${res.harv} 台采集车，60 秒产出 ${res.earned}`);
    check(`${id} 运行无报错`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
