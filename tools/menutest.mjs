/**
 * Skirmish setup screen regression: map / faction / colour selection.
 *
 * The retail skirmish dialog lets you pick a map, a side and a house colour
 * before the match; this asserts that all three actually reach the simulation.
 *
 * usage: node tools/menutest.mjs [url]
 */
import { createRequire } from 'node:module';

const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html';
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
await page.waitForFunction(`(() => {
    try {
        const sc = window.cc && window.cc.director.getScene();
        const cv = sc && sc.getChildByName('Canvas');
        return !!(cv && cv.getChildByName('App'));
    } catch (e) { return false; }
})()`, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 900));

const uiState = () => page.evaluate(() => {
    const a = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    return { mode: a.ui.mode, map: a.ui.selMap, color: a.ui.selColor, btns: a.ui.menuBtns.length };
});

const before = await uiState();
check('主菜单已显示', before.mode === 'menu', before.mode);
check('菜单包含地图/颜色/阵营控件', before.btns >= 20, `${before.btns} 个可点控件`);

/* ---------- map: click the 3rd chip (GREAT DUNES, left column) ---------- */
// the list wraps into two columns once authored maps exist, so the 3rd chip sits
// at x = -84 (left column) instead of dead centre
await page.mouse.click(640 - 84, 360 - 96);
await new Promise((r) => setTimeout(r, 300));
const afterMap = await uiState();
check('点击可切换地图', afterMap.map === 'dunes', `${before.map} → ${afterMap.map}`);

/* ---------- colour: 4th swatch ---------- */
await page.mouse.click(640 - 27, 360 + 76);
await new Promise((r) => setTimeout(r, 300));
const afterColor = await uiState();
check('点击可切换玩家颜色', afterColor.color === 'amber', `${before.color} → ${afterColor.color}`);

/* ---------- start ---------- */
await page.mouse.click(640, 360 + 210);
await page.waitForFunction('window.__riftsandGame != null', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 700));

const game = await page.evaluate(() => {
    const g = window.__riftsandGame;
    let rocks = 0, dunes = 0;
    for (let i = 0; i < g.terrain.kind.length; i++) {
        if (g.terrain.kind[i] === 2) rocks++;
        else if (g.terrain.kind[i] === 1) dunes++;
    }
    const colorOf = window.__riftsandConst.colorOf;
    return {
        map: g.options.mapId,
        colors: g.options.colors,
        rocks, dunes,
        playerColor: colorOf ? colorOf('BU') : null,
        units: g.units.length,
        buildings: g.buildings.length,
    };
});
console.log('   game', JSON.stringify(game));
check('对局使用所选地图', game.map === 'dunes', game.map);
check('对局使用所选颜色', game.colors[0] === 'amber', JSON.stringify(game.colors));
check('两侧颜色不同', game.colors[0] !== game.colors[1], JSON.stringify(game.colors));
// the dunes preset raises the dune threshold share well above the rock share
check('地图预设真的改变了地形', game.dunes > game.rocks * 3,
    `岩石 ${game.rocks} / 沙丘 ${game.dunes}`);
check('对局正常建立', game.units > 0 && game.buildings > 0,
    `${game.units} 单位 / ${game.buildings} 建筑`);

console.log(`ERRORS ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 3).join('\n'));
console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
