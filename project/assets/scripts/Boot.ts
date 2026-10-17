/**
 * RIFTSAND / 裂沙战线
 * Bootstraps the whole game from a single entry component: design resolution,
 * world, camera, HUD, input (touch + mouse + keyboard) and the game loop.
 */
import {
    _decorator, Component, Node, director, Director, view, ResolutionPolicy, input, Input,
    EventTouch, EventMouse, EventKeyboard, KeyCode, Vec2, Layers, Graphics, Color, profiler,
} from 'cc';
import { BUILDINGS, Faction, HALF, TILE, clamp } from './core/Core';
import { Game } from './game/Game';
import { Building, Unit, Entity } from './game/Entities';
import { WorldRenderer, gfxNode } from './render/Views';
import { CameraRig } from './render/CameraRig';
import { UI, mkNode } from './ui/UI';

const { ccclass } = _decorator;

const DESIGN_W = 1280;
const DESIGN_H = 720;

interface Gesture {
    x: number;
    y: number;
    lx: number;
    ly: number;
    sx: number;
    sy: number;
    t: number;
    onUI: boolean;
    moved: boolean;
}

@ccclass('RiftApp')
export class RiftApp extends Component {
    private canvasNode: Node;
    private ui: UI;
    private game: Game | null = null;
    private renderer: WorldRenderer | null = null;
    private cam: CameraRig | null = null;
    private worldNode: Node | null = null;

    private touches = new Map<number, Gesture>();
    private mouseGesture: Gesture | null = null;
    private glyphMode: 'none' | 'touch' | 'mouse' = 'none';
    private pinchDist = 0;
    private pinchMid = new Vec2();

    private attackMovePending = false;
    private lastSelId = -1;
    private lastSelTime = 0;
    private keys = new Set<number>();
    private faction: Faction = 'BU';
    private diff: 'easy' | 'normal' | 'hard' = 'normal';
    private started = false;

    onLoad() {
        try { profiler.hideStats(); } catch (e) { /* profiler is debug-only */ }
        view.setDesignResolutionSize(DESIGN_W, DESIGN_H, ResolutionPolicy.SHOW_ALL);
        this.canvasNode = this.node.parent || this.node;

        this.ui = new UI(this.canvasNode, {
            onBuild: (id) => this.game?.beginBuild(id),
            onProduce: (b, id) => this.game?.enqueue(b, id),
            onSell: () => this.game?.sellSelectedBuilding(),
            onSelectAll: () => this.game?.selectAllArmy(),
            onStop: () => this.game?.orderStop(),
            onAttackMove: () => { this.attackMovePending = this.ui.attackMoveMode; },
            onHarvest: () => this.game?.orderHarvest(null),
            onPause: () => this.pause(),
            onResume: () => this.resume(),
            onStart: (f, d) => this.startGame(f, d),
            onRestart: () => this.startGame(this.faction, this.diff),
            onQuit: () => this.quitToMenu(),
            onMinimap: (wx, wy) => this.cam?.focus(wx, wy),
            onCancelBuild: () => { if (this.game) this.game.cancelBuild(); },
            onZoom: (dir) => this.cam?.zoomAt(dir > 0 ? 1.18 : 0.85),
        });

        this.bindInput();
        this.ui.showMenu();

        // dev hook: ?auto=1 jumps straight into a match (used by the smoke test)
        const search = typeof location !== 'undefined' && location.search ? location.search : '';
        if (search.indexOf('auto=1') >= 0) {
            this.startGame('BU', 'normal');
        }
    }

    /* ------------------------------------------------------------ */
    /* input                                                         */
    /* ------------------------------------------------------------ */
    private bindInput() {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);
        input.on(Input.EventType.MOUSE_WHEEL, this.onWheel, this);
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    private toCentered(loc: Vec2) {
        return { x: loc.x - DESIGN_W / 2, y: loc.y - DESIGN_H / 2 };
    }

    private onTouchStart(e: EventTouch) {
        this.glyphMode = 'touch';
        const p = this.toCentered(e.getUILocation());
        this.touches.set(e.getID(), {
            x: p.x, y: p.y, lx: p.x, ly: p.y, sx: p.x, sy: p.y,
            t: Date.now(), onUI: this.ui.hitTest(p.x, p.y), moved: false,
        });
        if (this.touches.size === 2) {
            const arr = Array.from(this.touches.values());
            this.pinchDist = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
            this.pinchMid.set((arr[0].x + arr[1].x) / 2, (arr[0].y + arr[1].y) / 2);
        }
    }

