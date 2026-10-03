import { onSettings, settings, volumeGain, type Settings } from '../settings';

/**
 * Every sound effect is synthesised with WebAudio; only the character
 * voices are recorded clips (`voices.ts`). Short envelopes over noise and simple oscillators give the crunchy,
 * handheld-era feel of the source game.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let voiceBus: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

/** Each bus at the default gauge level (the original mix); the settings scale them. */
const BASE = { master: 0.7, sfx: 0.8, music: 0.45, voice: 0.8 };

export function unlockAudio(): void {
    const ac = ensureAudio();
    if (ac?.state === 'suspended') void ac.resume();
}

/**
 * Builds the audio graph if needed. A context made before any key press
 * stays suspended, but it can already decode the voice clips while the game
 * loads; the first key press or click resumes it (`unlockAudio`).
 */
export function ensureAudio(): AudioContext | null {
    if (ctx) return ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.connect(master);
    voiceBus = ctx.createGain();
    voiceBus.connect(master);
    applyVolumes(settings, true);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
}

/** The context, only while it actually plays: sounds asked for while it is
 *  suspended would otherwise all burst out at once when it resumes. */
export const runningContext = (): AudioContext | null => (ctx?.state === 'running' ? ctx : null);

/** Sets every bus from the gauges; a short glide, so a slider never clicks. */
function applyVolumes(s: Readonly<Settings>, now = false): void {
    if (!ctx) return;
    const set = (node: GainNode | null, value: number) => {
        if (!node) return;
        if (now) node.gain.value = value;
        else node.gain.setTargetAtTime(value, ctx!.currentTime, 0.02);
    };
    set(master, BASE.master * volumeGain(s.master));
    set(sfxBus, BASE.sfx * volumeGain(s.sfx));
    set(musicBus, BASE.music * volumeGain(s.music));
    set(voiceBus, BASE.voice * volumeGain(s.voice));
}

onSettings((s) => applyVolumes(s));

export const audioContext = () => ctx;
export const musicOut = () => musicBus;
export const sfxOut = () => sfxBus;
export const voiceOut = () => voiceBus;

interface Env { a?: number; d: number; peak?: number }

function envelope(g: GainNode, t: number, e: Env): void {
    const a = e.a ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(e.peak ?? 0.5, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + e.d);
}

function noise(t: number, dur: number, filter: BiquadFilterType, f0: number, f1: number, e: Env, q = 1): void {
    if (!ctx || !noiseBuffer || !sfxBus) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t);
    bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    envelope(g, t, e);
    src.connect(bq).connect(g).connect(sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
}

function tone(t: number, type: OscillatorType, f0: number, f1: number, e: Env, dest?: AudioNode): void {
    if (!ctx || !sfxBus) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + (e.a ?? 0.002) + e.d);
    const g = ctx.createGain();
    envelope(g, t, e);
    o.connect(g).connect(dest ?? sfxBus);
    o.start(t);
    o.stop(t + (e.a ?? 0.002) + e.d + 0.05);
}

