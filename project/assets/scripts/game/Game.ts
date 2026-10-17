/**
 * Game — the simulation core.
 * Owns the world, the two players, orders, combat, economy, fog and win state.
 * No rendering code lives here: the view layer subscribes through GameEvents.
 */
import {
    BUILDINGS, UNITS, Faction, BuildingDef, UnitDef, START_CREDITS, TILE, HALF, MAP_TILES,
    DMG_TABLE, TECH_BUILDING, QUEUE_MAX, UNLOAD_TIME, MAX_CREDITS, FactionDef, FACTIONS,
    tileToWorld, dist, clamp,
} from '../core/Core';
import { TerrainMap, CrystalNode } from '../world/Terrain';
import { PathFinder } from '../world/Path';
import { Unit, Building, Projectile, Fx, Entity, SpatialGrid, PlayerId } from './Entities';
import { AIController } from './AI';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type GamePhase = 'playing' | 'won' | 'lost';

export interface GameEvents {
    onSpawn?: (e: Entity) => void;
    onDeath?: (e: Entity) => void;
    onFx?: (fx: Fx) => void;
    onMessage?: (text: string, kind?: string) => void;
    onFogDirty?: () => void;
    onGameOver?: (win: boolean) => void;
}

export interface PlayerState {
    id: PlayerId;
    faction: Faction;
    credits: number;
    /* fog of war */
    visible: Uint8Array;
    explored: Uint8Array;
    /* stats */
    earned: number;
    built: number;
    lost: number;
    kills: number;
    ai: AIController | null;
    defeated: boolean;
    isHuman: boolean;
}

const REVEAL_TICK = 0.22;

export class Game {
    terrain: TerrainMap;
    finder: PathFinder;
    grid = new SpatialGrid();
    units: Unit[] = [];
    buildings: Building[] = [];
    projectiles: Projectile[] = [];
    fx: Fx[] = [];
    players: PlayerState[] = [];
    time = 0;
    phase: GamePhase = 'playing';
    difficulty: Difficulty = 'normal';
    events: GameEvents = {};

    /** player 0 = human */
    selection: Unit[] = [];
    selectedBuilding: Building | null = null;
    buildMode: string | null = null;
    buildTile = { tx: 0, ty: 0 };

    private revealTimer = 0;
    private tmp: Entity[] = [];
    private nodeClaim: Record<number, number> = {};

    constructor(seed: number, humanFaction: Faction, difficulty: Difficulty, events: GameEvents) {
        this.terrain = new TerrainMap();
        this.terrain.generate(seed);
        this.finder = new PathFinder((tx, ty) => this.isBlocked(tx, ty));
        this.difficulty = difficulty;
        this.events = events;

        const enemyFaction: Faction = humanFaction === 'BU' ? 'DS' : 'BU';
        this.players = [
            this.newPlayer(0, humanFaction, true),
            this.newPlayer(1, enemyFaction, false),
        ];
        this.setupBase(0);
        this.setupBase(1);
        this.players[1].ai = new AIController(this, 1, difficulty);
        this.updateVisibility(this.players[0]);
        this.updateVisibility(this.players[1]);
        this.revealAll(this.players[1]);
    }

    /* ------------------------------------------------------------ */
    /* setup                                                         */
    /* ------------------------------------------------------------ */
    private newPlayer(id: PlayerId, faction: Faction, human: boolean): PlayerState {
        return {
            id, faction, credits: START_CREDITS,
            visible: new Uint8Array(MAP_TILES * MAP_TILES),
            explored: new Uint8Array(MAP_TILES * MAP_TILES),
            earned: 0, built: 0, lost: 0, kills: 0,
            ai: null, defeated: false, isHuman: human,
        };
    }

    get human() { return this.players[0]; }
    get enemy() { return this.players[1]; }
    get factionDef(): FactionDef { return FACTIONS[this.human.faction]; }

