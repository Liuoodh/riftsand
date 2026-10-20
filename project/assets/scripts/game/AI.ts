/**
 * Skirmish AI — a build-order driven opponent.
 * It plays by the same rules as the player: it uses the same four production
 * queues, pays the same gradual build cost, and its structures wait in the
 * ready slot just like the player's. Difficulty only changes pacing and
 * aggression, never income.
 */
import {
    BUILDINGS, UNITS, TILE, HALF, dist, SUPER_WEAPONS,
} from '../core/Core';
import { Building, Unit, Entity } from './Entities';
import type { Game, Difficulty, PlayerState } from './Game';

interface BuildStep { id: string; }

export class AIController {
    private tick = 0;
    private buildCd = 2;
    private waveTimer = 0;
    private step = 0;
    private order: BuildStep[] = [];
    private lastAttack = -999;
    private expansionTarget: { x: number; y: number } | null = null;
    private expansionSent = false;
    private lastSwCast = -999;

    constructor(private g: Game, private pid: number, private diff: Difficulty) {
        const p = this.g.players[this.pid];
        const bu = p.faction === 'BU';
        this.order = bu
            ? [
                { id: 'furnace' }, { id: 'barracks' }, { id: 'foundry' },
                { id: 'sluice' }, { id: 'furnace' }, { id: 'archive' },
                { id: 'turret' }, { id: 'airpad' }, { id: 'furnace' },
                { id: 'orbital' }, { id: 'turret' }, { id: 'aegis' },
            ]
            : [
                { id: 'sunwell' }, { id: 'tent' }, { id: 'workshop' },
                { id: 'market' }, { id: 'sunwell' }, { id: 'vault' },
                { id: 'spike' }, { id: 'strip' }, { id: 'sunwell' },
                { id: 'storm' }, { id: 'spike' }, { id: 'mirage' },
            ];
        this.waveTimer = this.diff === 'hard' ? 60 : this.diff === 'normal' ? 85 : 115;
    }

    private get p(): PlayerState { return this.g.players[this.pid]; }

    private get aggression() {
        return this.diff === 'hard' ? 11 : this.diff === 'normal' ? 8 : 6;
    }

    update(dt: number) {
        if (this.g.phase !== 'playing') return;
        this.tick += dt;
        const interval = this.diff === 'hard' ? 0.8 : 1.0;
        if (this.tick < interval) return;
        const step = this.tick;
        this.tick = 0;
        if (this.p.defeated) return;

        this.manageEconomy();
        this.manageProduction();
        this.buildCd -= step;
        if (this.buildCd <= 0) {
            this.manageBuild();
            this.buildCd = this.diff === 'hard' ? 1.6 : 2.4;
        }
        this.manageArmy();
        this.manageSuperWeapons();
        this.manageExpansion();
    }

    /* ---------------- economy ---------------- */
    private manageEconomy() {
        const harvesters = this.g.units.filter(u => !u.dead && u.owner === this.pid && u.isHarvester);
        const dropoffs = this.g.buildings.filter(b => !b.dead && b.owner === this.pid && b.def.dropoff).length;
        const want = Math.min(6, 2 + dropoffs + (this.diff === 'hard' ? 1 : 0));
        const q = this.p.queues.vehicle;
        const queued = q.items.filter(i => i.defId === this.harvesterId).length;
        if (harvesters.length + queued < want) {
            const affordable = this.p.credits > 260;
            if (affordable && q.items.length < 2 && this.g.factoryCount(this.p, 'vehicle') > 0) {
                this.g.queueUnit('vehicle', this.harvesterId, 1, this.pid);
            }
        }
        for (const h of harvesters) {
            if (h.order.k === 'idle') h.order = { k: 'harvest', node: null, phase: 'seek', timer: 0 };
        }
    }

    private get harvesterId(): string {
        return this.p.faction === 'BU' ? 'hourglass' : 'scav';
    }

    /* ---------------- production ---------------- */
    private armyCap() {
        return this.diff === 'hard' ? 36 : this.diff === 'normal' ? 27 : 18;
    }

