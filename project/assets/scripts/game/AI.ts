/**
 * Skirmish AI — a build-order driven opponent.
 * It plays by the same rules as the player (no resource cheats) but gets a
 * sharper build order and faster decision ticks on higher difficulties.
 */
import { BUILDINGS, UNITS, TILE, HALF, dist } from '../core/Core';
import { Building, Unit, Entity } from './Entities';
import type { Game, Difficulty, PlayerState } from './Game';

interface BuildStep { id: string; at?: 'base' | 'front'; }

export class AIController {
    private tick = 0;
    private buildCd = 3;
    private waveTimer = 0;
    private step = 0;
    private order: BuildStep[] = [];
    private army: Unit[] = [];
    private lastAttack = -999;

    constructor(private g: Game, private pid: number, private diff: Difficulty) {
        const p = this.g.players[this.pid];
        const bu = p.faction === 'BU';
        this.order = bu
            ? [
                { id: 'furnace' }, { id: 'barracks' }, { id: 'foundry' },
                { id: 'furnace' }, { id: 'sluice' }, { id: 'archive' },
                { id: 'turret' }, { id: 'airpad' }, { id: 'furnace' },
                { id: 'foundry' }, { id: 'turret' }, { id: 'sluice' },
            ]
            : [
                { id: 'sunwell' }, { id: 'tent' }, { id: 'workshop' },
                { id: 'sunwell' }, { id: 'market' }, { id: 'vault' },
                { id: 'spike' }, { id: 'strip' }, { id: 'sunwell' },
                { id: 'workshop' }, { id: 'spike' }, { id: 'market' },
            ];
        this.waveTimer = this.diff === 'hard' ? 55 : this.diff === 'normal' ? 80 : 110;
    }

    private get p(): PlayerState { return this.g.players[this.pid]; }

    private get aggression() {
        return this.diff === 'hard' ? 10 : this.diff === 'normal' ? 7 : 5;
    }

    update(dt: number) {
        if (this.g.phase !== 'playing') return;
        this.tick += dt;
        if (this.tick < 0.9) return;
        this.tick = 0;
        if (this.p.defeated) return;

        this.manageEconomy();
        this.manageProduction();
        this.buildCd -= 0.9;
        if (this.buildCd <= 0) {
            this.manageBuild();
            this.buildCd = this.diff === 'hard' ? 2.2 : 3.2;
        }
        this.manageArmy();
    }

    /* ---------------- economy ---------------- */
    private manageEconomy() {
        const harvesters = this.g.units.filter(u => !u.dead && u.owner === this.pid && u.isHarvester);
        const dropoffs = this.g.buildings.filter(b => !b.dead && b.owner === this.pid && b.def.dropoff).length;
        const want = Math.min(8, 2 + dropoffs * 2);
        const core = this.g.buildings.find(b => !b.dead && b.owner === this.pid && b.def.isCore);
        if (harvesters.length < want && core && core.queue.length === 0) {
            const hDef = UNITS[this.g.players[this.pid].faction === 'BU' ? 'hourglass' : 'scav'];
            if (this.p.credits >= hDef.cost * 1.6) this.g.enqueue(core, hDef.id);
        }
        // idle harvesters go back to work
        for (const h of harvesters) {
            if (h.order.k === 'idle') h.order = { k: 'harvest', node: null, phase: 'seek', timer: 0 };
        }
    }

    /* ---------------- production ---------------- */
    private armyCap() {
        return this.diff === 'hard' ? 34 : this.diff === 'normal' ? 26 : 18;
    }

    private manageProduction() {
        const reserve = 350;
        const army = this.g.units.filter(u => !u.dead && u.owner === this.pid && !u.isHarvester).length;
        if (army >= this.armyCap()) return;
        const mine = this.g.buildings.filter(b => !b.dead && b.owner === this.pid && b.done && b.def.produces);
        // put one unit into each empty queue, cheapest-value first
        for (const b of mine) {
            if (b.queue.length > 0) continue;
            if (b.def.isCore) continue;
            const opts = this.g.availableUnits(b);
            if (opts.length === 0) continue;
            // prefer the most expensive unit we can afford
            opts.sort((a, c) => c.cost - a.cost);
            for (const d of opts) {
                if (this.p.credits - d.cost >= reserve) {
                    this.g.enqueue(b, d.id);
                    break;
                }
            }
        }
    }