    private setupBase(pid: PlayerId) {
        const p = this.players[pid];
        const f = FACTIONS[p.faction];
        const bx = pid === 0 ? 11 : MAP_TILES - 12;
        const by = MAP_TILES / 2;
        const coreDef = BUILDINGS[f.core];
        const dropDef = p.faction === 'BU' ? BUILDINGS.sluice : BUILDINGS.market;
        const powDef = p.faction === 'BU' ? BUILDINGS.furnace : BUILDINGS.sunwell;
        const barDef = p.faction === 'BU' ? BUILDINGS.barracks : BUILDINGS.tent;

        this.place(coreDef, pid, bx - 2, by - 2, true);
        this.place(powDef, pid, bx + 2, by + 1, true);
        this.place(dropDef, pid, bx + 2, by - 5, true);
        this.place(barDef, pid, bx - 4, by - 6, true);

        // units start on open ground south of the command core, never on top of it
        const coreY = (by - 2) * TILE + 2 * TILE - HALF;
        const frontY = coreY - 2 * TILE - 44;
        const hDef = UNITS[f.harvester];
        for (let i = 0; i < 2; i++) {
            this.spawnUnit(pid, hDef, bx * TILE + TILE / 2 - HALF - 34 + i * 34, frontY);
        }
        const infDef = UNITS[p.faction === 'BU' ? 'pebble' : 'sandfly'];
        for (let i = 0; i < 3; i++) {
            this.spawnUnit(pid, infDef, bx * TILE + TILE / 2 - HALF - 46 + i * 30, frontY - 44);
        }
        // player starts with a bit of vision around the base only
        p.credits = START_CREDITS;
    }

    place(def: BuildingDef, owner: PlayerId, tx: number, ty: number, instant = true): Building {
        const b = new Building(def, owner, tx, ty, instant ? 1 : 0.03);
        this.buildings.push(b);
        this.events.onSpawn?.(b);
        return b;
    }

    spawnUnit(owner: PlayerId, def: UnitDef, x: number, y: number): Unit {
        const u = new Unit(def, owner, clamp(x, -HALF + 20, HALF - 20), clamp(y, -HALF + 20, HALF - 20));
        u.owner = owner;
        this.units.push(u);
        this.players[owner].built++;
        this.events.onSpawn?.(u);
        return u;
    }

    /* ------------------------------------------------------------ */
    /* queries                                                       */
    /* ------------------------------------------------------------ */
    buildingAt(tx: number, ty: number): Building | null {
        for (const b of this.buildings) {
            if (b.dead) continue;
            if (b.occupies(tx, ty)) return b;
        }
        return null;
    }

    isBlocked(tx: number, ty: number) {
        if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return true;
        if (this.terrain.isSolid(tx, ty)) return true;
        return this.buildingAt(tx, ty) !== null;
    }

    myUnits(p: PlayerState) { return this.units.filter(u => !u.dead && u.owner === p.id); }
    myBuildings(p: PlayerState) { return this.buildings.filter(b => !b.dead && b.owner === p.id); }

    countBuilding(p: PlayerState, id: string) {
        let n = 0;
        for (const b of this.buildings) if (!b.dead && b.owner === p.id && b.def.id === id && b.done) n++;
        return n;
    }

    hasTech(p: PlayerState, level: number) {
        if (level <= 0) return true;
        const tb = TECH_BUILDING[p.faction];
        if (this.countBuilding(p, tb) === 0) return false;
        if (level >= 3) return this.countBuilding(p, tb) > 0;
        return true;
    }

    power(p: PlayerState) {
        let made = 0, used = 0;
        for (const b of this.buildings) {
            if (b.dead || b.owner !== p.id || !b.done) continue;
            if (b.def.power >= 0) made += b.def.power;
            else used -= b.def.power;
        }
        return { made, used, ok: made >= used };
    }

    /** how fast production runs right now (power shortage slows it down) */
    prodFactor(p: PlayerState) {
        const pw = this.power(p);
        return pw.ok ? 1 : 0.55;
    }

    isVisibleTo(p: PlayerState, e: Entity) {
        if (e.owner === p.id) return true;
        const tx = Math.floor((e.x + HALF) / TILE);
        const ty = Math.floor((e.y + HALF) / TILE);
        if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return false;
        const i = ty * MAP_TILES + tx;
        if (e.isBuilding) return p.explored[i] === 1;
        return p.visible[i] === 1;
    }

    /* ------------------------------------------------------------ */
    /* building placement                                            */
    /* ------------------------------------------------------------ */
    canPlace(def: BuildingDef, tx: number, ty: number): { ok: boolean; reason: string } {
        if (tx < 0 || ty < 0 || tx + def.size > MAP_TILES || ty + def.size > MAP_TILES) {
            return { ok: false, reason: '超出地图边界' };
        }
        for (let y = ty; y < ty + def.size; y++) {
            for (let x = tx; x < tx + def.size; x++) {
                if (this.terrain.isSolid(x, y)) return { ok: false, reason: '地形无法建造' };
                if (this.buildingAt(x, y)) return { ok: false, reason: '与建筑重叠' };
            }
        }
        return { ok: true, reason: '' };
    }

