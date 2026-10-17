/**
 * Westwood .pal handling.
 *
 * A retail palette file is 768 bytes: 256 entries x RGB, each channel stored as
 * a 6-bit VGA value. The engine expands to 8-bit by multiplying by 4.
 * Reference: redalert2/src/data/Palette.ts:31-44
 *
 * Index 0 is the transparent colour for every sprite, which is why it gets
 * alpha 0 here instead of being left opaque.
 */

export const PALETTE_ENTRIES = 256;
export const PALETTE_BYTES = PALETTE_ENTRIES * 3;

/** house colour lives in palette slots 16..31 (reference: Palette.ts:6) */
export const REMAP_START = 16;
export const REMAP_COUNT = 16;

/**
 * The 16 brightness steps the retail game uses to shade a house colour.
 * Verbatim from Palette.ts:77-78.
 */
export const REMAP_FACTORS = [63, 59, 55, 52, 48, 44, 41, 37, 33, 30, 26, 22, 19, 15, 11, 8];

export type Rgba8 = Uint8Array;

/** expand a 768-byte VGA palette into 256 RGBA entries */
export function parsePal(buf: ArrayBuffer, offset = 0): Rgba8 {
    const src = new Uint8Array(buf, offset, Math.min(PALETTE_BYTES, buf.byteLength - offset));
    const out = new Uint8Array(PALETTE_ENTRIES * 4);
    for (let i = 0; i < PALETTE_ENTRIES; i++) {
        const o = i * 4;
        out[o] = Math.min(255, (src[i * 3] || 0) * 4);
        out[o + 1] = Math.min(255, (src[i * 3 + 1] || 0) * 4);
        out[o + 2] = Math.min(255, (src[i * 3 + 2] || 0) * 4);
        out[o + 3] = i === 0 ? 0 : 255;
    }
    return out;
}

/**
 * Writes a house colour into slots 16..31 as 16 brightness steps.
 * Same arithmetic as the reference, including the `/255 * factor * 4` curve.
 */
export function remapTeam(pal: Rgba8, r: number, g: number, b: number): Rgba8 {
    for (let i = 0; i < REMAP_COUNT; i++) {
        const o = (REMAP_START + i) * 4;
        const f = REMAP_FACTORS[i];
        pal[o] = Math.min(255, Math.floor((r / 255) * f * 4));
        pal[o + 1] = Math.min(255, Math.floor((g / 255) * f * 4));
        pal[o + 2] = Math.min(255, Math.floor((b / 255) * f * 4));
        pal[o + 3] = 255;
    }
    return pal;
}

/** build a palette from a base colour only — useful when no .pal is present */
export function syntheticPal(): Rgba8 {
    const out = new Uint8Array(PALETTE_ENTRIES * 4);
    for (let i = 0; i < PALETTE_ENTRIES; i++) {
        const o = i * 4;
        // a neutral grey ramp so untextured indices still read
        out[o] = out[o + 1] = out[o + 2] = i;
        out[o + 3] = i === 0 ? 0 : 255;
    }
    return out;
}

/**
 * Converts 8-bit palette indices into an RGBA pixel buffer.
 * `alphaTest` lets callers treat index 0 as fully transparent, which is how
 * every Westwood sprite encodes transparency.
 */
export function indicesToRgba(
    px: Uint8Array, pal: Rgba8, w: number, h: number, flipY = false,
): Uint8Array {
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        const srcRow = y * w;
        const dstRow = (flipY ? h - 1 - y : y) * w;
        for (let x = 0; x < w; x++) {
            const idx = px[srcRow + x];
            const s = idx * 4;
            const d = (dstRow + x) * 4;
            out[d] = pal[s];
            out[d + 1] = pal[s + 1];
            out[d + 2] = pal[s + 2];
            out[d + 3] = idx === 0 ? 0 : pal[s + 3];
        }
    }
    return out;
}