    /* ---------------- base building ---------------- */
    private manageBuild() {
        if (this.step >= this.order.length) {
            // late game: keep adding power and turrets
            const step = this.p.credits > 2500 ? { id: this.p.faction === 'BU' ? 'turret' : 'spike' } : null;
            if (step) this.tryBuild(step.id);
            return;
        }
        const next = this.order[this.step];
        const def = BUILDINGS[next.id];
        if (this.p.credits < def.cost + 260) return;
        if (this.g.missingRequirement(this.p, def)) return;
        if (this.tryBuild(next.id)) this.step++;
    }

    private tryBuild(defId: string): boolean {
        const def = BUILDINGS[defId];
        const core = this.g.buildings.find(b => !b.dead && b.owner === this.pid && b.def.isCore);
        if (!core) return false;
        const anchor = core;
        // spiral search for a free footprint near the core
        for (let r = 5; r <= 13; r++) {
            for (let a = 0; a < 16; a++) {
                const ang = (a / 16) * Math.PI * 2 + r * 0.37;
                const tx = Math.round(anchor.tx + Math.cos(ang) * r);
                const ty = Math.round(anchor.ty + Math.sin(ang) * r);
                if (this.g.canPlace(def, tx, ty).ok) {
                    this.p.credits -= def.cost;
                    this.g.place(def, this.pid, tx, ty, false);
                    return true;
                }
            }
        }
        return false;
    }

    /* ---------------- army ---------------- */
    private manageArmy() {
        const units = this.g.units.filter(u => !u.dead && u.owner === this.pid && !u.isHarvester);
        this.waveTimer -= 0.9;

        const enemies = this.g.buildings.filter(b => !b.dead && b.owner !== this.pid);
        const targetBase = this.pickTarget(enemies);

        // defenders stay home when the base is attacked
        const underAttack = this.g.buildings.some(b => !b.dead && b.owner === this.pid && this.g.time - b.lastHit < 6);
        if (underAttack) {
            const threat = this.g.units.find(u => !u.dead && u.owner !== this.pid);
            if (threat) {
                for (const u of units) {
                    if (u.order.k === 'idle' || u.order.k === 'attackmove') {
                        if (dist(u.x, u.y, threat.x, threat.y) < 900) this.g.orderAttackFor(u, threat);
                    }
                }
            }
        }

        if (this.waveTimer <= 0 && targetBase && units.length >= this.aggression) {
            this.waveTimer = this.diff === 'hard' ? 45 : this.diff === 'normal' ? 70 : 100;
            this.lastAttack = this.g.time;
            const rally = this.rallyPoint(targetBase);
            for (const u of units) {
                if (u.hp < u.maxHp * 0.35) continue;
                this.g.orderAttackMoveFor(u, rally.x, rally.y);
            }
        } else if (this.g.time - this.lastAttack < 25 && targetBase) {
            // keep pressure on
            const rally = this.rallyPoint(targetBase);
            for (const u of units) {
                if (u.order.k === 'idle' && dist(u.x, u.y, rally.x, rally.y) < 700) {
                    this.g.orderAttackMoveFor(u, rally.x, rally.y);
                }
            }
        }
    }

    private pickTarget(enemies: Building[]): Building | null {
        const core = this.g.buildings.find(b => !b.dead && b.owner === 0 && b.def.isCore);
        const my = this.g.buildings.filter(b => !b.dead && b.owner === this.pid && b.def.isCore)[0];
        if (!core) return enemies[0] || null;
        // aim for the closest structure to my base, preferring production
        let best: Building | null = core;
        let bd = Infinity;
        for (const b of enemies) {
            const d = my ? dist(my.x, my.y, b.x, b.y) : 0;
            const w = b.def.produces ? d * 0.75 : d;
            if (w < bd) { bd = w; best = b; }
        }
        return best;
    }

    private rallyPoint(b: Building) {
        return { x: b.x + (Math.random() - 0.5) * 120, y: b.y + (Math.random() - 0.5) * 120 };
    }
}