    private manageProduction() {
        const army = this.g.units.filter(u => !u.dead && u.owner === this.pid && !u.isHarvester).length;
        if (army >= this.armyCap()) return;

        const total = this.g.buildings.filter(b => !b.dead && b.owner === this.pid && b.done).length;
        const engineers = this.g.units.filter(u => !u.dead && u.owner === this.pid && u.isEngineer).length;

        // infantry: a couple of engineers on higher difficulties, then a mix
        const iq = this.p.queues.infantry;
        if (iq.items.length < 1) {
            if (this.diff !== 'easy' && engineers < 1 && total >= 5 && this.p.credits > 500) {
                this.g.queueUnit('infantry', this.p.faction === 'BU' ? 'sapper' : 'wire', 1, this.pid);
            } else {
                const opts = this.g.availableUnitsFor(this.p, 'infantry').filter(d => !this.g.lockReason(this.p, d));
                const stealth = opts.find(d => d.cloak);
                if (stealth && this.g.time > 260 && this.g.time % 3 < 1) {
                    this.g.queueUnit('infantry', stealth.id, 1, this.pid);
                } else if (opts.length) {
                    const pick = opts[Math.floor(this.g.time / 7) % Math.min(2, opts.length)];
                    this.g.queueUnit('infantry', pick.id, 1, this.pid);
                }
            }
        }

        // vehicles: a balanced mix, weighted towards the best affordable hull
        const vq = this.p.queues.vehicle;
        if (vq.items.length < 1) {
            // harvesters have their own cap in manageEconomy; never let the
            // combat queue spam them
            const opts = this.g.availableUnitsFor(this.p, 'vehicle')
                .filter(d => !d.mcv && d.kind !== 'harvester' && !this.g.lockReason(this.p, d));
            if (opts.length) {
                const wantHeavy = (this.g.time % 20) < 10;
                const pick = wantHeavy ? opts[opts.length - 1] : opts[Math.min(1, opts.length - 1)];
                this.g.queueUnit('vehicle', pick.id, 1, this.pid);
            }
        }

        // aircraft
        const aq = this.p.queues.aircraft;
        if (aq.items.length < 1 && this.g.factoryCount(this.p, 'aircraft') > 0) {
            const opts = this.g.availableUnitsFor(this.p, 'aircraft').filter(d => !this.g.lockReason(this.p, d));
            if (opts.length) this.g.queueUnit('aircraft', opts[opts.length - 1].id, 1, this.pid);
        }
    }

    /* ---------------- base building ---------------- */
    private manageBuild() {
        const q = this.p.queues.structure;
        if (q.ready) {
            // Game normally places it the moment it finishes; this is a safety net
            const ready = this.g.readyStructure(this.p);
            if (ready && this.placeStructure(ready.defId)) this.g.takeReadyStructure(this.pid);
            return;
        }
        if (q.items.length > 0) return;
        if (this.step >= this.order.length) {
            this.manageLateBuild();
            return;
        }
        const next = this.order[this.step];
        const def = BUILDINGS[next.id];
        if (this.g.lockReason(this.p, def)) return;
        if (this.p.credits < def.cost * 0.45) return;
        if (this.g.queueBuild(next.id, this.pid)) this.step++;
    }

    private manageLateBuild() {
        const defs = this.p.faction === 'BU'
            ? ['turret', 'furnace', 'orbital', 'aegis', 'foundry', 'sluice']
            : ['spike', 'sunwell', 'storm', 'mirage', 'workshop', 'market'];
        const id = defs[Math.floor(this.g.time / 30) % defs.length];
        const def = BUILDINGS[id];
        if (this.g.lockReason(this.p, def)) return;
        if (this.p.credits < def.cost * 0.5) return;
        this.g.queueBuild(id, this.pid);
    }

