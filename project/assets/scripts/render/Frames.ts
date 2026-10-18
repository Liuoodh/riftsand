/**
 * Frame-sequence model for unit art.
 *
 * This mirrors how the retail engine animates units: a sprite sheet holds
 * `facings × frames` images, and the visible image is
 *   `startFrame + facingMult * facingIndex + animFrame`
 * (see redalert2/src/engine/renderable/entity/Infantry.ts:465-479 and
 *  game/art/SequenceReader.ts). Facing is expressed in DEGREES, not radians and
 * not a 0-255 byte, so the numbers here can be checked against the original.
 *
 * We have no SHP assets yet, so frames are painted procedurally in Art.ts.
 * The interface is the point: swapping in real art later means replacing the
 * painter, not the entity/render code.
 */

/** the subset of the reference's 35 sequence types we actually use so far */
export enum Seq {
    Ready = 0,
    Walk = 1,
    FireUp = 2,
    Die1 = 3,
}

export interface SeqDef {
    /** how many images the sequence holds */
    frames: number;
    /** images per second — the INI `Rate` is per-minute, so rate = Rate / 60 */
    rate: number;
    loop: boolean;
}

/** Rate 900 -> 15 fps in the reference; walk cycles read better a bit slower */
export const SEQUENCES: Record<Seq, SeqDef> = {
    [Seq.Ready]: { frames: 1, rate: 0, loop: true },
    [Seq.Walk]: { frames: 4, rate: 9, loop: true },
    [Seq.FireUp]: { frames: 2, rate: 14, loop: false },
    [Seq.Die1]: { frames: 4, rate: 7, loop: false },
};

/** default facing count for vehicles (art `Facings`), infantry is hard-wired to 8 */
export const FACINGS = 8;

/**
 * logic facing (degrees, 0 = +X, CCW) -> sprite facing index.
 * Byte-for-byte the reference formula.
 */
export function facingIndex(deg: number, facings = FACINGS) {
    return Math.round((((deg - 45 + 360) % 360) / 360) * facings) % facings;
}

/** the direction each facing index points at: index i is (i + 1) * 45 degrees */
export function facingDeg(i: number, facings = FACINGS) {
    return ((i + 1) * (360 / facings)) % 360;
}

/**
 * `facingIndex` with hysteresis, for anything that is recomputed every frame.
 *
 * The plain formula rounds, so a bearing sitting on a 22.5-degree boundary flips
 * between two neighbouring images whenever it moves by a thousandth of a
 * radian — on screen the hull appears to twitch and the turret appears to snap
 * away and come back, even though it is tracking perfectly. Keep the current
 * image until the bearing is clearly past its edge (about 6 degrees of guard at
 * 8 facings), then switch once.
 *
 * `prev` < 0 means "no previous image": falls through to the plain formula.
 */
export function facingIndexSticky(deg: number, prev: number, facings = FACINGS) {
    if (prev === undefined || prev === null || prev < 0 || prev >= facings) return facingIndex(deg, facings);
    const step = 360 / facings;
    const center = facingDeg(prev, facings);
    const delta = ((deg - center + 540) % 360) - 180;
    if (Math.abs(delta) <= step / 2 - step * 0.14) return prev;
    return facingIndex(deg, facings);
}

/** unit vector for a facing index, in logic (cartesian) space */
export function facingVec(i: number, facings = FACINGS) {
    const a = (facingDeg(i, facings) * Math.PI) / 180;
    return { x: Math.cos(a), y: Math.sin(a) };
}

/**
 * Playback clock for one sequence. `step()` is fed the frame delta, so the
 * animation is frame-rate independent like the reference's AnimRunner.
 */
export class Anim {
    seq: Seq = Seq.Ready;
    frame = 0;
    private t = 0;

    play(seq: Seq) {
        if (this.seq === seq) return;
        this.seq = seq;
        this.frame = 0;
        this.t = 0;
    }

    /**
     * @param rateScale  playback speed multiplier, 0..2. Vehicle sequences are
     *   tied to ground speed (a tank crawling out of a turn must not scroll its
     *   tracks at full rate), infantry simply pass 1.
     */
    step(dt: number, rateScale = 1) {
        const d = SEQUENCES[this.seq];
        if (d.rate <= 0 || d.frames <= 1) {
            this.frame = 0;
            return;
        }
        const rate = d.rate * Math.max(0.05, rateScale);
        const period = 1 / rate;
        this.t += dt;
        // guard against long frames (tab switch) turning into a loop storm
        if (this.t > period * 8) this.t = period;
        while (this.t >= period) {
            this.t -= period;
            this.frame++;
            if (this.frame >= d.frames) this.frame = d.loop ? 0 : d.frames - 1;
        }
    }
}
