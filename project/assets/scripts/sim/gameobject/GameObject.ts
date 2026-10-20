/**
 * Port of redalert2/src/game/gameobject/GameObject.ts (150 lines).
 *
 * The root of the object model. Everything the engine can put on the map is a
 * `GameObject`: mobiles, buildings, terrain trees, overlays (ore, walls,
 * bridge decks), smudges (scorch marks), projectiles and debris.
 *
 * Two structural decisions are worth stating up front because the rest of the
 * port leans on them:
 *
 * 1. **Identity is `type`, not the class.** `isBuilding()` / `isInfantry()` /
 *    … are answered by the `ObjectType` enum on the base class, and subclasses
 *    only *add* `true` for their own predicate (see `Techno.isTechno`,
 *    `Building.isBuilding`). That is why `Overlay.isTiberium()` and friends can
 *    live on `Overlay` while `GameObject.isSmudge()` lives here.
 *
 * 2. **Traits are attached at runtime, never inherited.** `traits` is a flat
 *    bag plus `cachedTraits.tick`, a *snapshot* of the tickable subset. The
 *    snapshot is built once by `ObjectFactory` after all traits are added; a
 *    trait added later does not start ticking by itself. Keeping the snapshot
 *    explicit is what makes `Techno.update`'s warped-out branch cheap: it walks
 *    one short array instead of filtering on every tick.
 */
import { ObjectType } from '../type/ObjectType';
import { Traits } from '../Traits';
import { fnv32a } from '../util/math';
import { DeathType } from './DeathType';
import { NotifyAttack } from './trait/interface/NotifyAttack';
import { NotifyDestroy } from './trait/interface/NotifyDestroy';
import { NotifyOwnerChange } from './trait/interface/NotifyOwnerChange';
import { NotifySpawn } from './trait/interface/NotifySpawn';
import { NotifyTick } from './trait/interface/NotifyTick';
import { NotifyUnspawn } from './trait/interface/NotifyUnspawn';

export class GameObject {
    traits: Traits;
    cachedTraits: { tick: any[] };
    isCrashing: boolean;
    isDestroyed: boolean;
    deathType: DeathType;
    isDisposed: boolean;
    isSpawned: boolean;
    type: ObjectType;
    name: string;
    rules: any;
    art: any;
    /**
     * Assigned by `ObjectFactory` (monotonic counter) and by `Player` for
     * ownership. They are not constructor arguments in the reference either —
     * `ObjectFactory.create` writes both after the concrete class has run.
     */
    id: number;
    position: any;
    owner: any;

    /** trait handles are attached by name, e.g. `moveTrait`, `healthTrait` */
    [key: string]: any;

    get tile() {
        return this.position.tile;
    }

    get tileElevation() {
        return this.position.tileElevation;
    }

    constructor(type: ObjectType, name: string, rules: any, art: any) {
        this.traits = new Traits();
        this.cachedTraits = { tick: [] };
        this.isCrashing = false;
        this.isDestroyed = false;
        this.deathType = DeathType.Normal;
        this.isDisposed = false;
        this.isSpawned = false;
        this.type = type;
        this.name = name;
        this.rules = rules;
        this.art = art;
    }

    getFoundation(): { width: number; height: number } {
        return { width: 1, height: 1 };
    }

    isSmudge(): boolean {
        return this.type === ObjectType.Smudge;
    }

    isOverlay(): boolean {
        return this.type === ObjectType.Overlay;
    }

    isTerrain(): boolean {
        return this.type === ObjectType.Terrain;
    }

    isProjectile(): boolean {
        return this.type === ObjectType.Projectile;
    }

    isDebris(): boolean {
        return this.type === ObjectType.Debris;
    }

    isBuilding(): boolean {
        return false;
    }

    isInfantry(): boolean {
        return false;
    }

    isVehicle(): boolean {
        return false;
    }

    isAircraft(): boolean {
        return false;
    }

    isUnit(): boolean {
        return false;
    }

    isTechno(): boolean {
        return false;
    }

    /**
     * `WarpedOutTrait` is the only trait the base class knows by name, and only
     * because `Techno` needs it before any tick happens. Read through the bag so
     * a plain `GameObject` (terrain, overlay) does not crash here.
     */
    isWarpedOut(): boolean {
        return this.warpedOutTrait?.isActive?.() ?? false;
    }

    update(deltaTime: number): void {
        for (const trait of this.cachedTraits.tick) {
            trait[NotifyTick.onTick](this, deltaTime);
        }
    }

    onSpawn(data: any): void {
        this.isSpawned = true;
        this.traits.filter(NotifySpawn).forEach((trait) => {
            trait[NotifySpawn.onSpawn](this, data);
        });
    }

    onUnspawn(data: any): void {
        this.isSpawned = false;
        this.traits.filter(NotifyUnspawn).forEach((trait) => {
            trait[NotifyUnspawn.onUnspawn](this, data);
        });
    }

    onDestroy(data: any, type: any, reason: any): void {
        this.traits.filter(NotifyDestroy).forEach((trait) => {
            trait[NotifyDestroy.onDestroy](this, data, type, reason);
        });
    }

    onOwnerChange(data: any, owner: any): void {
        this.traits.filter(NotifyOwnerChange).forEach((trait) => {
            trait[NotifyOwnerChange.onChange](this, data, owner);
        });
    }

    onAttack(data: any, target: any): void {
        this.traits.filter(NotifyAttack).forEach((trait) => {
            trait[NotifyAttack.onAttack](this, target, data);
        });
    }

    addTrait(trait: any): void {
        this.traits.add(trait);
        if (trait[NotifyTick.onTick]) {
            this.cachedTraits.tick.push(trait);
        }
    }

    getUiName(): string {
        return this.rules.uiName;
    }

    /**
     * Deterministic replays hash. `Array.from(new Uint8Array(...))` — not a
     * spread — because the build runs Babel in loose mode, where `[...typed]`
     * compiles to `[].concat(typed)` and yields one element instead of N.
     */
    getHash(): number {
        const pos = this.position.worldPosition;
        return fnv32a([
            this.id,
            ...Array.from(new Uint8Array(new Float64Array([pos.x, pos.y, pos.z]).buffer)),
            ...this.traits.getAll().map((trait) => trait.getHash?.() ?? 0),
        ]);
    }

    debugGetState(): any {
        return {
            id: this.id,
            position: this.position.worldPosition.toArray(),
            traits: this.traits.getAll().reduce((acc: any, trait: any) => {
                const state = trait.debugGetState?.();
                if (state !== undefined) {
                    acc[trait.constructor.name] = state;
                }
                return acc;
            }, {}),
        };
    }

    dispose(): void {
        this.isDisposed = true;
        this.traits.dispose();
        this.cachedTraits.tick.length = 0;
    }
}
