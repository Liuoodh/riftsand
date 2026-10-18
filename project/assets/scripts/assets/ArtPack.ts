/**
 * Real-art provider.
 *
 * The procedural painter in `Art.ts` bakes placeholder images. This module is
 * the other provider behind the same seam: it loads the atlases an artist
 * rendered (currently a Blender batch) and hands out `SpriteFrame`s sliced from
 * them. `Assets.unitBodyFrame()` tries this first and silently falls back to the
 * painter, so a missing or broken atlas degrades to the old look instead of a
 * blank unit.
 *
 * Atlas layout follows the retail SHP convention: facing is the SLOW index and
 * the animation phase is the fast one inside each facing.
 *
 *   index = sequenceStart + facing * phasesInSequence + phase
 *
 * `tools/blender/blib.py:render_facings` writes the same order ("four
 * consecutive cells per facing"), so a batch lands here without re-ordering.
 *
 * Files live under `assets/resources/art/**` and are loaded through
 * `resources.load`, which is the only path that survives the mini-game build
 * (a bare `assets/` PNG is not bundled unless `resources/` asks for it).
 */
import {
    resources, JsonAsset, ImageAsset, Texture2D, SpriteFrame, Rect, Size, Vec2,
} from 'cc';

export interface SeqRange {
    start: number;
    frames: number;
    rate?: number;
}

export interface UnitArt {
    id: string;
    body: SpriteFrame[];
    turret: SpriteFrame[];
    facings: number;
    ready: SeqRange;
    walk: SeqRange;
    /** added to the engine facing index; for a batch rendered from -Y this is the
     *  difference between "sprite 0 points up-screen" and "facing index 0 is 45°" */
    dirOffset: number;
    anchor: { x: number; y: number };
    frameW: number;
    frameH: number;
}

const packs = new Map<string, UnitArt>();
/** insertion order, kept separately: spreading a Map iterator compiles to
 *  [iterator] under the game's ES5 target and silently broke the id list */
const order: string[] = [];
let loaded = false;
let lastError = '';

export const artLoaded = () => loaded;
export const artError = () => lastError;
export const artIds = () => order;

/** image path in the manifest → resources path (`art/units/x.png` → `art/units/x`) */
const resPath = (p: string) => p.replace(/\.(png|jpg|jpeg)$/i, '');

function sliceSheet(tex: Texture2D, fw: number, fh: number, count: number): SpriteFrame[] {
    const W = tex.width, H = tex.height;
    const cols = Math.max(1, Math.floor(W / fw));
    const out: SpriteFrame[] = [];
    for (let i = 0; i < count; i++) {
        const col = i % cols, row = Math.floor(i / cols);
        const x = col * fw;
        const y = H - (row + 1) * fh;      // PNG rows are top-down, rects bottom-up
        if (x + fw > W || y < 0) { out.push(null as unknown as SpriteFrame); continue; }
        const sf = new SpriteFrame();
        sf.texture = tex;
        sf.rect = new Rect(x, y, fw, fh);
        sf.originalSize = new Size(fw, fh);
        sf.offset = new Vec2(0, 0);
        sf.packable = false;
        out.push(sf);
    }
    return out;
}

function loadTexture(path: string): Promise<Texture2D | null> {
    return new Promise((resolve) => {
        resources.load(`${resPath(path)}/texture`, Texture2D, (err: Error | null, tex: Texture2D) => {
            if (!err && tex) { resolve(tex); return; }
            // fall back to the image asset (some import settings expose only that)
            resources.load(resPath(path), ImageAsset, (e2: Error | null, img: ImageAsset) => {
                if (e2 || !img) { resolve(null); return; }
                const t = new Texture2D();
                t.image = img;
                resolve(t);
            });
        });
    });
}

async function loadUnit(id: string, def: any): Promise<void> {
    const fw = def.frame?.w ?? 72;
    const fh = def.frame?.h ?? 72;
    const facings = def.facings ?? 8;
    const ready: SeqRange = def.sequences?.ready ?? { start: 0, frames: facings, rate: 0 };
    const walk: SeqRange = def.sequences?.walk ?? { start: facings, frames: facings * 4, rate: 9 };
    const total = Math.max(ready.start + ready.frames, walk.start + walk.frames);

    const bodyTex = await loadTexture(def.image);
    if (!bodyTex) { lastError += `${id}: body image missing (${def.image}); `; return; }
    /*
     * Blender-rendered art is not pixel art.
     *
     * The source atlases are rendered at 4x and downscaled by the artist, so the
     * frames are photographic-ish: nearest-neighbour sampling turns every
     * anti-aliased edge back into a staircase and the tank reads as a chunky
     * sprite. Linear filtering with mipmaps keeps the render smooth at any
     * zoom. Pixel art (a manifest that ships tiny 1x frames) stays crisp anyway
     * because there is no downscale to speak of.
     */
    bodyTex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
    bodyTex.setMipFilter(Texture2D.Filter.LINEAR);
    bodyTex.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);

    const body = sliceSheet(bodyTex, fw, fh, total);
    let turret: SpriteFrame[] = [];
    if (def.turret?.image) {
        const tTex = await loadTexture(def.turret.image);
        if (tTex) {
            tTex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
            tTex.setMipFilter(Texture2D.Filter.LINEAR);
            tTex.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
            const tfw = def.turret.frame?.w ?? fw;
            const tfh = def.turret.frame?.h ?? fh;
            turret = sliceSheet(tTex, tfw, tfh, def.turret.frames ?? facings);
        } else {
            lastError += `${id}: turret image missing (${def.turret.image}); `;
        }
    }

    const missing = body.filter((f) => !f).length;
    if (missing) lastError += `${id}: ${missing}/${total} frames outside the atlas; `;

    if (!packs.has(id)) order.push(id);
    packs.set(id, {
        id, body, turret, facings, ready, walk,
        dirOffset: def.dirOffset ?? 0,
        anchor: def.anchor ?? { x: fw / 2, y: fh / 2 },
        frameW: fw, frameH: fh,
    });
}