    /**
     * Would this footprint eat into a refinery's working apron?
     *
     * A refinery needs its surrounding cells free: trucks approach from any side
     * and have to be able to stand next to it. Two cells of clearance keeps the
     * dock usable and the lanes into the ore field open.
     */
    private blocksRefineryApron(def: { size: number }, tx: number, ty: number): boolean {
        const pad = 2;
        for (const b of this.g.buildings) {
            if (b.dead || b.owner !== this.pid || !b.def.dropoff) continue;
            const x0 = b.tx - pad, y0 = b.ty - pad;
            const x1 = b.tx + b.size + pad, y1 = b.ty + b.size + pad;
            const ox = tx + def.size > x0 && tx < x1;
            const oy = ty + def.size > y0 && ty < y1;
            if (ox && oy) return true;
        }
        return false;
    }

    /** called by Game when the structure queue finishes for this player */
    placeStructure(defId: string) {
        const def = BUILDINGS[defId];
        if (!def) return false;
        const core = this.g.buildings.find(b => !b.dead && b.owner === this.pid && b.def.isCore);
        if (!core) {
            // no core: deploy near the closest MCV instead
            const mcv = this.g.units.find(u => !u.dead && u.owner === this.pid && u.isMcv);
            if (!mcv) return false;
            const tx = Math.round((mcv.x + HALF) / TILE) - Math.floor(def.size / 2);
            const ty = Math.round((mcv.y + HALF) / TILE) - Math.floor(def.size / 2);
            if (!this.g.canPlace(def, tx, ty, this.pid).ok) return false;
            this.g.place(def, this.pid, tx, ty, false);
            return true;
        }
        /*
         * Spiral outward from the core, preferring spots that do not wall it in.
         *
         * `wouldSealBase` is the expensive part (~1ms: a flood fill over the
         * passability graph), so it must NOT run for every candidate — a wide
         * fallback scan used to call it 300+ times in one tick and froze the
         * game for a couple of hundred milliseconds. Instead every cheap test
         * runs first, the candidates are ranked, and only the best few are
         * checked for sealing.
         */
        const cands: Array<{ tx: number; ty: number; score: number }> = [];
        for (let r = 4; r <= 15; r++) {
            for (let a = 0; a < 24; a++) {
                const ang = (a / 24) * Math.PI * 2 + r * 0.41;
                const tx = Math.round(core.tx + Math.cos(ang) * r);
                const ty = Math.round(core.ty + Math.sin(ang) * r);
                if (!this.g.canPlace(def, tx, ty, this.pid).ok) continue;
                // Keep a two-cell apron around every refinery. Retail AI bases
                // reserve their refinery dock; without this the AI surrounds its
                // own drop-off with buildings and its trucks can never deliver
                // (measured: AI income 0 for the whole match).
                if (!def.dropoff && this.blocksRefineryApron(def, tx, ty)) continue;
                // keep anti-air and defenses facing the enemy side
                const towardEnemy = this.pid === 1 ? tx > core.tx : tx < core.tx;
                const score = (towardEnemy ? -3 : 0) + r * 0.4 + Math.abs(Math.sin(ang)) * 2;
                cands.push({ tx, ty, score });
            }
            if (cands.length && r >= 6) break;
        }
        cands.sort((a, b) => a.score - b.score);
        for (let i = 0; i < Math.min(cands.length, 4); i++) {
            const c = cands[i];
            if (this.g.wouldSealBase(def, c.tx, c.ty, this.pid)) continue;
            this.g.place(def, this.pid, c.tx, c.ty, false);
            return true;
        }

        // fall back to the relaxed radius rule so the AI never stalls
        const fallback: Array<{ tx: number; ty: number }> = [];
        for (let r = 4; r <= 18; r++) {
            for (let a = 0; a < 24; a++) {
                const ang = (a / 24) * Math.PI * 2 + r * 0.41;
                const tx = Math.round(core.tx + Math.cos(ang) * r);
                const ty = Math.round(core.ty + Math.sin(ang) * r);
                if (!this.g.canPlace(def, tx, ty, this.pid, true).ok) continue;
                fallback.push({ tx, ty });
            }
        }
        for (let i = 0; i < Math.min(fallback.length, 4); i++) {
            const c = fallback[i];
            if (this.g.wouldSealBase(def, c.tx, c.ty, this.pid)) continue;
            this.g.place(def, this.pid, c.tx, c.ty, false);
            return true;
        }
        return false;
    }