    beginBuild(defId: string) {
        const def = BUILDINGS[defId];
        if (!def) return;
        if (this.human.credits < def.cost) {
            this.events.onMessage?.('晶体不足', 'warn');
            return;
        }
        this.buildMode = defId;
    }

    cancelBuild() { this.buildMode = null; }

    confirmBuild(tx: number, ty: number): boolean {
        if (!this.buildMode) return false;
        const def = BUILDINGS[this.buildMode];
        const check = this.canPlace(def, tx, ty);
        if (!check.ok) {
            this.events.onMessage?.(check.reason, 'warn');
            return false;
        }
        if (this.human.credits < def.cost) {
            this.events.onMessage?.('晶体不足', 'warn');
            return false;
        }
        this.human.credits -= def.cost;
        const b = this.place(def, 0, tx, ty, false);
        this.buildMode = null;
        this.events.onMessage?.(`开始建造 ${def.name}`, 'info');
        this.pushFx(b.x, b.y, 'build', 0.7, b.size);
        return true;
    }

    sellSelectedBuilding() {
        const b = this.selectedBuilding;
        if (!b || b.dead || !b.done) return;
        const refund = Math.floor(b.def.cost * 0.5);
        this.human.credits = Math.min(MAX_CREDITS, this.human.credits + refund);
        b.dead = true;
        this.events.onDeath?.(b);
        this.selectedBuilding = null;
        this.events.onMessage?.(`拆除 ${b.def.name}，回收 ${refund} 晶体`, 'info');
    }

    /* ------------------------------------------------------------ */
    /* unit orders                                                   */
    /* ------------------------------------------------------------ */
    clearSelection() {
        this.selection.length = 0;
        this.selectedBuilding = null;
    }

    selectUnit(u: Unit, additive = false) {
        if (!additive) { this.selection.length = 0; this.selectedBuilding = null; }
        if (this.selection.indexOf(u) < 0) this.selection.push(u);
    }

    selectBuilding(b: Building) {
        this.selection.length = 0;
        this.selectedBuilding = b;
    }

    selectAllArmy() {
        this.selectedBuilding = null;
        this.selection.length = 0;
        for (const u of this.units) {
            if (u.dead || u.owner !== 0 || u.isHarvester) continue;
            this.selection.push(u);
        }
        if (this.selection.length === 0) {
            for (const u of this.units) if (!u.dead && u.owner === 0) this.selection.push(u);
        }
    }

    selectSameType(u: Unit) {
        this.selectedBuilding = null;
        const keep = this.selection.filter(s => s.def.id === u.def.id);
        if (keep.length === 0) {
            this.selection.length = 0;
            for (const o of this.units) if (!o.dead && o.owner === 0 && o.def.id === u.def.id) this.selection.push(o);
        } else {
            this.selection.length = 0;
            for (const o of this.units) if (!o.dead && o.owner === 0 && o.def.id === u.def.id) this.selection.push(o);
        }
    }

    orderMove(x: number, y: number) {
        if (this.selection.length === 0) return;
        const n = this.selection.length;
        const cols = Math.ceil(Math.sqrt(n));
        const gap = 30;
        let i = 0;
        for (const u of this.selection) {
            if (u.dead) continue;
            const gx = i % cols - (cols - 1) / 2;
            const gy = -Math.floor(i / cols) + (Math.ceil(n / cols) - 1) / 2;
            const tx = x + gx * gap;
            const ty = y + gy * gap;
            this.moveUnitTo(u, tx, ty, false);
            i++;
        }
        this.pushFx(x, y, 'spark', 0.45, 0.7);
    }

    orderAttack(target: Entity) {
        if (this.selection.length === 0) return;
        for (const u of this.selection) {
            if (u.dead) continue;
            u.order = { k: 'attack', target };
            u.stop();
        }
    }

    /** single-unit variants used by the AI */
    orderAttackFor(u: Unit, target: Entity) {
        if (u.dead) return;
        u.order = { k: 'attack', target };
        u.stop();
    }

    orderAttackMoveFor(u: Unit, x: number, y: number) {
        if (u.dead) return;
        u.order = { k: 'attackmove', x, y };
        this.moveUnitTo(u, x, y, true);
    }

    orderMoveFor(u: Unit, x: number, y: number) {
        if (u.dead) return;
        this.moveUnitTo(u, x, y, false);
    }

    orderAttackMove(x: number, y: number) {
        if (this.selection.length === 0) return;
        for (const u of this.selection) {
            if (u.dead) continue;
            u.order = { k: 'attackmove', x, y };
            this.moveUnitTo(u, x, y, true);
        }
    }