    private onTouchMove(e: EventTouch) {
        const t = this.touches.get(e.getID());
        if (!t) return;
        const p = this.toCentered(e.getUILocation());
        const dx = p.x - t.lx;
        const dy = p.y - t.ly;
        t.lx = p.x;
        t.ly = p.y;
        if (Math.hypot(p.x - t.sx, p.y - t.sy) > 12) t.moved = true;
        t.x = p.x; t.y = p.y;

        if (this.touches.size >= 2) {
            const arr = Array.from(this.touches.values());
            const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
            const mx = (arr[0].x + arr[1].x) / 2;
            const my = (arr[0].y + arr[1].y) / 2;
            if (this.pinchDist > 4) {
                const f = d / this.pinchDist;
                this.cam?.zoomAt(f, mx, my);
            }
            if (this.cam) {
                this.cam.panBy(mx - this.pinchMid.x, my - this.pinchMid.y);
            }
            this.pinchDist = d;
            this.pinchMid.set(mx, my);
            return;
        }

        if (!t.onUI && this.cam && this.ui.mode === 'game') {
            this.cam.panBy(dx, dy);
        }
    }

    private onTouchEnd(e: EventTouch) {
        const t = this.touches.get(e.getID());
        this.touches.delete(e.getID());
        if (this.touches.size < 2) this.pinchDist = 0;
        if (!t) return;
        const dt = Date.now() - t.t;
        if (!t.moved && dt < 450 && this.touches.size === 0) {
            this.handleTap(t.sx, t.sy);
        }
    }

    private onMouseDown(e: EventMouse) {
        if (this.glyphMode === 'touch' && this.touches.size > 0) return;
        this.glyphMode = 'mouse';
        const p = this.toCentered(e.getUILocation());
        this.mouseGesture = {
            x: p.x, y: p.y, lx: p.x, ly: p.y, sx: p.x, sy: p.y,
            t: Date.now(), onUI: this.ui.hitTest(p.x, p.y), moved: false,
        };
    }

    private onMouseMove(e: EventMouse) {
        const g = this.mouseGesture;
        if (!g) return;
        const p = this.toCentered(e.getUILocation());
        const dx = p.x - g.lx;
        const dy = p.y - g.ly;
        g.lx = p.x; g.ly = p.y;
        if (Math.hypot(p.x - g.sx, p.y - g.sy) > 10) g.moved = true;
        if (g.moved && !g.onUI && this.cam && this.ui.mode === 'game') this.cam.panBy(dx, dy);
    }

    private onMouseUp(e: EventMouse) {
        const g = this.mouseGesture;
        this.mouseGesture = null;
        if (!g) return;
        if (!g.moved && Date.now() - g.t < 500) this.handleTap(g.sx, g.sy);
    }

    private onWheel(e: EventMouse) {
        const s = e.getScrollY();
        this.cam?.zoomAt(s > 0 ? 1.1 : 0.9);
    }

    private onKeyDown(e: EventKeyboard) {
        this.keys.add(e.keyCode);
        if (e.keyCode === KeyCode.SPACE) this.game?.selectAllArmy();
        if (e.keyCode === KeyCode.ESCAPE) {
            if (this.ui.mode === 'game') this.pause();
            else if (this.ui.mode === 'paused') this.resume();
        }
        if (e.keyCode === KeyCode.KEY_Q) this.ui.attackMoveMode = !this.ui.attackMoveMode;
    }

    private onKeyUp(e: EventKeyboard) {
        this.keys.delete(e.keyCode);
    }

