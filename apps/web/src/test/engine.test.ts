import { describe, expect, it } from 'vitest';
import '../characters';
import { createMatch, stepMatch } from '../engine/match';
import { getChar } from '../engine/registry';
import { BTN, PX, type MatchState } from '../engine/types';

const { right, left, down, light, heavy, special } = BTN;

function fight(p1 = 'luffy', p2 = 'luffy'): MatchState {
    const s = createMatch(p1, p2);
    while (s.phase !== 'fight') stepMatch(s, [0, 0]);
    return s;
}

/** Runs `ticks` ticks holding the given inputs. */
function hold(s: MatchState, a: number, b: number, ticks: number) {
    const events = [];
    for (let i = 0; i < ticks; i++) events.push(...stepMatch(s, [a, b]));
    return events;
}

/** Press (one tick down, one up). */
function tap(s: MatchState, a: number, b = 0, dirA = 0) {
    return [...stepMatch(s, [a | dirA, b]), ...stepMatch(s, [dirA, b])];
}

function closeIn(s: MatchState) {
    s.fighters[0].x = s.fighters[1].x - 34 * PX;
}

describe('engine', () => {
    it('starts with both fighters facing each other', () => {
        const s = fight();
        expect(s.fighters[0].facing).toBe(1);
        expect(s.fighters[1].facing).toBe(-1);
    });

    it('walks forward and back', () => {
        const s = fight();
        const x0 = s.fighters[0].x;
        hold(s, right, 0, 30);
        expect(s.fighters[0].x).toBeGreaterThan(x0);
        const x1 = s.fighters[0].x;
        hold(s, left, 0, 30);
        expect(s.fighters[0].x).toBeLessThan(x1);
    });

    it('a jab hits an idle opponent and a blocked jab does not hurt', () => {
        const s = fight();
        closeIn(s);
        const ev = [...tap(s, light), ...hold(s, 0, 0, 20)];
        expect(ev.some((e) => e.type === 'hit')).toBe(true);
        expect(s.fighters[1].health).toBeLessThan(1000);

        const s2 = fight();
        closeIn(s2);
        const ev2 = [...stepMatch(s2, [light, right]), ...hold(s2, 0, right, 20)];
        expect(ev2.some((e) => e.type === 'block')).toBe(true);
        expect(s2.fighters[1].health).toBe(1000);
    });

    it('a low attack beats a standing guard, a crouching guard stops it', () => {
        const s = fight();
        closeIn(s);
        stepMatch(s, [down, right]);
        stepMatch(s, [down | light, right]);
        hold(s, down, right, 20);
        expect(s.fighters[1].health).toBeLessThan(1000);

        const s2 = fight();
        closeIn(s2);
        stepMatch(s2, [down, right | down]);
        stepMatch(s2, [down | light, right | down]);
        hold(s2, down, right | down, 20);
        expect(s2.fighters[1].health).toBe(1000);
    });

    it('chains light → light → light into a combo', () => {
        const s = fight();
        closeIn(s);
        let events = tap(s, light);
        for (let i = 0; i < 40; i++) {
            events.push(...stepMatch(s, [i % 4 === 0 ? light : 0, 0]));
        }
        const combo = events.filter((e) => e.type === 'combo');
        expect(combo.length).toBeGreaterThan(0);
        expect(Math.max(...combo.map((e) => (e.type === 'combo' ? e.hits : 0)))).toBeGreaterThanOrEqual(3);
    });

    it('throws a close opponent, and the throw can be teched', () => {
        const s = fight();
        closeIn(s);
        hold(s, light | heavy, 0, 1);
        hold(s, 0, 0, 40);
        expect(s.fighters[1].health).toBeLessThan(1000);

        const s2 = fight();
        closeIn(s2);
        stepMatch(s2, [light | heavy, 0]);
        stepMatch(s2, [0, 0]);
        stepMatch(s2, [0, light | heavy]);
        hold(s2, 0, 0, 40);
        expect(s2.fighters[1].health).toBe(1000);
    });

    it('A then B a tick apart still throws, and a far throw whiffs instead of jabbing', () => {
        const s = fight();
        closeIn(s);
        stepMatch(s, [light, 0]);
        expect(s.fighters[0].move).toBe('lightA');
        stepMatch(s, [light | heavy, 0]);
        expect(s.fighters[0].move).toBe('throw');
        hold(s, 0, 0, 40);
        expect(s.fighters[1].health).toBeLessThan(1000);

        const far = fight();
        stepMatch(far, [light | heavy, 0]);
        expect(far.fighters[0].move).toBe('throw');
        hold(far, 0, 0, 40);
        expect(far.fighters[1].health).toBe(1000);
    });

    it('B then C two ticks apart comes out as the ultimate', () => {
        const s = fight();
        closeIn(s);
        s.fighters[0].meter = 200;
        stepMatch(s, [heavy, 0]);
        stepMatch(s, [heavy, 0]);
        stepMatch(s, [heavy | special, 0]);
        expect(s.fighters[0].move).toBe('ultimate');
    });

    it('the ultimate needs a full bar', () => {
        const s = fight();
        closeIn(s);
        tap(s, heavy | special);
        expect(s.fighters[0].move).not.toBe('ultimate');
        const s2 = fight();
        closeIn(s2);
        s2.fighters[0].meter = 100;
        const ev = tap(s2, heavy | special);
        expect(ev.some((e) => e.type === 'superFreeze')).toBe(true);
        hold(s2, 0, 0, 200);
        expect(s2.fighters[1].health).toBeLessThan(700);
        expect(s2.fighters[0].meter).toBeLessThan(100);
    });

    it('a quarter circle + S comes out as the neutral special', () => {
        const s = fight();
        stepMatch(s, [down, 0]);
        stepMatch(s, [down | right, 0]);
        stepMatch(s, [right, 0]);
        stepMatch(s, [right | special, 0]);
        expect(s.fighters[0].move).toBe('specialN');
    });

    it('←S is the back special for a fighter who has one, the neutral special otherwise', () => {
        const s = fight('luffy', 'luffy');
        hold(s, left, 0, 2);
        stepMatch(s, [left | special, 0]);
        expect(getChar('luffy').moves.specialB).toBeUndefined();
        expect(s.fighters[0].move).toBe('specialN');

        const c = fight('crocodile', 'luffy');
        hold(c, left, 0, 2);
        stepMatch(c, [left | special, 0]);
        expect(c.fighters[0].move).toBe('specialB');
    });

    it('a special cancel with ← uses the back special only where it exists', () => {
        for (const [p1, want] of [['luffy', 'specialN'], ['crocodile', 'specialB']] as const) {
            const s = fight(p1);
            closeIn(s);
            stepMatch(s, [heavy, 0]);
            let t = 0;
            while (s.fighters[0].move === 'heavy' && t++ < 60) stepMatch(s, [t > 4 && t % 2 ? left | special : left, 0]);
            expect(s.fighters[0].move).toBe(want);
        }
    });

    it('a guarded ultimate breaks the guard once the gauge runs out', () => {
        // Full guard: the Kamusari breaks it on its last slash, no damage beyond chip.
        const s = fight('shanks', 'luffy');
        s.fighters[0].x = s.fighters[1].x - 60 * PX;
        s.fighters[0].meter = 100;
        let crushed = false;
        let hits = 0;
        for (let i = 0; i < 200; i++) {
            for (const e of stepMatch(s, [i === 0 ? heavy | special : 0, right])) {
                if (e.type === 'guardCrush' && e.side === 1) crushed = true;
                if (e.type === 'hit' && e.attacker === 0) hits++;
            }
        }
        expect(crushed).toBe(true);
        expect(hits).toBe(0);

        // Half-empty guard: the first slash breaks it and the second one lands.
        const s2 = fight('shanks', 'luffy');
        s2.fighters[0].x = s2.fighters[1].x - 60 * PX;
        s2.fighters[0].meter = 100;
        s2.fighters[1].guard = 30;
        const hp = s2.fighters[1].health;
        let crushed2 = false;
        for (let i = 0; i < 200; i++) {
            for (const e of stepMatch(s2, [i === 0 ? heavy | special : 0, right])) {
                if (e.type === 'guardCrush' && e.side === 1) crushed2 = true;
            }
        }
        expect(crushed2).toBe(true);
        // More than the 18 chip of the guarded first slash.
        expect(hp - s2.fighters[1].health).toBeGreaterThan(40);
    });

    it('a projectile cannot interrupt an ultimate: it vanishes against it instead', () => {
        for (const [p1, slot, input] of [['crocodile', 'specialB', left | special], ['magellan', 'specialF', right | special]] as const) {
            // Sanji's ultimate has no invincibility to hide behind.
            const s = fight(p1, 'sanji');
            s.fighters[0].x = s.fighters[1].x - 120 * PX;
            s.fighters[1].meter = 100;
            stepMatch(s, [input, 0]);
            stepMatch(s, [0, 0]);
            expect(s.fighters[0].move).toBe(slot);
            let t = 0;
            while (!s.projectiles.length && t++ < 60) stepMatch(s, [0, 0]);
            // Sanji answers with his ultimate as the projectile closes in.
            while (s.projectiles.length && Math.abs(s.projectiles[0].x - s.fighters[1].x) > 75 * PX && t++ < 200) stepMatch(s, [0, 0]);
            stepMatch(s, [0, heavy | special]);
            expect(s.fighters[1].move).toBe('ultimate');
            expect(s.projectiles.length).toBe(1);
            let interrupted = false;
            for (let i = 0; i < 120; i++) {
                for (const e of stepMatch(s, [0, 0])) if (e.type === 'hit' && e.attacker === 0 && e.damage > 0) interrupted = true;
                if (s.fighters[1].move !== 'ultimate') break;
            }
            expect(interrupted).toBe(false);
        }
    });

    it('a one-tick tap made entirely during hitstop still chains', () => {
        const s = fight();
        closeIn(s);
        stepMatch(s, [light, 0]);
        let guard = 0;
        while (s.fighters[0].hitstop === 0 && guard++ < 30) stepMatch(s, [0, 0]);
        expect(s.fighters[0].hitstop).toBeGreaterThan(2);
        // Down one tick, up the next: both inside the freeze.
        stepMatch(s, [light, 0]);
        stepMatch(s, [0, 0]);
        expect(s.fighters[0].hitstop).toBeGreaterThan(0);
        hold(s, 0, 0, 12);
        expect(s.fighters[0].move).toBe('lightB');
        expect(s.fighters[1].combo).toBeGreaterThanOrEqual(2);
    });

    it('a button pressed 4 ticks before blockstun ends comes out on the first free tick', () => {
        const s = fight();
        closeIn(s);
        // P2 attacks, P1 blocks.
        stepMatch(s, [left, light]);
        let guard = 0;
        while (s.fighters[0].mode !== 'blockstun' && guard++ < 30) stepMatch(s, [left, 0]);
        expect(s.fighters[0].mode).toBe('blockstun');
        while ((s.fighters[0].hitstop > 0 || s.fighters[0].timer > 4) && guard++ < 60) stepMatch(s, [left, 0]);
        stepMatch(s, [light, 0]);
        stepMatch(s, [0, 0]);
        let started = -1;
        for (let i = 0; i < 6 && started < 0; i++) {
            stepMatch(s, [0, 0]);
            if (s.fighters[0].move === 'lightA') started = i;
        }
        expect(started).toBeGreaterThanOrEqual(0);
        expect(s.fighters[0].t).toBeLessThanOrEqual(1);
    });

    it('a press during the recovery of a whiffed move comes out when it ends', () => {
        const s = fight();
        stepMatch(s, [heavy, 0]);
        expect(s.fighters[0].move).toBe('heavy');
        let guard = 0;
        // Press while the move still has a few ticks to go.
        const remaining = () => {
            const f = s.fighters[0];
            const d = getChar(f.char).moves.heavy.durations;
            return d.slice(f.frame).reduce((a, b) => a + b, 0) - f.frameT;
        };
        while (remaining() > 5 && guard++ < 80) stepMatch(s, [0, 0]);
        stepMatch(s, [light, 0]);
        stepMatch(s, [0, 0]);
        guard = 0;
        while (s.fighters[0].move === 'heavy' && guard++ < 20) stepMatch(s, [0, 0]);
        expect(s.fighters[0].move).toBe('lightA');
    });

    it('a sloppy quarter circle, with a neutral gap and no diagonal, is still the special', () => {
        const s = fight();
        hold(s, down, 0, 4);
        hold(s, 0, 0, 2);
        hold(s, right, 0, 5);
        stepMatch(s, [right | special, 0]);
        expect(s.fighters[0].move).toBe('specialN');
    });

    it('walking forward into a quarter circle is not read as the uppercut', () => {
        const s = fight();
        hold(s, right, 0, 20);
        hold(s, down, 0, 3);
        hold(s, down | right, 0, 2);
        hold(s, right, 0, 2);
        stepMatch(s, [right | special, 0]);
        expect(s.fighters[0].move).toBe('specialN');

        const dp = fight();
        hold(dp, right, 0, 3);
        hold(dp, down, 0, 3);
        hold(dp, down | right, 0, 2);
        stepMatch(dp, [down | right | special, 0]);
        expect(dp.fighters[0].move).toBe('specialU');
    });

    it('a jump-in button pressed during the jump startup comes out as soon as the fighter leaves the ground', () => {
        const s = fight();
        stepMatch(s, [BTN.up, 0]);
        expect(s.fighters[0].mode).toBe('prejump');
        stepMatch(s, [BTN.up | heavy, 0]);
        hold(s, BTN.up, 0, 6);
        expect(s.fighters[0].move).toBe('airHeavy');
    });

    it('replays identically from the same inputs', () => {
        const run = () => {
            const s = fight();
            let seed = 7;
            for (let i = 0; i < 1500; i++) {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                const a = (seed >> 8) & 0x7f;
                const b = (seed >> 16) & 0x7f;
                stepMatch(s, [a, b]);
            }
            return JSON.stringify(s);
        };
        expect(run()).toBe(run());
    });

    it('a KO ends the round and the match ends after two', () => {
        const s = fight();
        for (let round = 0; round < 2; round++) {
            while (s.phase !== 'fight') stepMatch(s, [0, 0]);
            s.fighters[1].health = 1;
            closeIn(s);
            tap(s, light);
            let guard = 0;
            while (!['intro', 'matchEnd'].includes(s.phase as string) && guard++ < 2000) stepMatch(s, [0, 0]);
        }
        expect(s.phase).toBe('matchEnd');
        expect(s.winner).toBe(0);
    });

    it('reports an effect with the sound it carries, on the frame it plays', () => {
        const s = fight();
        closeIn(s);
        const def = getChar('luffy');
        const move = def.moves.heavy;
        const saved = move.fx;
        move.fx = [[1, 'idle', 10, 20, 'slashHeavy']];
        try {
            const events = [...tap(s, heavy), ...hold(s, 0, 0, 30)];
            const fx = events.find((e) => e.type === 'fx');
            expect(fx).toMatchObject({ type: 'fx', anim: 'idle', sfx: 'slashHeavy' });
        } finally {
            move.fx = saved;
        }
    });
});