    orderStop() {
        for (const u of this.selection) {
            if (u.dead) continue;
            u.order = { k: 'idle' };
            u.stop();
        }
    }

    orderHarvest(node: CrystalNode | null) {
        for (const u of this.selection) {
            if (u.dead) continue;
            if (u.isHarvester) this.startHarvest(u, node);
        }
    }

    private moveUnitTo(u: Unit, x: number, y: number, keepOrder: boolean) {
        x = clamp(x, -HALF + 24, HALF - 24);
        y = clamp(y, -HALF + 24, HALF - 24);
        if (!keepOrder) u.order = { k: 'move', x, y };
        if (u.isAir) {
            u.path = [{ x, y }];
        } else {
            const path = this.finder.find(u.x, u.y, x, y);
            u.path = path ? path : [{ x, y }];
        }
        u.repath = 4;
    }

    private startHarvest(u: Unit, node: CrystalNode | null) {
        const target = node || this.nearestNode(u.x, u.y);
        u.order = { k: 'harvest', node: target, phase: 'seek', timer: 0 };
        u.mineNode = target;
        u.stop();
    }

    nearestNode(x: number, y: number, exclude: CrystalNode | null = null): CrystalNode | null {
        let best: CrystalNode | null = null;
        let bd = Infinity;
        for (const n of this.terrain.nodes) {
            if (n.amount <= 0) continue;
            if (exclude && n.id === exclude.id) continue;
            const d = dist(x, y, n.x, n.y);
            if (d < bd) { bd = d; best = n; }
        }
        return best;
    }

    nearestDropoff(p: PlayerState, x: number, y: number): Building | null {
        let best: Building | null = null;
        let bd = Infinity;
        for (const b of this.buildings) {
            if (b.dead || b.owner !== p.id || !b.def.dropoff || !b.done) continue;
            const d = dist(x, y, b.x, b.y);
            if (d < bd) { bd = d; best = b; }
        }
        return best;
    }

    /* ------------------------------------------------------------ */
    /* production                                                    */
    /* ------------------------------------------------------------ */
    availableUnits(b: Building): UnitDef[] {
        if (!b.def.produces) return [];
        const p = this.players[b.owner];
        const out: UnitDef[] = [];
        for (const id of b.def.produces) {
            const def = UNITS[id];
            if (!def) continue;
            if (def.faction !== p.faction) continue;
            if (!this.hasTech(p, def.tech)) continue;
            out.push(def);
        }
        return out;
    }

    enqueue(b: Building, defId: string) {
        if (b.dead || !b.done) return;
        const p = this.players[b.owner];
        const def = UNITS[defId];
        if (!def) return;
        if (b.queue.length >= QUEUE_MAX) {
            if (p.isHuman) this.events.onMessage?.('生产队列已满', 'warn');
            return;
        }
        if (p.credits < def.cost) {
            if (p.isHuman) this.events.onMessage?.('晶体不足', 'warn');
            return;
        }
        if (def.kind === 'harvester' && b.def.isCore) {
            // core can always build harvesters
        }
        p.credits -= def.cost;
        b.queue.push({ defId, t: 0, total: def.time });
    }

    cancelQueue(b: Building, index: number) {
        if (index < 0 || index >= b.queue.length) return;
        const item = b.queue[index];
        const p = this.players[b.owner];
        const def = UNITS[item.defId];
        const refund = Math.floor(def.cost * (index === 0 ? 1 : 1));
        p.credits = Math.min(MAX_CREDITS, p.credits + refund);
        b.queue.splice(index, 1);
    }

    private spawnPointFor(b: Building): { x: number; y: number } {
        if (b.rally) return { x: b.rally.x, y: b.rally.y };
        const off = (b.size * TILE) / 2 + 22;
        return { x: b.x, y: b.y - off };
    }

    /* ------------------------------------------------------------ */
    /* main update                                                   */
    /* ------------------------------------------------------------ */
    update(dt: number) {
        if (this.phase !== 'playing') return;
        this.time += dt;

        this.grid.clear();
        for (const u of this.units) if (!u.dead) this.grid.insert(u);

        this.updateBuildings(dt);
        this.updateUnits(dt);
        this.applySeparation(dt);
        this.updateProjectiles(dt);
        this.updateFx(dt);

        this.players[1].ai?.update(dt);

        this.revealTimer += dt;
        if (this.revealTimer >= REVEAL_TICK) {
            this.revealTimer = 0;
            this.updateVisibility(this.players[0]);
            this.updateVisibility(this.players[1]);
            this.events.onFogDirty?.();
        }

        // reap dead entities
        if (this.units.some(u => u.dead)) {
            for (let i = this.units.length - 1; i >= 0; i--) {
                if (this.units[i].dead) this.units.splice(i, 1);
            }
            this.selection = this.selection.filter(u => !u.dead);
        }
        if (this.buildings.some(b => b.dead)) {
            for (let i = this.buildings.length - 1; i >= 0; i--) {
                if (this.buildings[i].dead) this.buildings.splice(i, 1);
            }
            if (this.selectedBuilding && this.selectedBuilding.dead) this.selectedBuilding = null;
        }

        this.checkVictory();
    }