    /* ---------------- army ---------------- */
    private manageArmy() {
        const units = this.g.units.filter(u => !u.dead && u.owner === this.pid && !u.isHarvester);
        const fighters = units.filter(u => !u.isEngineer && !u.isMcv);
        this.waveTimer -= 1;

        const enemyBuildings = this.g.buildings.filter(b => !b.dead && b.owner !== this.pid);
        const targetBase = this.pickTarget(enemyBuildings);

        const underAttack = this.g.buildings.some(b => !b.dead && b.owner === this.pid && this.g.time - b.lastHit < 6);
        if (underAttack) {
            const threat = this.g.units.find(u => !u.dead && u.owner !== this.pid);
            if (threat) {
                for (const u of fighters) {
                    if (u.order.k === 'idle' || u.order.k === 'attackmove') {
                        if (dist(u.x, u.y, threat.x, threat.y) < 950) this.g.orderAttackFor(u, threat);
                    }
                }
                // own super weapons defend the base
                this.castDefensiveSuperWeapon(threat.x, threat.y);
            }
        }

        if (this.waveTimer <= 0 && targetBase && fighters.length >= this.aggression) {
            this.waveTimer = this.diff === 'hard' ? 55 : this.diff === 'normal' ? 90 : 115;
            this.lastAttack = this.g.time;
            const rally = this.rallyPoint(targetBase);
            for (const u of fighters) {
                if (u.hp < u.maxHp * 0.35) continue;
                if (u.stance !== 'aggressive') u.stance = 'aggressive';
                this.g.orderAttackMoveFor(u, rally.x, rally.y);
            }
            // engineers trail the wave and grab whatever is left standing
            const engineers = units.filter(u => u.isEngineer);
            const victim = enemyBuildings.find(b => b.owner === 0 && !b.def.isCore) || enemyBuildings[0];
            if (victim) for (const e of engineers) this.g.orderCaptureFor(e, victim);
        } else if (this.g.time - this.lastAttack < 28 && targetBase) {
            const rally = this.rallyPoint(targetBase);
            for (const u of fighters) {
                if (u.order.k === 'idle' && dist(u.x, u.y, rally.x, rally.y) < 760) {
                    this.g.orderAttackMoveFor(u, rally.x, rally.y);
                }
            }
        }

        // units that have been idle at home for a while join the staging point
        if (this.g.time - this.lastAttack > 40 && targetBase) {
            const home = this.g.buildings.find(b => !b.dead && b.owner === this.pid && b.def.isCore);
            if (home) {
                for (const u of fighters) {
                    if (u.order.k !== 'idle') continue;
                    if (dist(u.x, u.y, home.x, home.y) > 460) continue;
                    const rally = this.rallyPoint(targetBase);
                    this.g.orderAttackMoveFor(u, rally.x, rally.y);
                }
            }
        }
    }

    private pickTarget(enemies: Building[]): Building | null {
        const core = this.g.buildings.find(b => !b.dead && b.owner === 0 && b.def.isCore);
        const my = this.g.buildings.find(b => !b.dead && b.owner === this.pid && b.def.isCore);
        if (!core) return enemies[0] || null;
        let best: Building | null = core;
        let bd = Infinity;
        for (const b of enemies) {
            const d = my ? dist(my.x, my.y, b.x, b.y) : 0;
            let w = d;
            if (b.def.produces) w *= 0.8;
            if (b.def.isCore) w *= 0.7;
            if (b.def.superWeapon) w *= 0.85;
            if (w < bd) { bd = w; best = b; }
        }
        return best;
    }

    private rallyPoint(b: Building) {
        return {
            x: b.x + (this.g.time * 37 % 120) - 60,
            y: b.y + (this.g.time * 53 % 120) - 60,
        };
    }

