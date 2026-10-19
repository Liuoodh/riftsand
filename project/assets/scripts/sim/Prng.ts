/**
 * Prng — the reference's deterministic random source.
 *
 * Reference: redalert2/src/game/Prng.ts
 *
 * It is a Mersenne Twister seeded through `Number(seed + '' + sequence)` (or a
 * CRC32 of the seed when the seed is not numeric). This exact construction is
 * what makes a replay or a lockstep multiplayer game stay in sync, so the seed
 * arithmetic and the `generateRandomInt` mapping are copied verbatim — including
 * the fact that it caches `lastRandom`, which the AI uses to reason about
 * "what did I just roll".
 *
 * `mersenne-twister` is a 60-line algorithm, so it is inlined here rather than
 * pulled in as a dependency (mini-game bundles have no npm resolution).
 */
import { Crc32 } from './util/Crc32';
import { binaryStringToUint8Array } from './util/string';

/** MT19937 — same state layout and tempering as the `mersenne-twister` package. */
class MersenneTwister {
    private mt: Uint32Array;
    private mti: number;

    constructor(seed: number) {
        this.mt = new Uint32Array(624);
        this.mt[0] = seed >>> 0;
        for (this.mti = 1; this.mti < 624; this.mti++) {
            const s = this.mt[this.mti - 1] ^ (this.mt[this.mti - 1] >>> 30);
            this.mt[this.mti] =
                (((((s & 0xffff0000) >>> 16) * 1812433253) << 16) +
                    (s & 0x0000ffff) * 1812433253 +
                    this.mti) >>> 0;
        }
    }

    private genrandInt32(): number {
        let y: number;
        const mt = this.mt;

        if (this.mti >= 624) {
            let kk: number;
            for (kk = 0; kk < 227; kk++) {
                y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
                mt[kk] = mt[kk + 397] ^ (y >>> 1) ^ (y & 0x1 ? 0x9908b0df : 0);
            }
            for (; kk < 623; kk++) {
                y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
                mt[kk] = mt[kk - 227] ^ (y >>> 1) ^ (y & 0x1 ? 0x9908b0df : 0);
            }
            y = (mt[623] & 0x80000000) | (mt[0] & 0x7fffffff);
            mt[623] = mt[396] ^ (y >>> 1) ^ (y & 0x1 ? 0x9908b0df : 0);
            this.mti = 0;
        }

        y = mt[this.mti++];
        y ^= y >>> 11;
        y ^= (y << 7) & 0x9d2c5680;
        y ^= (y << 15) & 0xefc60000;
        y ^= y >>> 18;
        return y >>> 0;
    }

    random(): number {
        return this.genrandInt32() * (1.0 / 4294967296.0);
    }
}

export class Prng {
    private prng: MersenneTwister;
    private lastRandom = 0;

    static factory(seed: number | string, sequence: number): Prng {
        const numericSeed = Number.isNaN(Number(seed))
            ? Crc32.calculateCrc(binaryStringToUint8Array(seed as string))
            : Number(seed + '' + sequence);
        return new Prng(numericSeed);
    }

    constructor(seed: number) {
        this.prng = new MersenneTwister(seed);
    }

    generateRandomInt(min: number, max: number): number {
        const random = this.prng.random();
        this.lastRandom = random;
        return Math.floor(random * (max - min + 1)) + min;
    }

    generateRandom(): number {
        const random = this.prng.random();
        this.lastRandom = random;
        return random;
    }

    getLastRandom(): number {
        return this.lastRandom;
    }
}
