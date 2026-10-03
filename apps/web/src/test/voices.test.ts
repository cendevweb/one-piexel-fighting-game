import { describe, expect, it } from 'vitest';
import { ROSTER } from '../characters';
import manifest from '../generated/voices.json';
import { opensWithVoices } from '../audio/voices';

/** Fighters without ultimate lines until their rework. */
const NO_ULTIMATE = ['crocodile', 'zoro'];
/** The clips shipped in public/ (the glob only lists them, nothing is loaded). */
const FILES = new Set(Object.keys(import.meta.glob('../../public/audio/voices/**/*.{ogg,m4a}')).map((p) => p.replace('../../public/audio/voices/', '')));

describe('voices', () => {
    const clips = manifest as Record<string, Record<string, string[]>>;

    it('covers every fighter with every category', () => {
        for (const c of ROSTER) {
            const all = ['select', 'start', 'win', 'roundLose', 'ultimate', 'ultimateMax'];
            for (const category of NO_ULTIMATE.includes(c.id) ? all.slice(0, 4) : all) {
                expect(clips[c.id]?.[category]?.length ?? 0, `${c.id} ${category}`).toBeGreaterThan(0);
            }
        }
    });

    it('only names real fighters', () => {
        const ids = ROSTER.map((c) => c.id);
        for (const id of Object.keys(clips)) expect(ids).toContain(id);
    });

    it('ships every clip as Ogg and as AAC (Safari)', () => {
        for (const path of Object.values(clips).flatMap((c) => Object.values(c).flat())) {
            expect(FILES.has(`${path}.ogg`), path).toBe(true);
            expect(FILES.has(`${path}.m4a`), path).toBe(true);
        }
    });

    it('opens every fight with both lines, except in training', () => {
        for (const mode of ['arcade', 'versus', 'versusCpu', 'online', 'spectate']) expect(opensWithVoices(mode), mode).toBe(true);
        expect(opensWithVoices('training')).toBe(false);
    });
});
