import { describe, expect, it } from 'vitest';
import '../characters';
import { createMatch, stepMatch } from '../engine/match';
import { getChar } from '../engine/registry';
import { BTN, PX, type MatchState } from '../engine/types';

/**
 * Zoro's combos, checked frame by frame at point-blank against a dummy that
 * does nothing (or only guards). Against Luffy and against Akainu, who is
 * much bigger.
 */

const { up, down, right, light, heavy, special } = BTN;

function fight(p2: string): MatchState {
    const s = createMatch('zoro', p2);
    while (s.phase !== 'fight') stepMatch(s, [0, 0]);
    return s;
}

/** Puts P1 `gap` pixels in front of P2's body (0 = bodies touching). */
function place(s: MatchState, gap = 4) {
    const [a, b] = s.fighters;
    a.x = b.x - (getChar(a.char).width + getChar(b.char).width + gap) * PX;
}

interface Log { hits: string[]; blocks: number; maxCombo: number }

/** Plays P1's inputs one per tick while P2 holds `p2`, logging which of
 *  P1's moves hit. */
function play(s: MatchState, p1: number[], p2 = 0): Log {
    const log: Log = { hits: [], blocks: 0, maxCombo: 0 };
    for (const input of p1) {
        for (const e of stepMatch(s, [input, p2])) {
            if (e.type === 'hit' && e.attacker === 0) log.hits.push(s.fighters[0].move ?? '?');
            if (e.type === 'block' && e.attacker === 0) log.blocks++;
            if (e.type === 'combo' && e.side === 0) log.maxCombo = Math.max(log.maxCombo, e.hits);
        }
    }
    return log;
}

/** `n` ticks of `input`, or an input pressed on one tick and released for the rest. */
const holdFor = (input: number, n: number) => Array<number>(n).fill(input);
const press = (input: number, n: number, held = 0) => [input, ...holdFor(held, n - 1)];
/** Mashes `input` every other tick for `n` ticks. */
const mash = (input: number, n: number, held = 0) => Array.from({ length: n }, (_, i) => (i % 2 ? held : input | held));
const unique = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) === i);

for (const foe of ['luffy', 'akainu']) {
    describe(`Zoro vs ${foe}`, () => {
        it('lightA → lightB → lightC connects all three', () => {
            const s = fight(foe);
            place(s);
            const log = play(s, [...press(light, 2), ...mash(light, 50), ...holdFor(0, 40)]);
            expect(unique(log.hits)).toEqual(['lightA', 'lightB', 'lightC']);
            expect(log.maxCombo).toBeGreaterThanOrEqual(3);
        });

        it('lightA → crouchHeavy combos', () => {
            const s = fight(foe);
            place(s);
            const log = play(s, [...press(light, 3), ...mash(down | heavy, 20, down), ...holdFor(0, 60)]);
            expect(unique(log.hits)).toEqual(['lightA', 'crouchHeavy']);
            expect(log.maxCombo).toBeGreaterThanOrEqual(2);
        });

        it('heavy cancels into Oni Giri (→S) and it all combos', () => {
            const s = fight(foe);
            place(s);
            const log = play(s, [...press(heavy, 8), ...mash(special, 16, right), ...holdFor(0, 100)]);
            expect(unique(log.hits)).toEqual(['heavy', 'specialF']);
            expect(log.maxCombo).toBeGreaterThanOrEqual(2);
            expect(getChar(foe).health - s.fighters[1].health).toBeGreaterThanOrEqual(120);
        });

        it('the throw lands, pressed together or a tick apart', () => {
            const s = fight(foe);
            place(s);
            play(s, [light | heavy, ...holdFor(0, 60)]);
            expect(s.fighters[1].health).toBeLessThan(getChar(foe).health);

            const s2 = fight(foe);
            place(s2);
            play(s2, [light, light | heavy, ...holdFor(0, 60)]);
            expect(s2.fighters[0].move === null || s2.fighters[0].move === 'throw').toBe(true);
            expect(s2.fighters[1].health).toBeLessThan(getChar(foe).health);
        });

        it('the ultimate (Sanzen Sekai) connects with a full bar and hurts', () => {
            const s = fight(foe);
            place(s);
            s.fighters[0].meter = 100;
            const log = play(s, [heavy | special, ...holdFor(0, 260)]);
            expect(log.hits[0]).toBe('ultimate');
            expect(log.hits.length).toBeGreaterThanOrEqual(2);
            expect(getChar(foe).health - s.fighters[1].health).toBeGreaterThanOrEqual(250);
        });

        it('O with two bars unleashes Kyūtōryū Ashura and it hits hard', () => {
            const s = fight(foe);
            place(s);
            s.fighters[0].meter = 200;
            stepMatch(s, [light | heavy | special, 0]);
            expect(s.fighters[0].move).toBe('ultimate2');
            expect(s.fighters[0].meter).toBe(0);
            const log = play(s, holdFor(0, 320));
            expect(log.hits[0]).toBe('ultimate2');
            expect(log.hits.length).toBeGreaterThanOrEqual(6);
            expect(getChar(foe).health - s.fighters[1].health).toBeGreaterThanOrEqual(400);
        });

        it('O with a single bar does nothing and keeps the gauge', () => {
            const s = fight(foe);
            place(s);
            s.fighters[0].meter = 100;
            stepMatch(s, [light | heavy | special, 0]);
            expect(s.fighters[0].move).not.toBe('ultimate2');
            const log = play(s, holdFor(0, 120));
            expect(log.hits).not.toContain('ultimate2');
            expect(s.fighters[0].meter).toBeGreaterThanOrEqual(100);
        });

        it('heavy cancels into the two-bar ultimate and it combos', () => {
            const s = fight(foe);
            place(s);
            s.fighters[0].meter = 200;
            const log = play(s, [...press(heavy, 8), ...mash(light | heavy | special, 16), ...holdFor(0, 320)]);
            expect(unique(log.hits)).toEqual(['heavy', 'ultimate2']);
            expect(log.maxCombo).toBeGreaterThanOrEqual(4);
        });

        it('Sanjuroku Pound Ho flies across mid range', () => {
            const s = fight(foe);
            place(s, 110);
            const log = play(s, [special, ...holdFor(0, 80)]);
            expect(log.hits.length).toBe(1);
            expect(s.fighters[1].health).toBeLessThan(getChar(foe).health);
        });

        it('Tatsumaki (↓S) hits several times then launches', () => {
            const s = fight(foe);
            place(s);
            const log = play(s, [down | special, ...holdFor(0, 70)]);
            expect(log.hits.filter((h) => h === 'specialD').length).toBeGreaterThanOrEqual(3);
            expect(log.maxCombo).toBeGreaterThanOrEqual(3);
        });

        it('the Oni Giri dash reaches from a distance', () => {
            const s = fight(foe);
            place(s, 50);
            const log = play(s, [right | special, ...holdFor(0, 60)]);
            expect(log.hits).toEqual(['specialF']);
        });

        it('Nobori Ryū (↑S) catches a jump', () => {
            const s = fight(foe);
            place(s, 10);
            // P2 jumps straight up; P1 answers when it is well off the ground.
            stepMatch(s, [0, up]);
            let t = 0;
            while (s.fighters[1].y < 24 * PX && t++ < 40) stepMatch(s, [0, 0]);
            expect(s.fighters[1].y).toBeGreaterThan(0);
            const log = play(s, [up | special, ...holdFor(0, 50)]);
            expect(log.hits).toContain('specialU');
        });

        it('crouchLight is low: only a crouching guard stops it', () => {
            const s = fight(foe);
            place(s);
            const hit = play(s, [down, down | light, ...holdFor(down, 25)], right);
            expect(hit.hits).toEqual(['crouchLight']);

            const s2 = fight(foe);
            place(s2);
            const blocked = play(s2, [down, down | light, ...holdFor(down, 25)], right | down);
            expect(blocked.hits).toEqual([]);
            expect(blocked.blocks).toBe(1);
        });

        it('heavyFwd is an overhead: only a standing guard stops it', () => {
            const s = fight(foe);
            place(s);
            const hit = play(s, [right | heavy, ...holdFor(0, 50)], right | down);
            expect(hit.hits).toEqual(['heavyFwd']);

            const s2 = fight(foe);
            place(s2);
            const blocked = play(s2, [right | heavy, ...holdFor(0, 50)], right);
            expect(blocked.hits).toEqual([]);
            expect(blocked.blocks).toBe(1);
        });

        it('heavyBack launches', () => {
            const s = fight(foe);
            place(s);
            const log = play(s, [heavy | BTN.left, ...holdFor(0, 20)]);
            expect(log.hits).toEqual(['heavyBack']);
            expect(s.fighters[1].y).toBeGreaterThan(0);
        });

        it('Sanzen Sekai dashes through from mid range and lands Zoro behind', () => {
            const s = fight(foe);
            place(s, 60);
            s.fighters[0].meter = 100;
            const log = play(s, [heavy | special, ...holdFor(0, 260)]);
            expect(log.hits[0]).toBe('ultimate');
            expect(s.fighters[0].x).toBeGreaterThan(s.fighters[1].x);
        });
    });
}

