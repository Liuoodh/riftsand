/**
 * Procedural audio.
 * Every sound is synthesised at runtime with WebAudio — no audio files, so the
 * mini-game package stays tiny and the sound design is entirely original.
 * Works in the browser and in WeChat / Douyin mini-games (wx.createWebAudioContext).
 */

type Ctx = any;

interface Voice {
    /** minimum gap between two plays of the same cue, ms */
    gap: number;
}

const VOICES: Record<string, Voice> = {
    gun: { gap: 55 },
    cannon: { gap: 70 },
    rocket: { gap: 80 },
    boom: { gap: 70 },
    ready: { gap: 200 },
    unitready: { gap: 160 },
    promote: { gap: 160 },
    click: { gap: 45 },
    alarm: { gap: 900 },
    swready: { gap: 400 },
    superweapon: { gap: 400 },
    orbital: { gap: 400 },
    capture: { gap: 250 },
    crate: { gap: 160 },
    deploy: { gap: 400 },
    scatter: { gap: 70 },
    sell: { gap: 150 },
    unload: { gap: 120 },
    build: { gap: 200 },
};

export class Sfx {
    private ctx: Ctx = null;
    private master: Ctx = null;
    private noiseBuf: Ctx = null;
    private last: Record<string, number> = {};
    private budget = 0;
    private budgetAt = 0;
    muted = false;
    volume = 0.55;

    /** must be called from a user gesture (start button / first tap) */
    init() {
        if (this.ctx) return;
        try {
            const g: any = globalThis as any;
            if (g.wx && typeof g.wx.createWebAudioContext === 'function') {
                this.ctx = g.wx.createWebAudioContext();
            } else {
                const AC = g.AudioContext || g.webkitAudioContext;
                if (!AC) return;
                this.ctx = new AC();
            }
            this.master = this.ctx.createGain();
            this.master.gain.value = this.volume;
            this.master.connect(this.ctx.destination);

            // 1 second of white noise, reused by every impact
            const len = Math.floor((this.ctx.sampleRate || 44100) * 0.6);
            const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate || 44100);
            const data = buf.getChannelData(0);
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
            this.noiseBuf = buf;
        } catch (e) {
            this.ctx = null;
        }
    }

    resume() {
        try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) { /* best effort */ }
    }

    setMuted(m: boolean) {
        this.muted = m;
        try { if (this.master) this.master.gain.value = m ? 0 : this.volume; } catch (e) { /* ignore */ }
    }

    private now() { return Date.now(); }

    play(name: string, gain = 1) {
        if (!this.ctx || this.muted || gain <= 0.01) return;
        const v = VOICES[name];
        if (!v) return;
        const t = this.now();
        if (t - (this.last[name] || 0) < v.gap) return;
        this.last[name] = t;

        // crude per-50ms voice budget so a big battle cannot machine-gun the mixer
        if (t - this.budgetAt > 50) { this.budgetAt = t; this.budget = 0; }
        if (this.budget > 6) return;
        this.budget++;

        try {
            switch (name) {
                case 'gun': this.blip(240, 0.05, 'square', 0.12 * gain, 120); this.noise(0.045, 2400, 0.1 * gain); break;
                case 'cannon': this.blip(150, 0.16, 'sawtooth', 0.18 * gain, 55); this.noise(0.18, 700, 0.24 * gain); break;
                case 'rocket': this.noise(0.26, 1600, 0.16 * gain); this.blip(320, 0.22, 'sawtooth', 0.1 * gain, 720); break;
                case 'boom': this.noise(0.34, 420, 0.34 * gain); this.blip(96, 0.3, 'sine', 0.22 * gain, 36); break;
                case 'ready': this.tone(660, 0.1, 'triangle', 0.16 * gain); this.tone(990, 0.12, 'triangle', 0.14 * gain, 0.09); break;
                case 'unitready': this.tone(520, 0.07, 'square', 0.1 * gain); this.tone(780, 0.08, 'square', 0.09 * gain, 0.06); break;
                case 'promote': this.tone(660, 0.1, 'triangle', 0.14 * gain); this.tone(880, 0.1, 'triangle', 0.13 * gain, 0.08); this.tone(1320, 0.16, 'triangle', 0.12 * gain, 0.16); break;
                case 'click': this.tone(900, 0.035, 'square', 0.07 * gain); break;
                case 'alarm': this.tone(440, 0.14, 'square', 0.1 * gain); this.tone(330, 0.16, 'square', 0.1 * gain, 0.17); break;
                case 'swready': this.tone(300, 0.2, 'sawtooth', 0.1 * gain, 0, 900); break;
                case 'superweapon': this.tone(180, 0.5, 'sawtooth', 0.14 * gain, 0, 640); this.noise(0.5, 900, 0.1 * gain); break;
                case 'orbital': this.noise(0.7, 260, 0.42 * gain); this.blip(70, 0.65, 'sine', 0.3 * gain, 28); break;
                case 'capture': this.tone(500, 0.08, 'square', 0.1 * gain, 0, 760); break;
                case 'crate': this.tone(720, 0.07, 'triangle', 0.11 * gain, 0, 1080); break;
                case 'deploy': this.noise(0.4, 300, 0.24 * gain); this.blip(120, 0.35, 'sawtooth', 0.18 * gain, 48); break;
                case 'scatter': this.noise(0.1, 1400, 0.1 * gain); break;
                case 'sell': this.tone(560, 0.09, 'square', 0.09 * gain, 0, 260); break;
                case 'unload': this.tone(880, 0.05, 'triangle', 0.07 * gain); break;
                case 'build': this.tone(300, 0.08, 'square', 0.09 * gain); this.tone(420, 0.1, 'square', 0.08 * gain, 0.08); break;
                default: break;
            }
        } catch (e) { /* audio must never break the game */ }
    }

    private tone(freq: number, dur: number, type: string, gain: number, delay = 0, slideTo = 0) {
        const ctx = this.ctx;
        if (!ctx) return;
        const t0 = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.min(0.02, dur * 0.3));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g);
        g.connect(this.master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }

    private blip(freq: number, dur: number, type: string, gain: number, slideTo: number) {
        this.tone(freq, dur, type, gain, 0, slideTo);
    }

    private noise(dur: number, cutoff: number, gain: number) {
        const ctx = this.ctx;
        if (!ctx || !this.noiseBuf) return;
        const t0 = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(cutoff, t0);
        f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.35), t0 + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(f);
        f.connect(g);
        g.connect(this.master);
        src.start(t0);
        src.stop(t0 + dur + 0.02);
    }
}

/** shared instance — the app owns the lifecycle, the game only posts cues */
export const sfx = new Sfx();