    private updateBuildings(dt: number) {
        for (const b of this.buildings) {
            if (b.dead) continue;
            const p = this.players[b.owner];
            b.pulse += dt;

            if (!b.done) {
                b.progress += dt / Math.max(1, b.def.time);
                if (b.progress >= 1) {
                    b.progress = 1;
                    b.hp = b.def.hp;
                    this.pushFx(b.x, b.y, 'spawn', 0.6, b.size);
                    if (p.isHuman) this.events.onMessage?.(`${b.def.name} 建造完成`, 'good');
                }
                b.hp = Math.max(b.hp, b.def.hp * Math.max(0.12, b.progress));
                continue;
            }

            // production
            if (b.queue.length > 0) {
                const item = b.queue[0];
                item.t += dt * this.prodFactor(p);
                if (item.t >= item.total) {
                    const def = UNITS[item.defId];
                    b.queue.shift();
                    const sp = this.spawnPointFor(b);
                    const u = this.spawnUnit(b.owner, def, sp.x, sp.y);
                    u.order = { k: 'idle' };
                    if (b.rally) this.moveUnitTo(u, b.rally.x, b.rally.y, true);
                    this.pushFx(sp.x, sp.y, 'spawn', 0.5, 1);
                }
            }

            // defensive weapon
            if (b.def.weapon) {
                b.cd -= dt * (this.prodFactor(p) < 1 ? 0.6 : 1);
                if (b.cd <= 0) {
                    const tgt = this.findTarget(b.x, b.y, b.def.weapon.range, b.owner, b.def.weapon.splash ? false : false);
                    if (tgt) {
                        this.fire(b, b.def.weapon, tgt);
                        b.cd = b.def.weapon.cd;
                    }
                }
            }
        }
    }

    private updateUnits(dt: number) {
        const speedMul = 1;
        for (const u of this.units) {
            if (u.dead) continue;
            if (u.hitFlash > 0) u.hitFlash -= dt;
            u.bob += dt;

            if (u.isHarvester) {
                this.updateHarvester(u, dt);
            } else {
                this.updateCombatant(u, dt, speedMul);
            }

            // weapon cooldown
            if (u.cd > 0) u.cd -= dt * (this.prodFactor(this.players[u.owner]) < 1 ? 0.65 : 1);

            // stuck detection for ground units
            if (u.path.length > 0 && u.repath > 0) {
                u.repath -= dt;
                if (u.repath <= 0) {
                    u.path.length = 0;
                    if (u.order.k === 'move') {
                        const p = this.finder.find(u.x, u.y, u.order.x, u.order.y);
                        if (p) u.path = p;
                    }
                }
            }
        }
    }

    private updateCombatant(u: Unit, dt: number, speedMul: number) {
        const w = u.def.weapon;
        const o = u.order;

        if (o.k === 'attack') {
            const t = o.target;
            if (!t || t.dead) { u.order = { k: 'idle' }; return; }
            const d = dist(u.x, u.y, t.x, t.y);
            const range = (w ? w.range : 90) * 0.92 + (t.isBuilding ? t.radius * 0.7 : t.radius);
            if (d > range) {
                if (u.path.length === 0 || u.repath <= 0) {
                    const p = this.finder.find(u.x, u.y, t.x, t.y);
                    if (p) { u.path = p; u.repath = 1.2; }
                }
                u.moveStep(dt, speedMul);
            } else {
                u.stop();
                if (w && u.cd <= 0) { this.fire(u, w, t); u.cd = w.cd; }
            }
            return;
        }

        if (o.k === 'attackmove') {
            // engage anything in range on the way
            if (w) {
                const t = this.findTarget(u.x, u.y, w.range * 0.95, u.owner);
                if (t) {
                    u.stop();
                    if (u.cd <= 0) { this.fire(u, w, t); u.cd = w.cd; }
                    return;
                }
            }
            if (u.path.length > 0) u.moveStep(dt, speedMul);
            else u.order = { k: 'idle' };
            return;
        }

        if (o.k === 'move') {
            if (u.path.length > 0) {
                u.moveStep(dt, speedMul);
            } else {
                u.order = { k: 'idle' };
            }
            return;
        }

        // idle / guard: engage nearby enemies without chasing far
        if (w) {
            const t = this.findTarget(u.x, u.y, w.range * 0.95, u.owner);
            if (t) {
                if (u.cd <= 0) { this.fire(u, w, t); u.cd = w.cd; }
                const d = dist(u.x, u.y, t.x, t.y);
                if (d > w.range * 0.85 && u.path.length === 0) {
                    const p = this.finder.find(u.x, u.y, t.x, t.y);
                    if (p) u.path = p;
                }
            }
        }
        if (u.path.length > 0) u.moveStep(dt, speedMul);
    }

