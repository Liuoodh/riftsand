/**
 * RIFTSAND / 裂沙战线
 * Bootstraps the whole game from a single entry component: design resolution,
 * world, camera, HUD, input (touch + mouse + keyboard) and the game loop.
 *
 * Input model (mobile first):
 *   tap            -> select / move / attack (with light target snapping)
 *   drag           -> box select
 *   two fingers    -> pan + pinch zoom
 *   long press     -> command wheel (stop / stance / deploy / repair ...)
 *   long press on group strip / production card -> assign group / fill queue
 */
import {
    _decorator, Component, Node, director, Director, view, ResolutionPolicy, input, Input,
    EventTouch, EventMouse, EventKeyboard, KeyCode, Vec2, Layers, Graphics, Color, profiler,
} from 'cc';
import {
    BUILDINGS, Faction, HALF, TILE, clamp, dist,
    TAP_MAX_MS, TAP_SLOP, LONG_PRESS_MS, BOX_MIN_PX, SNAP_PX,
    ProdCat, SuperWeaponId, SUPER_WEAPONS,
} from './core/Core';
import { Game } from './game/Game';
import { Building, Unit, Entity } from './game/Entities';
import { CrystalNode } from './world/Terrain';
import { WorldRenderer, gfxNode } from './render/Views';
import { CameraRig } from './render/CameraRig';
import { UI, mkNode } from './ui/UI';
import { RadialItem } from './ui/Overlay';
import { sfx } from './audio/Sfx';

const { ccclass } = _decorator;

const DESIGN_W = 1280;
const DESIGN_H = 720;

interface Pointer {
    id: number;
    /** start position, screen-centre space */
    sx: number;
    sy: number;
    /** last position */
    lx: number;
    ly: number;
    t: number;
    /** started on the HUD */
    onUI: boolean;
    /** group strip cell hit at press time, -1 = none */
    group: number;
    moved: boolean;
    longFired: boolean;
    boxMode: boolean;
}

@ccclass('RiftApp')
export class RiftApp extends Component {
    private canvasNode: Node;
    private ui: UI;
    private game: Game | null = null;
    private renderer: WorldRenderer | null = null;
    private cam: CameraRig | null = null;
    private worldNode: Node | null = null;

    private touches = new Map<number, Pointer>();
    private mousePointer: Pointer | null = null;
    private glyphMode: 'none' | 'touch' | 'mouse' = 'none';
    private pinchDist = 0;
    private pinchMid = new Vec2();
    /** true while two fingers are down: single-finger gestures are suppressed */
    private multi = false;

    private attackMovePending = false;
    private lastSelId = -1;
    private lastSelTime = 0;
    private lastGroup = -1;
    private lastGroupTime = 0;
    private keys = new Set<number>();
    private faction: Faction = 'BU';
    private diff: 'easy' | 'normal' | 'hard' = 'normal';
    private credits = 4200;
    private superWeapons = true;
    private started = false;
    /** world point the build ghost sticks to while no finger is down */
    private lastBuildWorld: { x: number | null; y: number | null } = { x: null, y: null };
    private audioReady = false;