    /* ------------------------------------------------------------ */
    /* taps                                                          */
    /* ------------------------------------------------------------ */
    private handleTap(x: number, y: number) {
        if (this.ui.onTap(x, y)) return;
        if (this.ui.mode !== 'game' || !this.game || !this.cam) return;
        const g = this.game;
        const w = this.cam.screenToWorld(x, y);

        if (g.buildMode) {
            const def = BUILDINGS[g.buildMode];
            const tx = Math.round((w.x + HALF - (def.size * TILE) / 2) / TILE);
            const ty = Math.round((w.y + HALF - (def.size * TILE) / 2) / TILE);
            g.confirmBuild(tx, ty);
            return;
        }

        const picked = this.pickAt(w.x, w.y);
        if (picked) {
            if (picked.owner === 0) {
                if (picked.isBuilding) {
                    g.selectBuilding(picked as Building);
                } else {
                    const u = picked as Unit;
                    const now = Date.now();
                    if (this.lastSelId === u.id && now - this.lastSelTime < 420) g.selectSameType(u);
                    else g.selectUnit(u, false);
                    this.lastSelId = u.id;
                    this.lastSelTime = now;
                }
            } else if (g.selection.length > 0) {
                g.orderAttack(picked);
            }
            return;
        }

        // empty ground
        if (g.selectedBuilding && g.selection.length === 0) {
            g.selectedBuilding.rally = { x: w.x, y: w.y };
            g.pushFx(w.x, w.y, 'spark', 0.5, 1);
            this.ui.toast('已设置集结点', 'info');
            return;
        }
        if (g.selection.length > 0) {
            const attackMove = this.ui.attackMoveMode;
            if (this.attackMovePending) this.attackMovePending = false;
            if (attackMove) {
                g.orderAttackMove(w.x, w.y);
                this.ui.setAttackMoveMode(false);
            } else {
                g.orderMove(w.x, w.y);
            }
        }
    }

    private pickAt(wx: number, wy: number): Entity | null {
        const g = this.game!;
        let best: Entity | null = null;
        let bd = Infinity;
        for (const u of g.units) {
            if (u.dead) continue;
            if (!g.isVisibleTo(g.human, u)) continue;
            const d = Math.hypot(u.x - wx, u.y - wy);
            const hit = u.radius + 14;
            if (d < hit && d < bd) { bd = d; best = u; }
        }
        if (best) return best;
        for (const b of g.buildings) {
            if (b.dead || !g.isVisibleTo(g.human, b)) continue;
            const half = (b.size * TILE) / 2;
            if (Math.abs(wx - b.x) < half && Math.abs(wy - b.y) < half) return b;
        }
        return null;
    }

    /* ------------------------------------------------------------ */
    /* lifecycle                                                     */
    /* ------------------------------------------------------------ */
    private disposeGame() {
        if (this.worldNode) { this.worldNode.destroy(); this.worldNode = null; }
        this.game = null;
        this.renderer = null;
        this.cam = null;
        if (this.ui) { this.ui.game = null; this.ui.cam = null; }
    }

    private startGame(faction: Faction, diff: 'easy' | 'normal' | 'hard') {
        this.faction = faction;
        this.diff = diff;
        this.disposeGame();
        const seed = (Math.random() * 1000000) | 0;
        const game = new Game(seed, faction, diff, {
            onMessage: (t, k) => this.ui.toast(t, k),
            onGameOver: (win) => this.onGameOver(win),
        });
        const app = this.ui;

        // world sits behind the HUD
        const worldHolder = mkNode(this.canvasNode, 'World');
        worldHolder.setSiblingIndex(0);
        this.renderer = new WorldRenderer(worldHolder, game);
        this.worldNode = worldHolder;
        this.cam = new CameraRig(this.renderer.root);
        this.cam.setScreen(DESIGN_W, DESIGN_H);
        this.cam.targetZoom = 0.78;
        this.cam.zoom = 0.78;

        this.game = game;
        app.game = game;
        app.cam = this.cam;
        app.hideMenu();
        app.hideModal();

        const core = game.buildings.find(b => b.owner === 0 && b.def.isCore);
        if (core) this.cam.focus(core.x + 90, core.y - 80, true);
        (globalThis as any).__riftsandGame = game;
        this.ui.refresh(0);
        this.ui.toast('战斗开始 · 摧毁敌方指挥核心', 'good');
        this.started = true;
    }

    private pause() {
        if (!this.game || this.ui.mode !== 'game') return;
        this.ui.showPause();
    }

    private resume() {
        if (this.ui.mode !== 'paused') return;
        this.ui.hideModal();
        this.ui.mode = 'game';
    }

    private onGameOver(win: boolean) {
        if (!this.game) return;
        const h = this.game.human;
        this.ui.showResult(win, {
            time: this.game.time,
            kills: h.kills,
            lost: h.lost,
            built: h.built,
        });
    }

    private quitToMenu() {
        this.disposeGame();
        this.ui.mode = 'menu';
        this.ui.game = null;
        this.ui.showMenu();
    }