    private updateHarvester(u: Unit, dt: number) {
        const p = this.players[u.owner];
        let o = u.order;
        if (o.k !== 'harvest') {
            o = { k: 'harvest', node: u.mineNode, phase: 'seek', timer: 0 };
            u.order = o;
        }
        const order = o as { k: 'harvest'; node: CrystalNode | null; phase: string; timer: number };

        switch (order.phase) {
            case 'seek': {
                let node = order.node;
                if (!node || node.amount <= 0) node = this.nearestNode(u.x, u.y);
                order.node = node;
                u.mineNode = node;
                if (!node) { u.order = { k: 'idle' }; return; }
                const pth = this.finder.find(u.x, u.y, node.x, node.y - TILE);
                u.path = pth || [{ x: node.x, y: node.y - TILE }];
                order.phase = 'toMine';
                order.timer = 0;
                break;
            }
            case 'toMine': {
                const node = order.node;
                if (!node || node.amount <= 0) { order.phase = 'seek'; return; }
                const d = dist(u.x, u.y, node.x, node.y);
                if (d < TILE * 2.2) {
                    order.phase = 'mining';
                    order.timer = u.def.mineTime || 3;
                    u.stop();
                    break;
                }
                if (u.path.length > 0) u.moveStep(dt, 1);
                else order.phase = 'seek';
                break;
            }
            case 'mining': {
                const node = order.node!;
                order.timer -= dt;
                const cargo = u.def.cargo || 500;
                const rate = cargo / Math.max(0.5, u.def.mineTime || 3);
                u.cargo = Math.min(cargo, u.cargo + rate * dt);
                if (node) {
                    node.amount -= rate * dt;
                    if (node.amount < 0) node.amount = 0;
                }
                if (order.timer <= 0 || u.cargo >= cargo || !node || node.amount <= 0) {
                    const drop = this.nearestDropoff(p, u.x, u.y);
                    if (drop) {
                        const pth = this.finder.find(u.x, u.y, drop.x, drop.y + drop.radius + 14);
                        u.path = pth || [{ x: drop.x, y: drop.y + drop.radius + 14 }];
                        order.phase = 'toBase';
                    } else {
                        order.phase = 'seek';
                    }
                }
                break;
            }
            case 'toBase': {
                const drop = this.nearestDropoff(p, u.x, u.y);
                if (!drop) { order.phase = 'seek'; return; }
                if (dist(u.x, u.y, drop.x, drop.y) < drop.radius + 34) {
                    order.phase = 'unload';
                    order.timer = UNLOAD_TIME;
                    u.stop();
                    break;
                }
                if (u.path.length > 0) u.moveStep(dt, 1);
                else {
                    const pth = this.finder.find(u.x, u.y, drop.x, drop.y + drop.radius + 14);
                    u.path = pth || [];
                    if (u.path.length === 0) order.phase = 'seek';
                }
                break;
            }
            case 'unload': {
                order.timer -= dt;
                if (order.timer <= 0) {
                    const gain = Math.floor(u.cargo);
                    p.credits = Math.min(MAX_CREDITS, p.credits + gain);
                    p.earned += gain;
                    u.cargo = 0;
                    order.phase = 'seek';
                    order.node = order.node && order.node.amount > 0 ? order.node : null;
                }
                break;
            }
        }
    }

    /* ------------------------------------------------------------ */
    /* combat                                                        */
    /* ------------------------------------------------------------ */
    findTarget(x: number, y: number, range: number, owner: PlayerId, preferBuildings = false): Entity | null {
        this.grid.query(x, y, range + 40, this.tmp);
        let best: Entity | null = null;
        let bestScore = Infinity;
        for (const e of this.tmp) {
            if (e.dead || e.owner === owner) continue;
            const d = dist(x, y, e.x, e.y);
            if (d > range + (e.isBuilding ? (e as Building).radius : e.armor === 'air' ? 10 : 8)) continue;
            let score = d;
            if (preferBuildings && e.isBuilding) score *= 0.6;
            if (score < bestScore) { bestScore = score; best = e; }
        }
        // buildings are not in the spatial grid
        if (!best) {
            for (const b of this.buildings) {
                if (b.dead || b.owner === owner) continue;
                const d = dist(x, y, b.x, b.y);
                if (d < range + b.radius) { best = b; break; }
            }
        }
        return best;
    }