    onLoad() {
        try { profiler.hideStats(); } catch (e) { /* profiler is debug-only */ }
        view.setDesignResolutionSize(DESIGN_W, DESIGN_H, ResolutionPolicy.SHOW_ALL);
        this.canvasNode = this.node.parent || this.node;

        this.ui = new UI(this.canvasNode, {
            onBuild: (id) => this.game?.queueBuild(id),
            onPlace: (id) => {
                if (!this.game) return;
                this.game.beginPlace(id);
                this.ui.toast(`放置 ${BUILDINGS[id].name}`, 'info');
            },
            onProduce: (cat, id, times) => {
                const n = this.game?.queueUnit(cat as ProdCat, id, times) || 0;
                if (n > 1) this.vibrate();
            },
            onSell: () => this.game?.sellSelectedBuilding(),
            onRepair: () => this.game?.toggleRepair(),
            onStance: () => this.game?.cycleStance(),
            onScatter: () => this.game?.orderScatter(),
            onDeploy: () => this.game?.orderDeploy(),
            onSelectAll: () => this.game?.selectAllArmy(),
            onStop: () => this.game?.orderStop(),
            onAttackMove: () => { this.attackMovePending = this.ui.attackMoveMode; },
            onHarvest: () => this.game?.orderHarvest(null),
            onPause: () => this.pause(),
            onResume: () => this.resume(),
            onStart: (f, d, credits, superWeapons) => this.startGame(f, d, credits, superWeapons),
            onRestart: () => this.startGame(this.faction, this.diff, this.credits, this.superWeapons),
            onQuit: () => this.quitToMenu(),
            onMinimap: (wx, wy) => this.cam?.focus(wx, wy),
            onCancelBuild: () => {
                if (!this.game) return;
                if (this.game.swTargeting) this.game.cancelSwTargeting();
                else this.game.cancelBuild();
            },
            onZoom: (dir) => this.cam?.zoomAt(dir > 0 ? 1.18 : 0.85),
            onSuperWeapon: (id) => this.beginSuperWeapon(id),
            onToggleSound: (m) => sfx.setMuted(m),
            onCancelQueue: (cat, index) => this.game?.cancelQueue(cat, index),
        });

        this.bindInput();
        this.ui.showMenu();

        // dev hook: ?auto=1 jumps straight into a match (used by the smoke test)
        const search = typeof location !== 'undefined' && location.search ? location.search : '';
        if (search.indexOf('auto=1') >= 0) {
            this.startGame('BU', 'normal', 4200, true);
        }
    }

