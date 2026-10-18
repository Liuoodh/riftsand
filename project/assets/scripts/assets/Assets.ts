/**
 * Asset provider — the seam between "what the game wants to draw" and "where the
 * pixels come from".
 *
 * Two providers exist behind one call:
 *
 *   procedural  — bakes the painters in render/Art.ts into a Texture2D via an
 *                 offscreen 2D canvas. This is a PLACEHOLDER for real art.
 *   shp         — decodes a retail .shp frame into the same Texture2D. Nothing
 *                 above this file changes when that becomes available.
 *
 * Why bake at all instead of drawing with Graphics like before: the renderer must
 * be sprite/texture based, because that is the only shape that can consume real
 * SHP/VXL art. Keeping Graphics as the live path would have meant rewriting the
 * whole unit renderer the day the art arrived.
 *
 * Frames are 72x72 with the unit centred at (36,36), matching the painted art's
 * bounding box (a heavy hull projects to roughly 50x36 including the barrel).
 */

import { SpriteFrame, Texture2D, Rect, Size, Vec2 } from 'cc';
import { UnitDef, Faction, activeTeamColorOf } from '../core/Core';
import { CanvasPen } from './Pen';
import { paintUnit, paintHull } from '../render/Art';
import { ShpFile } from './Shp';
import { indicesToRgba, parsePal, remapTeam, Rgba8, syntheticPal } from './Palette';
import { unitBodyArtFrame, unitTurretArtFrame } from './ArtPack';

export const FRAME_W = 72;
export const FRAME_H = 72;

/** keeps the bake cache bounded on phones */
const MAX_CACHED_FRAMES = 900;

const cache = new Map<string, SpriteFrame>();

function createCanvas(w: number, h: number): any {
    const g: any = globalThis;
    let c: any = null;
    if (g.wx && typeof g.wx.createCanvas === 'function') c = g.wx.createCanvas();
    else if (g.document && typeof g.document.createElement === 'function') c = g.document.createElement('canvas');
    if (!c) return null;
    c.width = w;
    c.height = h;
    return c;
}

export function canvasAvailable() {
    return !!createCanvas(2, 2);
}

function evictIfNeeded() {
    if (cache.size <= MAX_CACHED_FRAMES) return;
    // Map preserves insertion order, so the first key is the oldest
    const first = cache.keys().next();
    if (!first.done) cache.delete(first.value);
}

/**
 * Rasterise a Pen drawing into a SpriteFrame.
 *
 * NOTE on orientation: CanvasPen already converts the art's y-up coordinates
 * into the canvas' y-down space (`py(y) = oy - y`), so the bitmap that comes out
 * of getImageData is ALREADY upright — row 0 is the top of the sprite, which is
 * what SpriteFrame expects. An extra row flip here inverted every unit (infantry
 * walked on their heads), which is exactly the bug it used to look like it fixed.
 */
export function bakeFrame(
    w: number, h: number,
    draw: (pen: CanvasPen) => void,
    key?: string,
): SpriteFrame | null {
    const cvs = createCanvas(w, h);
    if (!cvs) return null;
    const ctx = cvs.getContext('2d') as CanvasRenderingContext2D;
    if (!ctx) return null;
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();

    const pen = new CanvasPen(ctx, w / 2, h / 2);
    draw(pen);

    let src: Uint8ClampedArray;
    try {
        src = ctx.getImageData(0, 0, w, h).data;
    } catch {
        return null;
    }
    const out = new Uint8Array(w * h * 4);
    out.set(src.subarray(0, w * h * 4));
    // cheap self-check used by the headless asset test
    let opaque = 0;
    for (let i = 3; i < out.length; i += 4) if (out[i] > 8) opaque++;

    const tex = new Texture2D();
    tex.reset({ width: w, height: h, format: Texture2D.PixelFormat.RGBA8888, mipmapLevel: 0 });
    tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
    tex.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
    tex.uploadData(out);

    const sf = new SpriteFrame();
    sf.texture = tex;
    sf.rect = new Rect(0, 0, w, h);
    // a hand-built SpriteFrame has no originalSize / offset, and without them the
    // renderer computes a zero-sized quad (silent invisible sprite)
    sf.originalSize = new Size(w, h);
    sf.offset = new Vec2(0, 0);
    sf.packable = false;
    (sf as any).__opaque = opaque;
    try {
        (sf as any).__png = cvs.toDataURL ? cvs.toDataURL() : null;
    } catch { /* not fatal */ }

    if (key) {
        cache.set(key, sf);
        evictIfNeeded();
    }
    return sf;
}

/** turn an indexed SHP frame into a SpriteFrame (the retail path) */
export function frameFromShp(shp: ShpFile, index: number, pal: Rgba8): SpriteFrame | null {
    const f = shp.frames[index];
    if (!f || !f.w || !f.h) return null;
    const rgba = indicesToRgba(f.px, pal, f.w, f.h, true);
    const tex = new Texture2D();
    tex.reset({ width: f.w, height: f.h, format: Texture2D.PixelFormat.RGBA8888, mipmapLevel: 0 });
    tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
    tex.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
    tex.uploadData(rgba);
    const sf = new SpriteFrame();
    sf.texture = tex;
    sf.rect = new Rect(0, 0, f.w, f.h);
    sf.originalSize = new Size(f.w, f.h);
    sf.offset = new Vec2(0, 0);
    sf.packable = false;
    return sf;
}

// only turreted vehicles split hull from turret; mcv / harvester bake as one image
const isVehicleHull = (def: UnitDef) => def.kind === 'vehicle';

/**
 * The unit body frame. Vehicles bake hull-only (the turret is drawn live on top,
 * because it rotates independently); everything else bakes as one image.
 */
export function unitBodyFrame(
    def: UnitDef, faction: Faction, dir8: number, frame: number, moving = false,
): SpriteFrame | null {
    // real art wins when the artist shipped it; the painter is the fallback
    const real = unitBodyArtFrame(def.id, dir8, frame, moving);
    if (real) return real;
    // the team colour is part of the identity of a baked frame: two matches with
    // different player colours must not reuse each other's textures
    const key = `u|${def.id}|${faction}|${activeTeamColorOf(faction)}|${dir8}|${frame}`;
    const hit = cache.get(key);
    if (hit) return hit;
    return bakeFrame(FRAME_W, FRAME_H, (pen) => {
        if (isVehicleHull(def)) paintHull(pen, def, faction, dir8, frame);
        else paintUnit(pen, def, faction, dir8, frame);
    }, key);
}

/** Turret overlay from real art, or null when the unit has no turret atlas. */
export function unitTurretFrame(def: UnitDef, dir8: number): SpriteFrame | null {
    return unitTurretArtFrame(def.id, dir8);
}

export function clearFrameCache() {
    cache.clear();
}

export function cachedFrameCount() {
    return cache.size;
}

export { parsePal, remapTeam, syntheticPal };