const SOUNDS: Record<string, (t: number) => void> = {
    swing: (t) => noise(t, 0.09, 'bandpass', 1800, 4200, { d: 0.08, peak: 0.25 }, 2),
    swingHeavy: (t) => noise(t, 0.16, 'bandpass', 700, 2600, { a: 0.01, d: 0.15, peak: 0.35 }, 1.5),
    stretch: (t) => { tone(t, 'triangle', 180, 720, { d: 0.18, peak: 0.3 }); noise(t, 0.12, 'bandpass', 1200, 3000, { d: 0.1, peak: 0.15 }); },
    gatling: (t) => { for (let i = 0; i < 5; i++) noise(t + i * 0.045, 0.04, 'bandpass', 2400, 1400, { d: 0.035, peak: 0.25 }, 3); },
    bazooka: (t) => { tone(t, 'square', 140, 60, { d: 0.25, peak: 0.3 }); noise(t, 0.3, 'lowpass', 1800, 200, { d: 0.28, peak: 0.4 }); },
    fire: (t) => { noise(t, 0.35, 'lowpass', 3000, 400, { a: 0.02, d: 0.32, peak: 0.35 }); noise(t + 0.05, 0.2, 'highpass', 3000, 5000, { d: 0.15, peak: 0.1 }); },
    electric: (t) => {
        for (let i = 0; i < 6; i++) tone(t + i * 0.025, 'square', 900 + Math.random() * 1600, 200 + Math.random() * 400, { d: 0.03, peak: 0.12 });
        noise(t, 0.2, 'highpass', 2000, 6000, { d: 0.18, peak: 0.2 });
    },
    sand: (t) => noise(t, 0.4, 'bandpass', 600, 2400, { a: 0.05, d: 0.34, peak: 0.28 }, 0.8),
    magma: (t) => { tone(t, 'sawtooth', 90, 40, { a: 0.02, d: 0.4, peak: 0.25 }); noise(t, 0.45, 'lowpass', 900, 120, { a: 0.03, d: 0.42, peak: 0.4 }); },
    slash: (t) => noise(t, 0.12, 'highpass', 3000, 7000, { d: 0.1, peak: 0.3 }, 1.2),
    /** A heavy sword draw: a long swish with a metallic ring under it. */
    slashHeavy: (t) => {
        noise(t, 0.2, 'highpass', 1800, 7000, { a: 0.01, d: 0.18, peak: 0.38 }, 1);
        tone(t + 0.03, 'triangle', 2400, 1900, { d: 0.25, peak: 0.07 });
        tone(t + 0.03, 'sine', 3600, 3300, { d: 0.2, peak: 0.05 });
    },
    /** Iai: a blade leaving its sheath, a bright metallic shing. */
    iai: (t) => {
        noise(t, 0.08, 'highpass', 4000, 9000, { d: 0.07, peak: 0.3 }, 2);
        tone(t + 0.02, 'sine', 4200, 3900, { d: 0.45, peak: 0.09 });
        tone(t + 0.02, 'triangle', 2800, 2700, { d: 0.35, peak: 0.07 });
    },
    /** ゴゴゴゴ: a menacing rumble rolling in four waves. */
    menace: (t) => {
        for (let i = 0; i < 4; i++) noise(t + i * 0.13, 0.16, 'lowpass', 420, 120, { a: 0.03, d: 0.13, peak: 0.42 });
        tone(t, 'sawtooth', 55, 48, { a: 0.1, d: 0.5, peak: 0.16 });
    },
    /** Ashura: a temple gong under a deep drone, the nine swords drawn. */
    ashura: (t) => {
        tone(t, 'sine', 98, 92, { a: 0.01, d: 1.4, peak: 0.4 });
        tone(t, 'triangle', 196, 186, { a: 0.01, d: 1.1, peak: 0.16 });
        tone(t, 'sine', 523, 517, { a: 0.01, d: 0.9, peak: 0.07 });
        tone(t + 0.05, 'sawtooth', 49, 44, { a: 0.3, d: 1.0, peak: 0.12 });
        noise(t, 0.6, 'lowpass', 600, 90, { a: 0.02, d: 0.55, peak: 0.25 });
    },
    /** A whirl of blades cutting the air, rising. */
    whirl: (t) => { for (let i = 0; i < 6; i++) noise(t + i * 0.06, 0.08, 'bandpass', 1400 + i * 400, 3000 + i * 500, { d: 0.07, peak: 0.22 }, 1.5); },
    /** A string pulled taut: a short, bent twang. */
    thread: (t) => {
        tone(t, 'triangle', 1500, 700, { d: 0.12, peak: 0.16 });
        tone(t + 0.01, 'sawtooth', 760, 380, { d: 0.09, peak: 0.06 });
        noise(t, 0.05, 'highpass', 5000, 8000, { d: 0.04, peak: 0.16 });
    },
    /** Law's Room opening: a hollow, rising hum. */
    room: (t) => {
        tone(t, 'sine', 180, 520, { a: 0.05, d: 0.45, peak: 0.22 });
        tone(t, 'triangle', 362, 1046, { a: 0.05, d: 0.4, peak: 0.08 });
        noise(t, 0.5, 'bandpass', 800, 2400, { a: 0.1, d: 0.35, peak: 0.1 }, 4);
    },
    grab: (t) => { tone(t, 'square', 220, 110, { d: 0.06, peak: 0.2 }); noise(t, 0.06, 'lowpass', 1200, 400, { d: 0.05, peak: 0.3 }); },
    beam: (t) => { tone(t, 'sawtooth', 300, 1400, { a: 0.05, d: 0.4, peak: 0.18 }); tone(t, 'square', 150, 700, { a: 0.05, d: 0.4, peak: 0.1 }); },
    gigant: (t) => { tone(t, 'sawtooth', 60, 30, { a: 0.05, d: 0.7, peak: 0.35 }); noise(t, 0.8, 'lowpass', 1500, 80, { a: 0.1, d: 0.7, peak: 0.45 }); },
    /** Frost forming: a glassy crackle over a cold hiss. */
    ice: (t) => {
        for (let i = 0; i < 4; i++) tone(t + i * 0.03, 'sine', 2600 + i * 400, 1800 + i * 300, { d: 0.06, peak: 0.08 });
        noise(t, 0.3, 'highpass', 4000, 7000, { a: 0.02, d: 0.26, peak: 0.2 });
    },
    /** A beam of light: a bright, rising whine. */
    laser: (t) => { tone(t, 'sine', 1200, 3200, { d: 0.18, peak: 0.16 }); tone(t, 'square', 2400, 4800, { d: 0.1, peak: 0.05 }); noise(t, 0.1, 'highpass', 6000, 9000, { d: 0.08, peak: 0.12 }); },
    /** Whitebeard's quake: a crack, then a long rumble. */
    quake: (t) => {
        noise(t, 0.06, 'highpass', 3000, 5000, { d: 0.05, peak: 0.4 });
        tone(t, 'sine', 55, 30, { a: 0.02, d: 0.8, peak: 0.45 });
        noise(t, 0.9, 'lowpass', 600, 60, { a: 0.03, d: 0.85, peak: 0.5 });
    },
    /** Magnetism: a metallic clank and a pulsing hum. */
    magnet: (t) => { tone(t, 'square', 90, 140, { a: 0.02, d: 0.3, peak: 0.16 }); tone(t, 'triangle', 1700, 1300, { d: 0.12, peak: 0.12 }); noise(t, 0.08, 'bandpass', 2500, 1200, { d: 0.07, peak: 0.25 }, 3); },
    /** Darkness: a low, inward suck. */
    dark: (t) => { tone(t, 'sawtooth', 220, 50, { a: 0.03, d: 0.5, peak: 0.2 }); noise(t, 0.5, 'lowpass', 400, 1600, { a: 0.2, d: 0.3, peak: 0.3 }); },
    /** Venom: a wet, bubbling splash. */
    poison: (t) => { for (let i = 0; i < 5; i++) tone(t + i * 0.05, 'sine', 300 + Math.random() * 300, 700 + Math.random() * 400, { d: 0.04, peak: 0.1 }); noise(t, 0.3, 'bandpass', 900, 400, { a: 0.02, d: 0.26, peak: 0.25 }, 1.5); },
    /** Kuma's paw: a soft pop and a blast of air. */
    paw: (t) => { tone(t, 'sine', 400, 80, { d: 0.12, peak: 0.3 }); noise(t, 0.3, 'bandpass', 1400, 400, { a: 0.01, d: 0.27, peak: 0.35 }, 0.7); },
    /** A charm: a sparkling two-note chime. */
    love: (t) => { tone(t, 'sine', 1319, 1319, { d: 0.12, peak: 0.12 }); tone(t + 0.07, 'sine', 1760, 1760, { d: 0.2, peak: 0.12 }); noise(t, 0.2, 'highpass', 6000, 9000, { d: 0.18, peak: 0.06 }); },
    /** Petals, feathers: a soft flutter. */
    flutter: (t) => { for (let i = 0; i < 4; i++) noise(t + i * 0.04, 0.05, 'bandpass', 3000, 2000, { d: 0.04, peak: 0.12 }, 2); },

    hitLight: (t) => { noise(t, 0.07, 'bandpass', 2600, 900, { d: 0.06, peak: 0.55 }, 1.2); tone(t, 'square', 320, 90, { d: 0.05, peak: 0.25 }); },
    hitHeavy: (t) => { noise(t, 0.14, 'lowpass', 4000, 300, { d: 0.13, peak: 0.7 }); tone(t, 'square', 180, 45, { d: 0.12, peak: 0.4 }); },
    hitBig: (t) => {
        noise(t, 0.4, 'lowpass', 5000, 100, { d: 0.38, peak: 0.85 });
        tone(t, 'sawtooth', 120, 30, { d: 0.35, peak: 0.45 });
        tone(t + 0.02, 'square', 70, 28, { d: 0.3, peak: 0.3 });
    },
    counter: (t) => { tone(t, 'square', 1320, 1320, { d: 0.04, peak: 0.14 }); tone(t + 0.05, 'square', 1760, 1760, { d: 0.07, peak: 0.14 }); },
    block: (t) => { tone(t, 'square', 1400, 900, { d: 0.05, peak: 0.2 }); noise(t, 0.05, 'highpass', 4000, 6000, { d: 0.04, peak: 0.25 }); },
    crush: (t) => { tone(t, 'square', 800, 100, { d: 0.35, peak: 0.3 }); noise(t, 0.3, 'bandpass', 3000, 400, { d: 0.3, peak: 0.4 }); },
    jump: (t) => tone(t, 'square', 260, 520, { d: 0.07, peak: 0.08 }),
    land: (t) => noise(t, 0.06, 'lowpass', 800, 200, { d: 0.05, peak: 0.2 }),
    thud: (t) => { noise(t, 0.2, 'lowpass', 700, 60, { d: 0.18, peak: 0.6 }); tone(t, 'sine', 90, 40, { d: 0.18, peak: 0.4 }); },
    dash: (t) => noise(t, 0.15, 'bandpass', 900, 2800, { a: 0.02, d: 0.12, peak: 0.2 }, 1),
    tech: (t) => { tone(t, 'square', 1200, 1200, { d: 0.05, peak: 0.15 }); tone(t + 0.06, 'square', 1600, 1600, { d: 0.05, peak: 0.15 }); },
    superFreeze: (t) => {
        tone(t, 'sawtooth', 110, 880, { a: 0.02, d: 0.5, peak: 0.25 });
        tone(t, 'square', 220, 1760, { a: 0.02, d: 0.45, peak: 0.12 });
        noise(t, 0.5, 'highpass', 1500, 8000, { a: 0.05, d: 0.45, peak: 0.2 });
    },
    ko: (t) => {
        noise(t, 1.2, 'lowpass', 6000, 60, { d: 1.1, peak: 0.9 });
        tone(t, 'sawtooth', 200, 25, { d: 1.0, peak: 0.4 });
    },

    uiMove: (t) => tone(t, 'square', 880, 880, { d: 0.035, peak: 0.12 }),
    uiConfirm: (t) => { tone(t, 'square', 660, 660, { d: 0.05, peak: 0.15 }); tone(t + 0.06, 'square', 990, 990, { d: 0.09, peak: 0.15 }); },
    uiBack: (t) => { tone(t, 'square', 520, 520, { d: 0.05, peak: 0.12 }); tone(t + 0.05, 'square', 390, 390, { d: 0.07, peak: 0.12 }); },
    uiSelect: (t) => { [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.05, 'square', f, f, { d: 0.08, peak: 0.13 })); },
    round: (t) => { [392, 392, 523].forEach((f, i) => tone(t + i * 0.12, 'square', f, f, { d: 0.1, peak: 0.15 })); },
    fight: (t) => {
        [523, 659, 784].forEach((f, i) => tone(t + i * 0.06, 'square', f, f, { d: 0.08, peak: 0.16 }));
        tone(t + 0.2, 'sawtooth', 1047, 1047, { d: 0.35, peak: 0.18 });
        noise(t + 0.2, 0.3, 'highpass', 2000, 6000, { d: 0.3, peak: 0.15 });
    },
    win: (t) => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(t + i * 0.11, 'square', f, f, { d: 0.12, peak: 0.15 })); },
    lose: (t) => { [392, 370, 349, 262].forEach((f, i) => tone(t + i * 0.18, 'triangle', f, f, { d: 0.2, peak: 0.2 })); }
};

/** Whether a sound of that name exists (character data is checked against it). */
export const hasSound = (name: string): boolean => name in SOUNDS;

export function play(name: string | undefined, delay = 0): void {
    const ac = runningContext();
    if (!name || !ac) return;
    const fn = SOUNDS[name];
    if (fn) fn(ac.currentTime + delay);
}