    /* ------------------------------------------------------------ */
    /* audio                                                         */
    /* ------------------------------------------------------------ */
    private ensureAudio() {
        if (this.audioReady) return;
        this.audioReady = true;
        sfx.init();
        sfx.resume();
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

    private newPointer(id: number, p: { x: number; y: number }): Pointer {
        return {
            id,
            sx: p.x, sy: p.y, lx: p.x, ly: p.y,
            t: Date.now(),
            onUI: this.ui.mode !== 'game' ? true : this.ui.hitTest(p.x, p.y),
            group: this.ui.mode === 'game' ? this.ui.overlay.groupAt(p.x, p.y) : -1,
            moved: false,
            longFired: false,
            boxMode: false,
        };
    }

    private onTouchStart(e: EventTouch) {
        this.glyphMode = 'touch';
        this.ensureAudio();
        const p = this.toCentered(e.getUILocation());
        const ptr = this.newPointer(e.getID(), p);
        this.touches.set(e.getID(), ptr);

        if (this.touches.size === 1) {
            this.multi = false;
        } else if (this.touches.size === 2) {
            // a second finger always means "camera", never "select"
            this.abortSingleGesture();
            this.multi = true;
            const arr = Array.from(this.touches.values());
            this.pinchDist = Math.hypot(arr[0].lx - arr[1].lx, arr[0].ly - arr[1].ly);
            this.pinchMid.set((arr[0].lx + arr[1].lx) / 2, (arr[0].ly + arr[1].ly) / 2);
        }
    }

    /** cancel whatever the first finger had started, without firing commands */
    private abortSingleGesture() {
        if (this.ui.overlay.radialOpen) this.ui.overlay.hideRadial();
        this.ui.overlay.hideBox();
        for (const p of this.touches.values()) {
            p.boxMode = false;
            p.longFired = true;
        }
    }

    private onTouchMove(e: EventTouch) {
        const t = this.touches.get(e.getID());
        if (!t) return;
        const p = this.toCentered(e.getUILocation());
        const prevX = t.lx;
        const prevY = t.ly;
        t.lx = p.x;
        t.ly = p.y;
        if (!t.moved && Math.hypot(p.x - t.sx, p.y - t.sy) > TAP_SLOP) t.moved = true;

        if (this.touches.size >= 2) {
            this.applyTwoFinger();
            return;
        }

        // command wheel: finger movement picks an item instead of selecting
        if (this.ui.overlay.radialOpen) {
            const idx = this.ui.overlay.radialHit(p.x, p.y);
            this.ui.overlay.setRadialActive(idx >= 0 ? idx : -1);
            return;
        }

        if (t.onUI || t.longFired || !this.game || this.ui.mode !== 'game') return;

        // placing a building: one finger pans the map so the player can pick a
        // spot that is currently off screen (box select is meaningless here)
        if (this.game.buildMode || this.game.swTargeting) {
            if (t.moved && this.cam) this.cam.panBy(p.x - prevX, p.y - prevY);
            return;
        }

        if (t.moved && Math.hypot(p.x - t.sx, p.y - t.sy) >= BOX_MIN_PX) {
            t.boxMode = true;
            this.ui.overlay.showBox(t.sx, t.sy, p.x, p.y);
        }
    }

    private applyTwoFinger() {
        const arr = Array.from(this.touches.values());
        if (arr.length < 2 || !this.cam) return;
        const a = arr[0], b = arr[1];
        const d = Math.hypot(a.lx - b.lx, a.ly - b.ly);
        const mx = (a.lx + b.lx) / 2;
        const my = (a.ly + b.ly) / 2;
        this.cam.pinch(this.pinchDist, d, this.pinchMid.x, this.pinchMid.y, mx, my);
        this.pinchDist = d;
        this.pinchMid.set(mx, my);
    }

    private onTouchEnd(e: EventTouch) {
        const t = this.touches.get(e.getID());
        this.touches.delete(e.getID());
        if (!t) return;
        if (this.touches.size < 2) { this.multi = false; this.pinchDist = 0; }
        if (this.multi) { for (const p of this.touches.values()) p.longFired = true; return; }
        this.finishPointer(t);
    }

    private finishPointer(t: Pointer) {
        // 1) command wheel: slide to pick, lift to fire
        if (this.ui.overlay.radialOpen) {
            const idx = this.ui.overlay.radialHit(t.lx, t.ly);
            // a long press that never slid keeps the wheel open for a second tap
            if (t.longFired && idx < 0 && !t.moved) return;
            const item = this.ui.overlay.itemAt(idx);
            this.ui.overlay.hideRadial();
            if (item && item.enabled) this.runCommand(item.id);
            return;
        }
        // 2) box select
        if (t.boxMode) {
            this.finishBox(t);
            return;
        }
        // 3) long press already handled (group assign / batch queue)
        if (t.longFired) return;
        // 4) plain tap
        if (!t.moved && Date.now() - t.t < TAP_MAX_MS && this.touches.size === 0) {
            this.handleTap(t.sx, t.sy);
        }
    }

    private onMouseDown(e: EventMouse) {
        this.ensureAudio();
        if (this.glyphMode === 'touch' && this.touches.size > 0) return;
        this.glyphMode = 'mouse';
        const p = this.toCentered(e.getUILocation());
        const ptr = this.newPointer(0, p);
        // right / middle button = camera drag, left = box select
        if (e.getButton() !== EventMouse.BUTTON_LEFT) ptr.onUI = false;
        this.mousePointer = ptr;
        (ptr as any).panMode = e.getButton() !== EventMouse.BUTTON_LEFT;
    }

    private onMouseMove(e: EventMouse) {
        const g = this.mousePointer;
        if (!g) return;
        const p = this.toCentered(e.getUILocation());
        const dx = p.x - g.lx;
        const dy = p.y - g.ly;
        g.lx = p.x; g.ly = p.y;
        if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) > TAP_SLOP) g.moved = true;

