import { describe, expect, it } from 'vitest';
import '../characters';
import { createMatch, stepMatch } from '../engine/match';
import { checksum } from '../net/checksum';
import { packPair, unpackPair, type NetMsg, type WatchMsg } from '../net/protocol';
import { SPECTATOR_BUFFER, SPECTATOR_CATCH_UP, SpectatorFeed, SpectatorRelay } from '../net/spectator';

const watch = (m: number, start: number, n: number, v = (f: number) => f % 512): WatchMsg =>
    ({ type: 'watch', m, start, bits: Array.from({ length: n }, (_, i) => v(start + i)) });

describe('spectator relay (host side)', () => {
    /** A fake rollback session: `confirmed` frames known, input of frame f = f. */
    const inputs = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

    it('tells a new spectator where the players are, then the match from frame 0', () => {
        const sent: NetMsg[] = [];
        const relay = new SpectatorRelay();
        relay.lobby('stage');
        relay.attach((m) => sent.push(m));
        expect(sent).toEqual([{ type: 'lobby', what: 'stage' }]);
        relay.start({ p1: 'luffy', p2: 'zoro', stage: 'marineford', seed: 7 });
        expect(sent[1]).toEqual({ type: 'start', p1: 'luffy', p2: 'zoro', stage: 'marineford', seed: 7 });
        relay.frames(7, 10, inputs);
        expect(sent[2]).toEqual({ type: 'watch', m: 7, start: 0, bits: inputs(0, 10) });
        relay.frames(7, 10, inputs);
        expect(sent).toHaveLength(3);
        relay.frames(7, 15, inputs);
        expect(sent[3]).toEqual({ type: 'watch', m: 7, start: 10, bits: inputs(10, 15) });
    });

    it('a spectator arriving mid-match gets start then every frame so far, in packets of at most 128', () => {
        const relay = new SpectatorRelay();
        relay.start({ p1: 'ace', p2: 'law', stage: 'alabasta', seed: 3 });
        relay.frames(3, 300, inputs); // nobody watching: nothing sent, nothing counted
        const sent: NetMsg[] = [];
        relay.attach((m) => sent.push(m));
        expect(sent[0]).toMatchObject({ type: 'start', seed: 3 });
        relay.frames(3, 300, inputs);
        const packets = sent.slice(1) as WatchMsg[];
        expect(packets.map((p) => [p.start, p.bits.length])).toEqual([[0, 128], [128, 128], [256, 44]]);
        expect(packets.flatMap((p) => p.bits)).toEqual(inputs(0, 300));
    });

    it('ignores frames of another match and stops between matches', () => {
        const sent: NetMsg[] = [];
        const relay = new SpectatorRelay();
        relay.attach((m) => sent.push(m));
        relay.start({ p1: 'ace', p2: 'law', stage: 'alabasta', seed: 3 });
        relay.frames(4, 50, inputs);
        expect(sent.filter((m) => m.type === 'watch')).toHaveLength(0);
        relay.lobby('results');
        relay.frames(3, 50, inputs);
        expect(sent.filter((m) => m.type === 'watch')).toHaveLength(0);
        expect(sent.at(-1)).toEqual({ type: 'lobby', what: 'results' });
    });

    it('sends nothing once detached, and starts over for the next spectator', () => {
        const first: NetMsg[] = [];
        const relay = new SpectatorRelay();
        relay.start({ p1: 'ace', p2: 'law', stage: 'alabasta', seed: 3 });
        relay.attach((m) => first.push(m));
        relay.frames(3, 20, inputs);
        relay.detach();
        relay.frames(3, 40, inputs);
        expect(first.filter((m) => m.type === 'watch')).toHaveLength(1);
        const second: NetMsg[] = [];
        relay.attach((m) => second.push(m));
        relay.frames(3, 40, inputs);
        expect((second[1] as WatchMsg).start).toBe(0);
        expect((second[1] as WatchMsg).bits).toEqual(inputs(0, 40));
    });
});

describe('spectator feed (spectator side)', () => {
    it('appends packets in order, drops overlaps and refuses gaps or other matches', () => {
        const feed = new SpectatorFeed(5);
        expect(feed.push(watch(5, 0, 10))).toBe(true);
        expect(feed.push(watch(5, 5, 10))).toBe(true); // 5..9 again, 10..14 new
        expect(feed.received).toBe(15);
        expect(feed.push(watch(5, 20, 3))).toBe(false); // gap
        expect(feed.push(watch(6, 15, 3))).toBe(false); // another match
        expect(feed.received).toBe(15);
        expect(feed.next()).toEqual([0, 0]);
    });

    it('waits for a small buffer before playing, then plays one frame a tick', () => {
        const feed = new SpectatorFeed(1);
        feed.push(watch(1, 0, SPECTATOR_BUFFER - 1));
        expect(feed.plan(false)).toEqual({ skip: 0, play: 0 });
        feed.push(watch(1, SPECTATOR_BUFFER - 1, 1));
        expect(feed.plan(false)).toEqual({ skip: 0, play: 1 });
        feed.next();
        expect(feed.plan(false)).toEqual({ skip: 0, play: 1 });
    });

    it('rebuffers when it runs dry, except once the match is over', () => {
        const feed = new SpectatorFeed(1);
        feed.push(watch(1, 0, SPECTATOR_BUFFER));
        for (let i = 0; i < SPECTATOR_BUFFER; i++) { expect(feed.plan(false).play).toBe(1); feed.next(); }
        expect(feed.plan(false)).toEqual({ skip: 0, play: 0 });
        expect(feed.starved).toBe(true);
        feed.push(watch(1, SPECTATOR_BUFFER, 2));
        expect(feed.plan(false).play).toBe(0); // 2 frames: not enough to start again
        expect(feed.plan(true).play).toBe(1); // KO already shown: play what there is
        expect(feed.starved).toBe(false);
    });

    it('plays two frames a tick when it falls behind, and jumps when far behind', () => {
        const feed = new SpectatorFeed(1);
        feed.push(watch(1, 0, SPECTATOR_BUFFER * 3 + 1));
        expect(feed.plan(false)).toEqual({ skip: 0, play: 2 });
        const late = new SpectatorFeed(2);
        late.push(watch(2, 0, 128));
        late.push(watch(2, 128, 128));
        expect(late.backlog).toBeGreaterThan(SPECTATOR_CATCH_UP);
        const p = late.plan(false);
        expect(p.skip).toBe(256 - SPECTATOR_BUFFER);
        expect(p.play).toBe(1);
    });

    it('replaying the feed gives the players\' exact state', () => {
        // Two scripted players; the host packs their inputs as the relay does.
        const st = createMatch('luffy', 'zoro');
        const bits: number[] = [];
        let seed = 99;
        for (let f = 0; f < 1500; f++) {
            seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
            const pair: [number, number] = [(seed >>> 8) & 0x7f, (seed >>> 16) & 0x7f];
            bits.push(packPair(...pair));
            stepMatch(st, pair);
        }
        const feed = new SpectatorFeed(9);
        for (let s = 0; s < bits.length; s += 128) feed.push({ type: 'watch', m: 9, start: s, bits: bits.slice(s, s + 128) });
        const mine = createMatch('luffy', 'zoro');
        while (feed.backlog) stepMatch(mine, feed.next());
        expect(checksum(mine)).toBe(checksum(st));
        expect(unpackPair(bits[0])).toEqual(feed.inputAt(0));
    });
});