/**
 * Load every atlas listed in `art/manifest.json`.
 *
 * Resolves even on failure: a match must never fail to start because an atlas is
 * still being painted. Problems are collected in `artError()` for the debug HUD.
 */
export function loadArt(): Promise<void> {
    return new Promise((resolve) => {
        resources.load('art/manifest', JsonAsset, async (err: Error | null, json: JsonAsset) => {
            if (err || !json || !(json.json as any)?.units) {
                lastError += 'art/manifest missing (' + String(err && err.message || err) + '); ';
                loaded = true;
                resolve();
                return;
            }
            const units = (json.json as any).units as Record<string, any>;
            for (const [id, def] of Object.entries(units)) {
                try { await loadUnit(id, def); } catch (e) { lastError += `${id}: ${String(e)}; `; }
            }
            loaded = true;
            resolve();
        });
    });
}

export function unitArt(id: string): UnitArt | null {
    return packs.get(id) ?? null;
}

/**
 * Body frame for a unit.
 *
 * `moving` selects the walk sequence; `animFrame` is the phase inside it. The
 * sequences in the manifest carry a *total* frame count (4 phases × 8 facings),
 * so the phase count is derived, never assumed.
 */
export function unitBodyArtFrame(id: string, dir: number, animFrame: number, moving: boolean): SpriteFrame | null {
    const a = packs.get(id);
    if (!a) return null;
    const d = ((dir + a.dirOffset) % a.facings + a.facings) % a.facings;
    if (!moving) {
        const f = a.body[a.ready.start + d];
        if (f) return f;
        // a batch that only rendered one animation still has to stand still
        return a.body[d] ?? null;
    }
    const phases = Math.max(1, Math.round(a.walk.frames / a.facings));
    const phase = ((animFrame % phases) + phases) % phases;
    /*
     * `facing` is the SLOW index: each facing owns `phases` consecutive cells.
     *
     *   walk.start + facing * phases + phase
     *
     * This used to be `walk.start + phase * facings + facing` — the transpose.
     * Both formulas agree on the first phase, which is why every unit looked
     * fine standing still and every check that only inspected `ready` passed.
     * While *driving* the engine then cycled through four different FACINGS
     * instead of four animation phases: measured on the atlas, the four frames it
     * played for facing 0 had bounding-box widths of 48, 85, 48, 85 px — the 85s
     * are a side view. On screen that reads as the hull swinging left and right
     * on every step, which is exactly the "the body keeps wobbling while it
     * drives" report that survived several rounds of steering fixes.
     */
    return a.body[a.walk.start + d * phases + phase] ?? a.body[d] ?? null;
}

/** Turret frame; returns null for art without a separate turret (mcv, harvester). */
export function unitTurretArtFrame(id: string, dir: number): SpriteFrame | null {
    const a = packs.get(id);
    if (!a || !a.turret.length) return null;
    const d = ((dir + a.dirOffset) % a.facings + a.facings) % a.facings;
    return a.turret[d] ?? null;
}

/**
 * Facing correction probe.
 *
 * The engine's facing index 0 is 45° in world space; a Blender batch rendered
 * starting at "nose up-screen" is offset by half a turn. Rather than hard-code a
 * guess, `dirOffset` comes from the manifest and this helper reports what the
 * current value produces, so the debug overlay can show it.
 */
export function describeArt(id: string): string {
    const a = packs.get(id);
    if (!a) return `${id}: no art pack`;
    return `${id}: ${a.body.length} body frames, ${a.turret.length} turret frames, `
        + `dirOffset=${a.dirOffset}, anchor=${a.anchor.x},${a.anchor.y}`;
}

/**
 * Recover the atlas index of a sliced frame.
 *
 * Debug-only: `rect` is stored bottom-up while the PNG is top-down, so the row
 * has to be recovered from the texture height. Used by the facing-table check to
 * assert "engine facing N drew atlas frame M" without reading pixels.
 */
export function frameIndexFromRect(sf: SpriteFrame): number {
    const tex = sf.texture;
    if (!tex) return -1;
    const fw = sf.rect.width, fh = sf.rect.height;
    const cols = Math.max(1, Math.floor(tex.width / fw));
    const col = Math.round(sf.rect.x / fw);
    const row = Math.round((tex.height - sf.rect.y - fh) / fh);
    return row * cols + col;
}