    /* ------------------------------------------------------------ */
    /* loop                                                          */
    /* ------------------------------------------------------------ */
    update(dt: number) {
        const step = Math.min(dt, 0.05);

        if (this.ui.mode === 'game' && this.game) {
            this.handleKeyboardPan(step);
            this.game.update(step);
            this.cam?.update(step);
            this.renderer?.sync(step, this.cam!.viewBounds);
            this.ui.refresh(step);
            this.updateGhost();
        } else if (this.ui.mode === 'paused') {
            // keep the world visible but frozen
            this.renderer?.sync(0, this.cam!.viewBounds);
        }
    }

    private handleKeyboardPan(dt: number) {
        const cam = this.cam;
        if (!cam) return;
        const sp = 900 * dt;
        let dx = 0, dy = 0;
        if (this.keys.has(KeyCode.KEY_A) || this.keys.has(KeyCode.ARROW_LEFT)) dx -= sp;
        if (this.keys.has(KeyCode.KEY_D) || this.keys.has(KeyCode.ARROW_RIGHT)) dx += sp;
        if (this.keys.has(KeyCode.KEY_W) || this.keys.has(KeyCode.ARROW_UP)) dy += sp;
        if (this.keys.has(KeyCode.KEY_S) || this.keys.has(KeyCode.ARROW_DOWN)) dy -= sp;
        if (dx || dy) cam.panBy(-dx, -dy);
    }

    /** build-placement ghost preview */
    private ghost: Node | null = null;
    private updateGhost() {
        const g = this.game;
        if (!g || !this.cam) return;
        if (!g.buildMode) {
            if (this.ghost) { this.ghost.destroy(); this.ghost = null; }
            return;
        }
        if (!this.ghost) {
            this.ghost = gfxNode(this.renderer!.root, 'ghost').node;
        }
        const w = this.lastPointerWorld();
        const def = BUILDINGS[g.buildMode];
        const tx = Math.round((w.x + HALF - (def.size * TILE) / 2) / TILE);
        const ty = Math.round((w.y + HALF - (def.size * TILE) / 2) / TILE);
        g.buildTile = { tx, ty };
        const half = (def.size * TILE) / 2;
        this.ghost.setPosition(tx * TILE + half - HALF, ty * TILE + half - HALF, 0);
        const ok = g.canPlace(def, tx, ty).ok;
        const gr = this.ghost.getComponent(Graphics)!;
        gr.clear();
        gr.rect(-half, -half, half * 2, half * 2);
        gr.fillColor = ok ? new Color(63, 217, 236, 46) : new Color(229, 82, 63, 54);
        gr.fill();
        gr.strokeColor = ok ? new Color(63, 217, 236, 220) : new Color(229, 82, 63, 220);
        gr.lineWidth = 2;
        gr.stroke();
        gr.rect(-half + 4, -half + 4, half * 2 - 8, half * 2 - 8);
        gr.strokeColor = ok ? new Color(63, 217, 236, 90) : new Color(229, 82, 63, 90);
        gr.lineWidth = 1;
        gr.stroke();
    }

    private lastPointerWorld() {
        const g = this.game!;
        const p = this.touches.size > 0 ? Array.from(this.touches.values())[0] : this.mouseGesture;
        if (p && this.cam) return this.cam.screenToWorld(p.lx, p.ly);
        return this.cam ? { x: this.cam.x, y: this.cam.y } : { x: 0, y: 0 };
    }
}

/* ------------------------------------------------------------------ */
/* self-bootstrap                                                      */
/* ------------------------------------------------------------------ */
function findCanvas(): Node | null {
    const scene = director.getScene();
    if (!scene) return null;
    return scene.getChildByName('Canvas');
}

function tryBoot(): boolean {
    const anyObj = globalThis as any;
    if (anyObj.__RIFTSAND_BOOTED__) return true;
    const canvas = findCanvas();
    if (!canvas) return false;
    anyObj.__RIFTSAND_BOOTED__ = true;
    let appNode = canvas.getChildByName('App');
    if (!appNode) {
        appNode = new Node('App');
        appNode.layer = Layers.Enum.UI_2D;
        canvas.addChild(appNode);
    }
    if (!appNode.getComponent(RiftApp)) appNode.addComponent(RiftApp);
    console.log('[RIFTSAND] booted');
    return true;
}

director.once(Director.EVENT_AFTER_SCENE_LAUNCH, () => { tryBoot(); });

// Safety net: if the module is loaded after the scene is already live, or the
// launch event was missed, retry on the next frame(s).
const guard = () => {
    if (tryBoot()) director.off(Director.EVENT_AFTER_UPDATE, guard);
};
director.on(Director.EVENT_AFTER_UPDATE, guard);