        if (this.ui.overlay.radialOpen) {
            const idx = this.ui.overlay.radialHit(p.x, p.y);
            this.ui.overlay.setRadialActive(idx >= 0 ? idx : -1);
            return;
        }
        if ((g as any).panMode) {
            if (g.moved && this.cam && this.ui.mode === 'game') this.cam.panBy(dx, dy);
            return;
        }
        if (g.onUI || !this.game || this.ui.mode !== 'game' || this.game.buildMode || this.game.swTargeting) return;
        if (g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) >= BOX_MIN_PX) {
            g.boxMode = true;
            this.ui.overlay.showBox(g.sx, g.sy, p.x, p.y);
        }
    }

    private onMouseUp(e: EventMouse) {
        const g = this.mousePointer;
        this.mousePointer = null;
        if (!g) return;
        this.finishPointer(g);
    }

    private onWheel(e: EventMouse) {
        const s = e.getScrollY();
        this.cam?.zoomAt(s > 0 ? 1.1 : 0.9);
    }

    private onKeyDown(e: EventKeyboard) {
        this.keys.add(e.keyCode);
        const g = this.game;
        if (e.keyCode === KeyCode.SPACE) g?.selectAllArmy();
        if (e.keyCode === KeyCode.ESCAPE) {
            if (this.ui.overlay.radialOpen) this.ui.overlay.hideRadial();
            else if (g?.swTargeting) g.cancelSwTargeting();
            else if (g?.buildMode) g.cancelBuild();
            else if (this.ui.mode === 'game') this.pause();
            else if (this.ui.mode === 'paused') this.resume();
        }
        if (e.keyCode === KeyCode.KEY_Q) this.ui.setAttackMoveMode(!this.ui.attackMoveMode);
        if (e.keyCode === KeyCode.KEY_H) g?.orderStop();
        if (e.keyCode === KeyCode.KEY_Z) g?.cycleStance();
        if (e.keyCode === KeyCode.KEY_X) g?.orderScatter();
        if (e.keyCode === KeyCode.KEY_E) g?.orderDeploy();
        if (e.keyCode === KeyCode.KEY_R) g?.toggleRepair();
        if (e.keyCode === KeyCode.KEY_A && (e as any).ctrlKey) g?.selectAllArmy();

        // 1..5 pick a group, shift/ctrl + 1..5 assign the current selection
        const digit = e.keyCode - KeyCode.DIGIT_1;
        if (digit >= 0 && digit <= 4 && g) {
            const mod = (e as any).shiftKey || (e as any).ctrlKey || (e as any).metaKey;
            if (mod) {
                g.setGroup(digit);
                this.ui.activeGroup = digit;
            } else if (g.selectGroup(digit)) {
                this.ui.activeGroup = digit;
            }
        }
    }

    private onKeyUp(e: EventKeyboard) {
        this.keys.delete(e.keyCode);
    }

    /* ------------------------------------------------------------ */
    /* long press                                                    */
    /* ------------------------------------------------------------ */
    private checkLongPress() {
        if (this.ui.mode !== 'game' || this.multi) return;
        if (this.ui.overlay.radialOpen) return;
        const t = this.mousePointer || (this.touches.size === 1 ? Array.from(this.touches.values())[0] : null);
        if (!t || t.longFired || t.moved) return;
        if (Date.now() - t.t < LONG_PRESS_MS) return;
        t.longFired = true;

        // long press on the group strip = assign selection to that group
        if (t.group >= 0) {
            this.game?.setGroup(t.group);
            this.ui.activeGroup = t.group;
            this.vibrate();
            return;
        }
        // long press on a production card = fill the queue
        if (this.ui.mode === 'game' && this.ui.handleLongPress(t.sx, t.sy)) {
            this.vibrate();
            return;
        }
        if (t.onUI || !this.game) return;
        this.openCommandWheel(t.sx, t.sy);
        this.vibrate();
    }

    private openCommandWheel(x: number, y: number) {
        const g = this.game;
        if (!g) return;
        const items: RadialItem[] = [];
        const sel = g.selection;
        const hasUnits = sel.length > 0;
        const b = g.selectedBuilding;
        const combat = sel.some(u => !u.isHarvester && !u.isEngineer && !u.isMcv);
        const harv = sel.some(u => u.isHarvester);
        const mcv = sel.some(u => u.isMcv);

        if (b && !hasUnits) {
            items.push({ id: 'rally', label: '集结点', enabled: true });
            items.push({ id: 'repair', label: '维修', enabled: b.done && b.hp < b.maxHp });
            items.push({ id: 'sell', label: '拆除', enabled: b.done });
        } else if (hasUnits) {
            items.push({ id: 'stop', label: '停止', enabled: true });
            if (combat) {
                items.push({ id: 'attackmove', label: '攻移', enabled: true });
                items.push({ id: 'stance', label: '姿态', enabled: true });
            }
            if (harv) items.push({ id: 'harvest', label: '采集', enabled: true });
            if (mcv) items.push({ id: 'deploy', label: '部署', enabled: true });
            items.push({ id: 'scatter', label: '散开', enabled: true });
            items.push({ id: 'waypoint', label: g.waypointMode ? '路径·开' : '路径', enabled: true });
        } else {
            this.ui.toast('先选中单位或建筑', 'info');
            return;
        }
        this.ui.overlay.showRadial(x, y, items);
    }

    private runCommand(id: string) {
        const g = this.game;
        if (!g) return;
        if (id === 'stop') { g.orderStop(); this.ui.toast('部队停止', 'info'); }
        else if (id === 'attackmove') {
            this.ui.setAttackMoveMode(true);
            this.ui.toast('攻击移动：点击目标点', 'info');
        } else if (id === 'harvest') { g.orderHarvest(null); this.ui.toast('采集车前往最近矿脉', 'info'); }
        else if (id === 'rally') { this.ui.toast('点击地图空地设置集结点', 'info'); }
        else if (id === 'sell') { g.sellSelectedBuilding(); }
        else if (id === 'repair') { g.toggleRepair(); }
        else if (id === 'stance') { g.cycleStance(); }
        else if (id === 'scatter') { g.orderScatter(); this.ui.toast('部队散开', 'info'); }
        else if (id === 'deploy') { g.orderDeploy(); }
        else if (id === 'waypoint') {
            g.waypointMode = !g.waypointMode;
            this.ui.toast(g.waypointMode ? '路径模式：连续点击追加路径点' : '路径模式关闭', 'info');
        }
    }

    /* ------------------------------------------------------------ */
    /* super weapons                                                 */
    /* ------------------------------------------------------------ */
    private beginSuperWeapon(id: SuperWeaponId) {
        const g = this.game;
        if (!g) return;
        const st = g.swOf(g.human, id);
        if (!st) { this.ui.toast('尚未建造对应的超级武器', 'warn'); return; }
        if (!st.ready) { this.ui.toast(`${SUPER_WEAPONS[id].name} 充能中`, 'warn'); return; }
        g.beginSwTargeting(id);
        this.ui.setAttackMoveMode(false);
        this.ui.toast(`选择 ${SUPER_WEAPONS[id].name} 目标`, 'info');
    }

    /* ------------------------------------------------------------ */
    /* taps                                                          */
    /* ------------------------------------------------------------ */
    private handleTap(x: number, y: number) {
        // group strip lives above the HUD hooks so a second tap can jump the camera
        const gi = this.ui.mode === 'game' ? this.ui.overlay.groupAt(x, y) : -1;
        if (gi >= 0) {
            this.tapGroup(gi);
            return;
        }
        if (this.ui.onTap(x, y)) return;
        if (this.ui.mode !== 'game' || !this.game || !this.cam) return;
        const g = this.game;
        const w = this.cam.screenToWorld(x, y);

        /* ---- super weapon targeting ---- */
        if (g.swTargeting) {
            const id = g.swTargeting;
            if (g.launchSuperWeapon(id, w.x, w.y)) {
                g.cancelSwTargeting();
                this.ui.toast(`${SUPER_WEAPONS[id].name} 已发射`, 'good');
            } else {
                this.ui.toast('无法发射：电力不足或尚未就绪', 'warn');
            }
            return;
        }

        /* ---- structure placement ---- */
        if (g.buildMode) {
            const def = BUILDINGS[g.buildMode];
            const tx = Math.round((w.x + HALF - (def.size * TILE) / 2) / TILE);
            const ty = Math.round((w.y + HALF - (def.size * TILE) / 2) / TILE);
            g.confirmBuild(tx, ty);
            return;
        }

        /* ---- picking ---- */
        const picked = this.pickAt(w.x, w.y);
        if (picked) {
            const engineers = g.selection.filter(u => !u.dead && u.isEngineer);
            if (picked.isBuilding && engineers.length > 0) {
                if (picked.owner !== 0) {
                    g.orderCapture(picked);
                    this.ui.toast(`工兵前往接管 ${(picked as Building).def.name}`, 'info');
                    this.pushOrderFx(x, y, false);
                    return;
                }
                if (picked.hp < picked.maxHp) {
                    g.orderCapture(picked);
                    this.ui.toast('工兵前往抢修', 'info');
                    this.pushOrderFx(x, y, false);
                    return;
                }
            }
            if (picked.owner === 0) {
                if (picked.isBuilding) {
                    g.selectBuilding(picked as Building);
                    this.ui.tab = 'structure';
                    this.ui.activeGroup = -1;
                } else {
                    const u = picked as Unit;
                    const now = Date.now();
                    if (this.lastSelId === u.id && now - this.lastSelTime < 480) {
                        g.selectSameType(u, this.cam.viewBounds);
                        this.ui.toast('已选择屏幕内同类型单位', 'info');
                    } else {
                        g.selectUnit(u, false);
                    }
                    this.lastSelId = u.id;
                    this.lastSelTime = now;
                    this.ui.activeGroup = -1;
                }
            } else if (g.selection.length > 0) {
                if (g.selection.every(u => u.isEngineer)) {
                    this.ui.toast('工兵只能接管建筑', 'warn');
                    return;
                }
                g.orderAttack(picked);
                this.pushOrderFx(x, y, true);
            }
            return;
        }

        /* ---- empty ground ---- */
        if (g.selectedBuilding && g.selection.length === 0) {
            g.selectedBuilding.rally = { x: w.x, y: w.y };
            g.pushFx(w.x, w.y, 'spark', 0.5, 1);
            this.ui.toast('已设置集结点', 'info');
            return;
        }
        if (g.selection.length === 0) return;

        // light snapping: a near-miss on an enemy still becomes an attack order
        const enemy = this.snapEnemy(w.x, w.y);
        if (enemy && !g.selection.every(u => u.isEngineer)) {
            g.orderAttack(enemy);
            this.pushOrderFx(x, y, true);
            return;
        }
        // harvesters sent near a crystal start harvesting instead of parking
        if (g.selection.some(u => u.isHarvester) && !this.ui.attackMoveMode) {
            const node = this.snapCrystal(w.x, w.y);
            if (node) {
                g.orderHarvest(node);
                this.ui.toast('采集车前往矿脉', 'info');
                return;
            }
        }

        const attackMove = this.ui.attackMoveMode;
        if (this.attackMovePending) this.attackMovePending = false;
        if (attackMove) {
            g.orderAttackMove(w.x, w.y);
            this.ui.setAttackMoveMode(false);
            this.pushOrderFx(x, y, false);
        } else {
            g.orderMove(w.x, w.y, g.waypointMode);
            this.pushOrderFx(x, y, false);
        }
    }

    private tapGroup(gi: number) {
        const g = this.game;
        if (!g) return;
        const now = Date.now();
        if (this.lastGroup === gi && now - this.lastGroupTime < 430) {
            const c = g.groupCenter(gi);
            if (c) {
                this.cam?.focus(c.x, c.y);
                this.ui.toast(`视角移至第 ${gi + 1} 编队`, 'info');
            }
        } else if (g.selectGroup(gi)) {
            this.ui.activeGroup = gi;
        } else {
            this.ui.toast(`第 ${gi + 1} 编队为空 · 长按可编入`, 'warn');
            this.ui.activeGroup = -1;
        }
        this.lastGroup = gi;
        this.lastGroupTime = now;
    }

    private pushOrderFx(sx: number, sy: number, attack: boolean) {
        if (!this.cam || !this.game) return;
        const w = this.cam.screenToWorld(sx, sy);
        this.game.pushFx(w.x, w.y, attack ? 'boom' : 'spark', attack ? 0.35 : 0.4, attack ? 0.6 : 0.9);
    }

    private pickAt(wx: number, wy: number): Entity | null {
        const g = this.game!;
        const zoom = this.cam ? this.cam.zoom : 1;
        const unitPad = 16 / Math.max(0.4, zoom);
        let best: Entity | null = null;
        let bd = Infinity;
        for (const u of g.units) {
            if (u.dead) continue;
            if (!g.isVisibleTo(g.human, u)) continue;
            const d = Math.hypot(u.x - wx, u.y - wy);
            if (d < u.radius + unitPad && d < bd) { bd = d; best = u; }
        }
        if (best) return best;
        for (const b of g.buildings) {
            if (b.dead || !g.isVisibleTo(g.human, b)) continue;
            const half = (b.size * TILE) / 2 + 4 / Math.max(0.4, zoom);
            if (Math.abs(wx - b.x) < half && Math.abs(wy - b.y) < half) return b;
        }
        return null;
    }

    /** enemy within the snap radius (screen-space, so it feels the same at any zoom) */
    private snapEnemy(wx: number, wy: number): Entity | null {
        const g = this.game!;
        const r = SNAP_PX / Math.max(0.4, this.cam ? this.cam.zoom : 1);
        let best: Entity | null = null;
        let bd = Infinity;
        for (const u of g.units) {
            if (u.dead || u.owner === 0) continue;
            if (!g.isVisibleTo(g.human, u)) continue;
            const d = Math.hypot(u.x - wx, u.y - wy);
            if (d < r + u.radius && d < bd) { bd = d; best = u; }
        }
        if (best) return best;
        for (const b of g.buildings) {
            if (b.dead || b.owner === 0) continue;
            if (!g.isVisibleTo(g.human, b)) continue;
            const d = Math.hypot(b.x - wx, b.y - wy);
            if (d < r + b.radius && d < bd) { bd = d; best = b; }
        }
        return best;
    }

    private snapCrystal(wx: number, wy: number): CrystalNode | null {
        const g = this.game!;
        const r = SNAP_PX / Math.max(0.4, this.cam ? this.cam.zoom : 1) + TILE;
        let best: CrystalNode | null = null;
        let bd = Infinity;
        for (const n of g.terrain.nodes) {
            if (n.amount <= 0) continue;
            const d = Math.hypot(n.x - wx, n.y - wy);
            if (d < r && d < bd) { bd = d; best = n; }
        }
        return best;
    }

    private finishBox(t: Pointer) {
        this.ui.overlay.hideBox();
        const g = this.game;
        if (!g || !this.cam) return;
        const a = this.cam.screenToWorld(t.sx, t.sy);
        const b = this.cam.screenToWorld(t.lx, t.ly);
        const n = g.selectInRect(
            Math.min(a.x, b.x), Math.min(a.y, b.y),
            Math.max(a.x, b.x), Math.max(a.y, b.y),
        );
        this.ui.activeGroup = -1;
        if (n === 0) g.clearSelection();
        else this.ui.toast(`框选 ${n} 个单位`, 'info');
    }

    private vibrate() {
        try {
            const anyObj = globalThis as any;
            if (anyObj.wx && typeof anyObj.wx.vibrateShort === 'function') {
                anyObj.wx.vibrateShort({ type: 'light' });
                return;
            }
            if (anyObj.navigator && typeof anyObj.navigator.vibrate === 'function') {
                anyObj.navigator.vibrate(10);
            }
        } catch (e) { /* haptics are best-effort */ }
    }

    /* ------------------------------------------------------------ */
    /* lifecycle                                                     */
    /* ------------------------------------------------------------ */
    private disposeGame() {
        if (this.worldNode) { this.worldNode.destroy(); this.worldNode = null; }
        if (this.ghost) { this.ghost.destroy(); this.ghost = null; }
        if (this.swGhost) { this.swGhost.destroy(); this.swGhost = null; }
        this.game = null;
        this.renderer = null;
        this.cam = null;
        if (this.ui) { this.ui.game = null; this.ui.cam = null; }
    }

    private startGame(faction: Faction, diff: 'easy' | 'normal' | 'hard', credits = 4200, superWeapons = true) {
        this.ensureAudio();
        this.faction = faction;
        this.diff = diff;
        this.credits = credits;
        this.superWeapons = superWeapons;
        this.disposeGame();
        const seed = (Math.random() * 1000000) | 0;
        const game = new Game(seed, faction, diff, {
            onMessage: (t, k) => this.ui.toast(t, k),
            onGameOver: (win) => this.onGameOver(win),
            onSfx: (name, x, y) => {
                let gain = 1;
                if (x !== undefined && y !== undefined && this.cam) {
                    gain = clamp(1 - dist(x, y, this.cam.x, this.cam.y) / 1500, 0, 1);
                }
                sfx.play(name, gain);
            },
            onShake: (strength) => this.cam?.addShake(strength),
        }, { credits, superWeapons, crates: true });
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
        app.activeGroup = -1;
        app.tab = 'structure';
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
        this.ui.overlay.hideRadial();
        this.ui.overlay.hideBox();
        this.ui.showPause();
    }

    private resume() {
        if (this.ui.mode !== 'paused') return;
        this.ui.hideModal();
        this.ui.mode = 'game';
    }

    private onGameOver(win: boolean) {
        if (!this.game) return;
        this.ui.overlay.hideRadial();
        this.ui.overlay.hideBox();
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
            this.checkLongPress();
            this.handleKeyboardPan(step);
            this.game.update(step);
            this.cam?.update(step);
            this.renderer?.sync(step, this.cam!.viewBounds);
            this.ui.refresh(step);
            this.updateGhost();
            this.updateSwGhost();
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

    /** super weapon aim circle */
    private swGhost: Node | null = null;
    private updateSwGhost() {
        const g = this.game;
        if (!g || !this.cam) return;
        if (!g.swTargeting) {
            if (this.swGhost) { this.swGhost.destroy(); this.swGhost = null; }
            return;
        }
        if (!this.swGhost) this.swGhost = gfxNode(this.renderer!.root, 'swghost').node;
        const w = this.lastPointerWorld();
        const def = SUPER_WEAPONS[g.swTargeting];
        this.swGhost.setPosition(w.x, w.y, 0);
        const gr = this.swGhost.getComponent(Graphics)!;
        gr.clear();
        gr.circle(0, 0, def.radius);
        gr.fillColor = new Color(63, 217, 236, 30);
        gr.fill();
        gr.circle(0, 0, def.radius);
        gr.strokeColor = new Color(63, 217, 236, 210);
        gr.lineWidth = 2;
        gr.stroke();
        gr.circle(0, 0, 10);
        gr.strokeColor = new Color(255, 255, 255, 210);
        gr.lineWidth = 1.4;
        gr.stroke();
    }

    private lastPointerWorld() {
        const p = this.touches.size > 0 ? Array.from(this.touches.values())[0] : this.mousePointer;
        if (p && this.cam) {
            const w = this.cam.screenToWorld(p.lx, p.ly);
            this.lastBuildWorld.x = w.x;
            this.lastBuildWorld.y = w.y;
            return w;
        }
        // between touches, keep the ghost where the player last pointed
        if (this.lastBuildWorld.x !== null && this.lastBuildWorld.y !== null) {
            return { x: this.lastBuildWorld.x, y: this.lastBuildWorld.y };
        }
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