    /* ---------------- super weapons ---------------- */
    private manageSuperWeapons() {
        for (const s of this.p.sw) {
            if (!s.ready) continue;
            if (this.g.time - this.lastSwCast < 6) continue;
            const def = SUPER_WEAPONS[s.id];
            if (def.kind === 'strike') {
                const spot = this.enemyCluster();
                if (spot && this.g.launchSuperWeapon(s.id, spot.x, spot.y, this.pid)) this.lastSwCast = this.g.time;
            } else {
                // buff fields: drop them on our own attacking army
                const army = this.g.units.filter(u => !u.dead && u.owner === this.pid && !u.isHarvester);
                if (army.length < 4) continue;
                let cx = 0, cy = 0;
                for (const u of army) { cx += u.x; cy += u.y; }
                cx /= army.length; cy /= army.length;
                const enemiesNear = this.g.units.some(u => !u.dead && u.owner !== this.pid && dist(u.x, u.y, cx, cy) < 700)
                    || this.g.buildings.some(b => !b.dead && b.owner !== this.pid && dist(b.x, b.y, cx, cy) < 500);
                if (!enemiesNear) continue;
                if (this.g.launchSuperWeapon(s.id, cx, cy, this.pid)) this.lastSwCast = this.g.time;
            }
        }
    }

    private castDefensiveSuperWeapon(x: number, y: number) {
        for (const s of this.p.sw) {
            if (!s.ready) continue;
            if (SUPER_WEAPONS[s.id].kind === 'field') {
                if (this.g.launchSuperWeapon(s.id, x, y, this.pid)) return;
            }
        }
    }

    /** spot with the most player value around it */
    private enemyCluster(): { x: number; y: number } | null {
        const targets: Entity[] = [
            ...this.g.buildings.filter(b => !b.dead && b.owner === 0),
            ...this.g.units.filter(u => !u.dead && u.owner === 0 && !u.isHarvester),
        ];
        if (targets.length === 0) return null;
        let best = targets[0];
        let bestScore = -1;
        for (const t of targets) {
            let score = 0;
            for (const o of targets) {
                const d = dist(t.x, t.y, o.x, o.y);
                if (d > 150) continue;
                score += o.isBuilding() ? 3 : 1;
            }
            if (score > bestScore) { bestScore = score; best = t; }
        }
        return { x: best.x, y: best.y };
    }

    /* ---------------- expansion ---------------- */
    private manageExpansion() {
        if (this.diff !== 'hard') return;
        if (this.expansionSent) return;
        if (this.g.time < 240) return;
        if (this.p.credits < 3200) return;
        if (this.g.factoryCount(this.p, 'vehicle') === 0) return;

        const mcvId = this.p.faction === 'BU' ? 'rig' : 'crawler';
        const mcv = this.g.units.find(u => !u.dead && u.owner === this.pid && u.isMcv);
        if (!mcv) {
            if (this.p.queues.vehicle.items.length === 0 && this.g.time > 300) {
                this.g.queueUnit('vehicle', mcvId, 1, this.pid);
            }
            return;
        }
        if (!this.expansionTarget) {
            const core = this.g.buildings.find(b => !b.dead && b.owner === this.pid && b.def.isCore);
            let best: { x: number; y: number } | null = null;
            let bd = Infinity;
            for (const n of this.g.terrain.nodes) {
                if (n.amount <= 0) continue;
                if (core && dist(n.x, n.y, core.x, core.y) < 900) continue;
                const d = core ? dist(n.x, n.y, core.x, core.y) : 0;
                if (d < bd) { bd = d; best = { x: n.x, y: n.y }; }
            }
            this.expansionTarget = best;
        }
        if (!this.expansionTarget) return;
        const d = dist(mcv.x, mcv.y, this.expansionTarget.x, this.expansionTarget.y);
        if (d < 90) {
            if (this.g.tryDeploy(mcv)) this.expansionSent = true;
        } else if (mcv.order.k === 'idle') {
            this.g.orderMoveFor(mcv, this.expansionTarget.x, this.expansionTarget.y + 40);
        }
    }
}