    fire(src: Unit | Building, w: UnitDef['weapon'], target: Entity) {
        if (!w) return;
        const ox = src.x;
        const oy = src.y - (src instanceof Unit && src.isAir ? 0 : 8);
        const d = dist(ox, oy, target.x, target.y);
        const speed = w.proj === 'bullet' ? 900 : w.proj === 'shell' ? 420 : w.proj === 'rocket' ? 330 : 260;
        const dur = Math.max(0.06, d / speed);
        const p = new Projectile({
            x: ox, y: oy, tx: target.x, ty: target.y, dur, kind: w.proj,
            owner: (src as any).owner, dmg: w.dmg, dmgType: w.type, splash: w.splash, target,
        });
        this.projectiles.push(p);
        this.pushFx(ox, oy, 'muzzle', 0.12, w.proj === 'bullet' ? 0.5 : 0.9);
        if (src instanceof Unit && src.def.kind === 'infantry') {
            src.face = Math.atan2(target.y - src.y, target.x - src.x);
        }
    }

    private updateProjectiles(dt: number) {
        for (const pr of this.projectiles) {
            if (pr.dead) continue;
            pr.step(dt);
            if (pr.dead) this.impact(pr);
        }
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            if (this.projectiles[i].dead) this.projectiles.splice(i, 1);
        }
    }

    private impact(pr: Projectile) {
        const t = pr.target;
        if (t && !t.dead) {
            this.damage(t, pr.dmg, pr.dmgType, pr.owner);
        } else {
            // shoot the ground where it landed
            this.grid.query(pr.tx, pr.ty, 24, this.tmp);
            for (const e of this.tmp) {
                if (e.dead || e.owner === pr.owner) continue;
                this.damage(e, pr.dmg * 0.5, pr.dmgType, pr.owner);
            }
            for (const b of this.buildings) {
                if (b.dead || b.owner === pr.owner) continue;
                if (dist(pr.tx, pr.ty, b.x, b.y) < b.radius) { this.damage(b, pr.dmg * 0.5, pr.dmgType, pr.owner); }
            }
        }
        if (pr.splash > 0) {
            this.grid.query(pr.tx, pr.ty, pr.splash, this.tmp);
            for (const e of this.tmp) {
                if (e.dead) continue;
                const d = dist(pr.tx, pr.ty, e.x, e.y);
                if (d > pr.splash) continue;
                const k = 1 - (d / pr.splash) * 0.65;
                if (t && e.id === t.id) continue;
                this.damage(e, pr.dmg * 0.65 * k, pr.dmgType, pr.owner);
            }
            for (const b of this.buildings) {
                if (b.dead) continue;
                if (t && b.id === t.id) continue;
                const d = dist(pr.tx, pr.ty, b.x, b.y);
                if (d > pr.splash + b.radius * 0.6) continue;
                this.damage(b, pr.dmg * 0.5, pr.dmgType, pr.owner);
            }
            this.pushFx(pr.tx, pr.ty, 'boom', 0.5, Math.min(2.2, pr.splash / 26));
        } else {
            this.pushFx(pr.tx, pr.ty, 'spark', 0.22, 0.7);
        }
    }

    damage(target: Entity, amount: number, type: 'small' | 'ap' | 'explosive', owner: PlayerId) {
        if (target.dead) return;
        const mult = DMG_TABLE[type][target.armor] ?? 1;
        const dmg = amount * mult;
        target.hp -= dmg;
        target.lastHit = this.time;
        target.hitFlash = 0.12;
        if (target.hp <= 0) this.kill(target, owner);
    }

    kill(e: Entity, killer: PlayerId) {
        if (e.dead) return;
        e.dead = true;
        e.hp = 0;
        this.players[e.owner].lost++;
        if (killer !== e.owner) this.players[killer].kills++;
        this.pushFx(e.x, e.y, 'boom', e.isBuilding ? 0.9 : 0.5, e.isBuilding ? (e as Building).size * 0.9 : 1.3);
        this.events.onDeath?.(e);
    }

    pushFx(x: number, y: number, kind: Fx['kind'], life: number, scale: number) {
        const f = new Fx(x, y, kind, life, scale);
        this.fx.push(f);
        this.events.onFx?.(f);
    }

    private updateFx(dt: number) {
        for (const f of this.fx) f.step(dt);
        for (let i = this.fx.length - 1; i >= 0; i--) if (this.fx[i].dead) this.fx.splice(i, 1);
    }

    private applySeparation(dt: number) {
        const tmp: Entity[] = [];
        const maxPush = 60 * dt;
        for (const u of this.units) {
            if (u.dead || u.isAir) continue;
            this.grid.query(u.x, u.y, u.radius * 3, tmp);
            for (const e of tmp) {
                const o = e as Unit;
                if (o === u || o.dead || !o.def || o.isAir) continue;
                const dx = u.x - o.x;
                const dy = u.y - o.y;
                const d2 = dx * dx + dy * dy;
                const rr = (u.radius + o.radius) * 0.92;
                if (d2 >= rr * rr || d2 < 0.001) continue;
                const d = Math.sqrt(d2);
                const push = Math.min(maxPush, (rr - d) * 0.5);
                u.x += (dx / d) * push;
                u.y += (dy / d) * push;
            }
            u.x = clamp(u.x, -HALF + 12, HALF - 12);
            u.y = clamp(u.y, -HALF + 12, HALF - 12);
        }
    }

    /* ------------------------------------------------------------ */
    /* fog of war                                                    */
    /* ------------------------------------------------------------ */
    private reveal(p: PlayerState, x: number, y: number, rTiles: number) {
        const cx = Math.floor((x + HALF) / TILE);
        const cy = Math.floor((y + HALF) / TILE);
        const r = Math.ceil(rTiles);
        const r2 = rTiles * rTiles;
        for (let y2 = cy - r; y2 <= cy + r; y2++) {
            if (y2 < 0 || y2 >= MAP_TILES) continue;
            for (let x2 = cx - r; x2 <= cx + r; x2++) {
                if (x2 < 0 || x2 >= MAP_TILES) continue;
                const dx = x2 - cx, dy = y2 - cy;
                if (dx * dx + dy * dy > r2) continue;
                const i = y2 * MAP_TILES + x2;
                p.visible[i] = 1;
                p.explored[i] = 1;
            }
        }
    }

    updateVisibility(p: PlayerState) {
        p.visible.fill(0);
        for (const u of this.units) {
            if (u.dead || u.owner !== p.id) continue;
            this.reveal(p, u.x, u.y, u.def.sight);
        }
        for (const b of this.buildings) {
            if (b.dead || b.owner !== p.id) continue;
            this.reveal(p, b.x, b.y, b.def.sight);
        }
    }

    /** the AI does not cheat with vision but we keep its explored map fully lit */
    private revealAll(p: PlayerState) {
        p.explored.fill(1);
    }

    /* ------------------------------------------------------------ */
    /* win / lose                                                    */
    /* ------------------------------------------------------------ */
    private checkVictory() {
        if (this.phase !== 'playing') return;
        const humanCore = this.buildings.some(b => !b.dead && b.owner === 0 && b.def.isCore);
        const enemyCore = this.buildings.some(b => !b.dead && b.owner === 1 && b.def.isCore);
        if (!enemyCore) {
            this.phase = 'won';
            this.events.onGameOver?.(true);
        } else if (!humanCore) {
            this.phase = 'lost';
            this.events.onGameOver?.(false);
        }
    }

    /* ------------------------------------------------------------ */
    /* helpers for UI                                                */
    /* ------------------------------------------------------------ */
    availableBuildings(p: PlayerState): BuildingDef[] {
        const out: BuildingDef[] = [];
        for (const id in BUILDINGS) {
            const d = BUILDINGS[id];
            if (d.faction !== p.faction || d.isCore) continue;
            out.push(d);
        }
        return out;
    }

    missingRequirement(p: PlayerState, d: BuildingDef): string {
        // each building row in the tech chain needs a specific predecessor
        const need: Record<string, string> = {
            furnace: 'core', sluice: 'furnace', barracks: 'furnace', foundry: 'barracks',
            airpad: 'archive', turret: 'barracks', archive: 'foundry',
            sunwell: 'nest', market: 'sunwell', tent: 'sunwell', workshop: 'tent',
            strip: 'vault', spike: 'tent', vault: 'workshop',
        };
        const req = need[d.id];
        if (req) {
            const reqDef = BUILDINGS[req];
            if (this.countBuilding(p, req) === 0) return `需要 ${reqDef.name}`;
        }
        return '';
    }
}