describe('Zoro staging', () => {
    const z = getChar('zoro');
    const panels = (slot: string) => z.manifest.cinematics?.[slot] ?? [];

    it('Ashura plays the three-faced panel over the red background, the red Asura behind him and its sounds', () => {
        const u2 = panels('ultimate2');
        const images = u2.map((p) => p.image);
        expect(images).toEqual(expect.arrayContaining(['ashura_bg', 'ashura_panel', 'kanon']));
        expect(u2.some((p) => p.layout === 'fighter')).toBe(true);
        expect(u2.some((p) => p.sfx)).toBe(true);
        const fx = z.moves.ultimate2.fx ?? [];
        expect(fx.some(([, anim]) => anim === 'fx_kanon')).toBe(true);
        expect(z.manifest.anims.fx_kanon.behind).toBe(true);
        expect(fx.some(([, anim]) => anim === 'fx_crescent')).toBe(true);
        expect(z.moves.ultimate2.superFreeze).toBeGreaterThanOrEqual(110);
    });

    it('Sanzen Sekai is announced with its own panels and the menacing aura', () => {
        const images = panels('ultimate').map((p) => p.image);
        expect(images).toEqual(expect.arrayContaining(['sz_swirl', 'sz_title', 'sz_school', 'sz_sky']));
        const fx = (z.moves.ultimate.fx ?? []).map(([, anim]) => anim);
        expect(fx).toEqual(expect.arrayContaining(['fx_aura', 'fx_gogo']));
    });

    it('the Ashura cut-in plays from the freeze while the fight is frozen', () => {
        const s = createMatch('zoro', 'luffy');
        while (s.phase !== 'fight') stepMatch(s, [0, 0]);
        place(s);
        s.fighters[0].meter = 200;
        const ev = stepMatch(s, [light | heavy | special, 0]);
        expect(ev).toContainEqual(expect.objectContaining({ type: 'superFreeze', char: 'zoro', slot: 'ultimate2' }));
        const freeze = s.freeze?.t ?? 0;
        const end = Math.max(...panels('ultimate2').filter((p) => p.layout !== 'fighter').map((p) => p.to));
        expect(end).toBeLessThanOrEqual(freeze + 30);
    });
});
