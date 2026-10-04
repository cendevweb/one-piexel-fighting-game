import { describe, expect, it } from 'vitest';
import '../characters';
import { createMatch, stepMatch } from '../engine/match';
import { getChar } from '../engine/registry';
import { BTN, PX, type MatchState } from '../engine/types';

/**
 * Magellan's combos, checked frame by frame at point-blank against a dummy that
 * does nothing (or only guards). Against Luffy and against Akainu, who is
 * as big as he is.
 */

const { up, down, right, light, heavy, special } = BTN;

function fight(p2: string): MatchState {
    const s = createMatch('magellan', p2);
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

describe('Doku Fugu', () => {
    it('is 20% smaller than it was (box and sprite) and hits twice at most', () => {
        const p = getChar('magellan').moves.specialF.projectile!;
        expect(p.box[2]).toBeLessThanOrEqual(36);
        expect(p.box[3]).toBeLessThanOrEqual(36);
        expect(p.scale).toBe(0.8);
        expect(p.hits).toBeLessThanOrEqual(2);
    });
});

for (const foe of ['luffy', 'akainu']) {
    describe(`Magellan vs ${foe}`, () => {
        it('lightA → lightB → lightC connects all three', () => {
            const s = fight(foe);
            place(s);
            const log = play(s, [...press(light, 2), ...mash(light, 60), ...holdFor(0, 40)]);
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

        it('heavy cancels into Doku Gumo (↓S) and it all combos', () => {
            const s = fight(foe);
            place(s);
            const log = play(s, [...press(heavy, 10), ...mash(down | special, 14, down), ...holdFor(0, 120)]);
            expect(unique(log.hits)).toEqual(['heavy', 'specialD']);
            expect(log.maxCombo).toBeGreaterThanOrEqual(3);
            expect(getChar(foe).health - s.fighters[1].health).toBeGreaterThanOrEqual(140);
        });

        it('the throw lands, pressed together or a tick apart', () => {
            const s = fight(foe);
            place(s);
            play(s, [light | heavy, ...holdFor(0, 70)]);
            expect(s.fighters[1].health).toBeLessThan(getChar(foe).health);

            const s2 = fight(foe);
            place(s2);
            play(s2, [light, light | heavy, ...holdFor(0, 70)]);
            expect(s2.fighters[0].move === null || s2.fighters[0].move === 'throw').toBe(true);
            expect(s2.fighters[1].health).toBeLessThan(getChar(foe).health);
        });

        it('the Venom Demon connects with a full bar and hurts', () => {
            const s = fight(foe);
            place(s);
            s.fighters[0].meter = 100;
            const log = play(s, [heavy | special, ...holdFor(0, 240)]);
            expect(log.hits[0]).toBe('ultimate');
            expect(log.hits.length).toBeGreaterThanOrEqual(5);
            expect(getChar(foe).health - s.fighters[1].health).toBeGreaterThanOrEqual(300);
        });

        it('O with two bars unleashes the Doku Hydra and it all lands', () => {
            const s = fight(foe);
            place(s);
            s.fighters[0].meter = 200;
            const log = play(s, [light | heavy | special, ...holdFor(0, 260)]);
            expect(log.hits[0]).toBe('ultimate2');
            expect(unique(log.hits)).toEqual(['ultimate2']);
            expect(log.hits.length).toBeGreaterThanOrEqual(5);
            expect(s.fighters[0].meter).toBeLessThan(200);
            expect(getChar(foe).health - s.fighters[1].health).toBeGreaterThanOrEqual(380);
        });

        it('O with a single bar does nothing and keeps the gauge', () => {
            const s = fight(foe);
            place(s);
            s.fighters[0].meter = 100;
            const log = play(s, [light | heavy | special, ...holdFor(0, 120)]);
            expect(log.hits).not.toContain('ultimate2');
            expect(s.fighters[0].meter).toBe(100);
        });

        it('the flood of the Doku Hydra reaches across the screen', () => {
            const s = fight(foe);
            place(s, 180);
            s.fighters[0].meter = 200;
            const log = play(s, [light | heavy | special, ...holdFor(0, 260)]);
            expect(log.hits).toEqual(['ultimate2']);
        });

        it('heavy cancels into the Doku Hydra and it combos', () => {
            const s = fight(foe);
            place(s);
            s.fighters[0].meter = 200;
            const log = play(s, [...press(heavy, 14), light | heavy | special, ...holdFor(0, 260)]);
            expect(unique(log.hits)).toEqual(['heavy', 'ultimate2']);
            expect(log.maxCombo).toBeGreaterThanOrEqual(6);
            expect(getChar(foe).health - s.fighters[1].health).toBeGreaterThanOrEqual(400);
        });

        it('Hydra flies across the screen', () => {
            const s = fight(foe);
            place(s, 140);
            const log = play(s, [special, ...holdFor(0, 90)]);
            expect(log.hits).toEqual(['specialN']);
            expect(s.fighters[1].health).toBeLessThan(getChar(foe).health);
        });

        it('Doku Fugu (→S) lobs a poison bomb that hits several times', () => {
            const s = fight(foe);
            place(s, 40);
            const log = play(s, [right | special, ...holdFor(0, 80)]);
            expect(log.hits.filter((h) => h === 'specialF').length).toBeGreaterThanOrEqual(2);
            expect(s.fighters[1].health).toBeLessThan(getChar(foe).health);
        });

        it('Doku Fugu blocked leaves Magellan open to a punish', () => {
            const s = fight(foe);
            place(s, 40);
            let lastBlock = -1;
            let free = -1;
            for (let t = 0; t < 160; t++) {
                for (const e of stepMatch(s, [t === 0 ? right | special : 0, right])) if (e.type === 'block' && e.attacker === 0) lastBlock = t;
                if (t > 0 && free < 0 && s.fighters[0].mode !== 'move') free = t;
            }
            expect(lastBlock).toBeGreaterThan(0);
            // Magellan is still recovering well after the bomb's last blocked hit.
            expect(free - lastBlock).toBeGreaterThanOrEqual(14);
        });

        it('Doku Gumo (↓S) hits several times then knocks down', () => {
            const s = fight(foe);
            place(s, 20);
            const log = play(s, [down | special, ...holdFor(0, 90)]);
            expect(log.hits.filter((h) => h === 'specialD').length).toBeGreaterThanOrEqual(3);
            expect(log.maxCombo).toBeGreaterThanOrEqual(3);
        });

        it('the rising Hydra (↑S) catches a jump', () => {
            const s = fight(foe);
            place(s, 10);
            stepMatch(s, [0, up]);
            let t = 0;
            while (s.fighters[1].y < 24 * PX && t++ < 40) stepMatch(s, [0, 0]);
            expect(s.fighters[1].y).toBeGreaterThan(0);
            const log = play(s, [up | special, ...holdFor(0, 60)]);
            expect(log.hits).toContain('specialU');
        });

        it('the poison dive (air S) lands on a standing foe', () => {
            const s = fight(foe);
            place(s, 30);
            const log = play(s, [up | right, ...holdFor(0, 14), special, ...holdFor(0, 70)]);
            expect(log.hits).toContain('airSpecial');
        });

        it('jumping heavy connects', () => {
            const s = fight(foe);
            place(s, 20);
            const log = play(s, [up | right, ...holdFor(0, 16), heavy, ...holdFor(0, 50)]);
            expect(log.hits).toContain('airHeavy');
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
            const log = play(s, [heavy | BTN.left, ...holdFor(0, 30)]);
            expect(log.hits).toEqual(['heavyBack']);
            expect(s.fighters[1].y).toBeGreaterThan(0);
        });
    });
}
