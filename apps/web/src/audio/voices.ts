import manifest from '../generated/voices.json';
import { ensureAudio, runningContext, voiceOut } from './sound';

/**
 * Recorded character voices (`public/audio/voices`, imported by
 * `tools/audio/import_voices.mjs`). Every clip is fetched and decoded while
 * the game loads, so a voice starts on the very frame it is asked for. The
 * clips of one category are chained back to back, without a gap.
 *
 * Voices only ever follow what the view shows: nothing here is read by the
 * engine, so the online fingerprint and the rollback are untouched.
 */

/** `start` opens a fight (once, not every round); `roundLose` answers a
 *  round lost by a human player, as `win` does a round won. */
export type VoiceCategory = 'select' | 'win' | 'ultimate' | 'ultimateMax' | 'roundLose' | 'start';

type Manifest = Record<string, Partial<Record<VoiceCategory, string[]>>>;
const CLIPS = manifest as Manifest;

/** Voices are a little louder than the synthesised effects. */
const VOICE_GAIN = 1.4;

const buffers = new Map<string, AudioBuffer>();
let voiceBus: GainNode | null = null;

/** Safari (before 18.4) cannot decode Ogg Vorbis: every clip also exists as AAC. */
function preferredExt(): 'ogg' | 'm4a' {
    if (typeof Audio === 'undefined') return 'm4a';
    return new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'm4a';
}

async function decode(ac: AudioContext, url: string): Promise<AudioBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const data = await res.arrayBuffer();
    // The callback form: older Safari has no promise-returning decodeAudioData.
    return new Promise((resolve, reject) => ac.decodeAudioData(data, resolve, reject));
}

async function loadClip(ac: AudioContext, path: string, ext: 'ogg' | 'm4a'): Promise<void> {
    const base = `${import.meta.env.BASE_URL}audio/voices/${path}`;
    try {
        buffers.set(path, await decode(ac, `${base}.${ext}`));
    } catch {
        // canPlayType can say "maybe" and still fail: try the other format.
        try {
            buffers.set(path, await decode(ac, `${base}.${ext === 'ogg' ? 'm4a' : 'ogg'}`));
        } catch (err) {
            console.warn('Voix introuvable :', path, err);
        }
    }
}

/**
 * One loading job per clip, for the loading bar. A clip that fails is
 * skipped (the game plays on without it), so these never reject.
 */
export function voiceJobs(): Promise<void>[] {
    const ac = ensureAudio();
    if (!ac) return [];
    const ext = preferredExt();
    const paths = Object.values(CLIPS).flatMap((c) => Object.values(c).flat()) as string[];
    return paths.map((p) => loadClip(ac, p, ext));
}

export const hasVoice = (char: string, category: VoiceCategory): boolean => (CLIPS[char]?.[category]?.length ?? 0) > 0;

/** What is playing on each channel, so a new line cuts the previous one off. */
const channels = new Map<string, AudioBufferSourceNode[]>();

/** Stops whatever is playing on `channel`. */
export function stopVoice(channel: string): void {
    for (const src of channels.get(channel) ?? []) {
        try { src.stop(); } catch { /* already ended */ }
    }
    channels.delete(channel);
}

/** How long a character's line of that category lasts, in seconds (0 when
 *  it has none or is not loaded yet). */
export function voiceLength(char: string, category: VoiceCategory): number {
    return (CLIPS[char]?.[category] ?? []).reduce((t, path) => t + (buffers.get(path)?.duration ?? 0), 0);
}

/**
 * Plays a character's line of that category, its numbered clips chained in
 * order, `delay` seconds from now. `channel` (one per player, say) cuts off
 * the line still playing there. Returns whether anything started.
 */
export function playVoice(char: string, category: VoiceCategory, channel = char, delay = 0): boolean {
    const ac = runningContext();
    const out = voiceOut();
    const list = CLIPS[char]?.[category];
    if (!ac || !out || !list?.length) return false;
    if (!voiceBus) {
        voiceBus = ac.createGain();
        voiceBus.gain.value = VOICE_GAIN;
        voiceBus.connect(out);
    }
    stopVoice(channel);
    const sources: AudioBufferSourceNode[] = [];
    let t = ac.currentTime + delay;
    for (const path of list) {
        const buf = buffers.get(path);
        if (!buf) continue;
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.connect(voiceBus);
        src.start(t);
        t += buf.duration;
        sources.push(src);
    }
    if (!sources.length) return false;
    channels.set(channel, sources);
    // Forget the channel once its last clip is over (unless replaced since).
    sources[sources.length - 1].onended = () => { if (channels.get(channel) === sources) channels.delete(channel); };
    return true;
}

/** Whether a fight in `mode` opens with both fighters' lines: training has
 *  no fight to open, so it stays silent. */
export const opensWithVoices = (mode: string): boolean => mode !== 'training';

/**
 * Both fighters' opening lines, J1 then J2, once at the start of a fight.
 * The same fighter twice speaks twice.
 */
export function playStartVoices(chars: readonly string[], channel: (side: number) => string): void {
    let delay = 0;
    chars.forEach((char, side) => {
        if (playVoice(char, 'start', channel(side), delay)) delay += voiceLength(char, 'start');
    });
}

/**
 * The end of a round, for the players at the screen: `humans` lists the
 * sides they play. A human winner gets their victory line, a human loser
 * their defeat line, the loser speaking after the winner when both are human.
 */
export function playRoundEndVoices(chars: readonly string[], winner: number, humans: readonly number[], channel: (side: number) => string): void {
    if (winner > 1) return;
    const loser = 1 - winner;
    let delay = 0;
    if (humans.includes(winner) && playVoice(chars[winner], 'win', channel(winner))) delay = voiceLength(chars[winner], 'win');
    if (humans.includes(loser)) playVoice(chars[loser], 'roundLose', channel(loser), delay);
}
