import { describe, expect, it } from 'vitest';
import '../characters';
import { createMatch, stepMatch } from '../engine/match';
import { BTN, type MatchState } from '../engine/types';
import { checksum, cloneState } from '../net/checksum';
import { decode, encode, packPair, PROTOCOL_VERSION, unpackPair, type NetMsg } from '../net/protocol';
import { RollbackSession, type RollbackOptions } from '../net/rollback';

const { up, down, left, right, light, heavy, special } = BTN;

function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * A scripted player: a long, seeded sequence of real inputs — walking in,
 * light chains, crouching heavies, motion specials, jump-ins, blocking,
 * throws and ultimates — indexed by tick.
 */
function script(side: 0 | 1, seed: number, length: number): number[] {
    const r = rng(seed);
    const fwd = side === 0 ? right : left;
    const back = side === 0 ? left : right;
    const out: number[] = [];
    const push = (bits: number, n: number) => { for (let i = 0; i < n; i++) out.push(bits); };
    while (out.length < length) {
        switch (Math.floor(r() * 10)) {
            case 0: case 1: push(fwd, 10 + Math.floor(r() * 30)); break;
            case 2: for (let i = 0; i < 3; i++) { push(light, 2); push(0, 5 + Math.floor(r() * 4)); } push(heavy | fwd, 2); push(0, 20); break;
            case 3: push(down, 4); push(down | heavy, 2); push(down, 20); break;
            case 4: push(down, 2); push(down | fwd, 2); push(fwd, 2); push(fwd | special, 2); push(0, 30); break;
            case 5: push(up | fwd, 3); push(fwd, 12); push(heavy, 2); push(0, 25); break;
            case 6: push(back, 15 + Math.floor(r() * 25)); break;
            case 7: push(light | heavy, 2); push(0, 30); break;
            case 8: push(heavy | special, 2); push(0, 40); break;
            default: push(special | (r() < 0.5 ? up : down), 2); push(0, 30);
        }
    }
    return out.slice(0, length);
}

interface LinkOpts {
    latency: number;
    jitter?: number;
    loss?: number;
    seed?: number;
}

/** One direction of a fake network: delay in ticks, jitter (reorders), loss. */
class Link {
    private q: { at: number; seq: number; data: string }[] = [];
    private r: () => number;
    private seq = 0;
    down = false;
    sent = 0;
    bytes = 0;
    constructor(private o: LinkOpts) {
        this.r = rng(o.seed ?? 1);
    }
    send(now: number, msg: NetMsg) {
        const data = encode(msg);
        this.sent++;
        this.bytes += data.length;
        if (this.down || this.r() < (this.o.loss ?? 0)) return;
        const at = now + this.o.latency + Math.floor(this.r() * ((this.o.jitter ?? 0) + 1));
        this.q.push({ at, seq: this.seq++, data });
    }
    deliver(now: number, to: RollbackSession) {
        const ready = this.q.filter((m) => m.at <= now).sort((a, b) => a.at - b.at || a.seq - b.seq);
        this.q = this.q.filter((m) => m.at > now);
        for (const m of ready) {
            const msg = decode(m.data);
            expect(msg).not.toBeNull();
            to.receive(msg!);
        }
    }
}

function startState(p1 = 'luffy', p2 = 'zoro'): MatchState {
    return createMatch(p1, p2);
}

interface RunOpts extends LinkOpts {
    ticks: number;
    session?: RollbackOptions;
    /** B's clock is slower: it skips one tick every N (0: never). */
    bSkipEvery?: number;
    /** B starts this many ticks late. */
    bLate?: number;
    /** Both links drop everything between these ticks. */
    outage?: [number, number];
    p1?: string;
    p2?: string;
    seedA?: number;
    seedB?: number;
}

function run(o: RunOpts) {
    const init = startState(o.p1, o.p2);
    const a = new RollbackSession(init, 0, o.session);
    const b = new RollbackSession(init, 1, o.session);
    const ab = new Link({ ...o, seed: (o.seed ?? 1) * 7 + 1 });
    const ba = new Link({ ...o, seed: (o.seed ?? 1) * 13 + 5 });
    const sa = script(0, o.seedA ?? 11, o.ticks);
    const sb = script(1, o.seedB ?? 29, o.ticks);
    const sumsA = new Map<number, number>();
    const sumsB = new Map<number, number>();
    const stalled = [0, 0];
    let maxTick = 0;
    const confirmedEventsA: unknown[] = [];
    let tickB = 0;
    for (let t = 0; t < o.ticks; t++) {
        const out = !!o.outage && t >= o.outage[0] && t < o.outage[1];
        ab.down = ba.down = out;
        ab.deliver(t, b);
        ba.deliver(t, a);
        const t0 = performance.now();
        const ra = a.tick(sa[t]);
        maxTick = Math.max(maxTick, performance.now() - t0);
        for (const m of ra.outgoing) ab.send(t, m);
        confirmedEventsA.push(...ra.confirmedEvents);
        if (ra.stalled) stalled[0]++;
        sumsA.set(a.confirmedFrame, checksum(a.confirmedState));
        const bRuns = t >= (o.bLate ?? 0) && !(o.bSkipEvery && t % o.bSkipEvery === 0);
        if (bRuns) {
            const rb = b.tick(sb[tickB++]);
            for (const m of rb.outgoing) ba.send(t, m);
            if (rb.stalled) stalled[1]++;
            sumsB.set(b.confirmedFrame, checksum(b.confirmedState));
        }
    }
    // Reference: one machine replaying the full input log.
    const log = a.inputLog();
    const logB = b.inputLog();
    const common = Math.min(log.length, logB.length);
    expect(logB.slice(0, common)).toEqual(log.slice(0, common));
    const ref = cloneState(init);
    const refSums = [checksum(ref)];
    const refEvents: unknown[] = [];
    for (const inp of log) {
        refEvents.push(...stepMatch(ref, inp));
        refSums.push(checksum(ref));
    }
    // Events of confirmed frames are exactly those of the reference run.
    expect(confirmedEventsA).toEqual(refEvents);
    let compared = 0;
    for (const [f, s] of sumsA) { expect(s, `A frame ${f}`).toBe(refSums[f]); compared++; }
    for (const [f, s] of sumsB) if (f < refSums.length) { expect(s, `B frame ${f}`).toBe(refSums[f]); compared++; }
    return { a, b, ref, stalled, maxTick, compared, ab, ba, log };
}

describe('protocol', () => {
    it('round-trips messages and rejects garbage', () => {
        const msgs: NetMsg[] = [
            { type: 'hello', v: PROTOCOL_VERSION, name: 'Luffy' },
            { type: 'helloAck', v: PROTOCOL_VERSION, ok: false, reason: 'full' },
            { type: 'input', start: 12, bits: [0, 16, 48], ack: 9, f: 10, adv: 1 },
            { type: 'checksum', frame: 60, sum: 0xdeadbeef },
            { type: 'ping', t: 1234.5 },
            { type: 'reselect', m: 123456 },
            { type: 'leave' },
            { type: 'hello', v: PROTOCOL_VERSION, name: 'SPECTATEUR', b: 7, spec: true },
            { type: 'helloAck', v: PROTOCOL_VERSION, ok: false, reason: 'specFull' },
            { type: 'watch', m: 42, start: 128, bits: [0, packPair(0x1ff, 0x1ff), packPair(16, 3)] },
            { type: 'lobby', what: 'results' }
        ];
        for (const m of msgs) expect(decode(encode(m))).toEqual(m);
        expect(decode('not json')).toBeNull();
        expect(decode('{"type":"nope"}')).toBeNull();
        expect(decode('{"type":"input","start":1,"bits":["x"],"ack":0}')).toBeNull();
        expect(decode(42)).toBeNull();
        // Everything is validated field by field; extra fields are dropped.
        expect(decode('{"type":"input","start":-5,"bits":[1],"ack":0}')).toBeNull();
        expect(decode(JSON.stringify({ type: 'input', start: 0, bits: new Array(500).fill(1), ack: 0 }))).toBeNull();
        expect(decode('{"type":"input","start":0,"bits":[1.5],"ack":0}')).toBeNull();
        expect(decode('{"type":"ping","t":"x"}')).toBeNull();
        expect(decode('{"type":"start","p1":{"x":1},"p2":"zoro","stage":"marineford"}')).toBeNull();
        expect(decode('{"type":"select","char":"<img>","ready":true}')).toBeNull();
        expect(decode('{"type":"rematch","want":1}')).toBeNull();
        expect(decode('{"type":"reselect"}')).toBeNull();
        expect(decode('{"type":"reselect","m":-1}')).toBeNull();
        expect(decode('{"type":"leave","extra":"x"}')).toEqual({ type: 'leave' });
        expect(decode('{"type":"hello","v":4,"name":"x","spec":"yes"}')).toBeNull();
        expect(decode('{"type":"watch","m":1,"start":0,"bits":[262144]}')).toBeNull();
        expect(decode(JSON.stringify({ type: 'watch', m: 1, start: 0, bits: new Array(129).fill(1) }))).toBeNull();
        expect(decode('{"type":"lobby","what":"fight"}')).toBeNull();
        // A full watch packet stays well under the message limit.
        expect(encode({ type: 'watch', m: 0x7fffffff, start: 1 << 20, bits: new Array(128).fill(packPair(0x1ff, 0x1ff)) }).length).toBeLessThan(1200);
        for (const [x, y] of [[0, 0], [0x1ff, 0], [0, 0x1ff], [123, 456]]) expect(unpackPair(packPair(x, y))).toEqual([x, y]);
        expect(decode('{"type":"hello","v":1,"name":"' + 'x'.repeat(5000) + '"}')).toBeNull();
        expect(decode('[1,2]')).toBeNull();
    });
});

describe('state snapshots', () => {
    it('the match state is plain data that clones and hashes deterministically', () => {
        const s = startState();
        const sa = script(0, 3, 900);
        const sb = script(1, 4, 900);
        for (let i = 0; i < 900; i++) stepMatch(s, [sa[i], sb[i]]);
        expect(JSON.parse(JSON.stringify(s))).toEqual(s);
        expect(structuredClone(s)).toEqual(s);
        const c = cloneState(s);
        expect(c).toEqual(s);
        expect(checksum(c)).toBe(checksum(s));
        // Independent copy: stepping one leaves the other alone.
        stepMatch(c, [light, 0]);
        expect(checksum(c)).not.toBe(checksum(s));
        const d = cloneState(s);
        d.fighters[1].health--;
        expect(checksum(d)).not.toBe(checksum(s));
    });
});

describe('rollback session', () => {
    const cases: [string, RunOpts][] = [
        ['0 frames, no loss', { latency: 0, ticks: 4000 }],
        ['3 frames, 10% loss, jitter 2', { latency: 3, jitter: 2, loss: 0.1, ticks: 4000, seed: 2 }],
        ['8 frames, 30% loss, jitter 4', { latency: 8, jitter: 4, loss: 0.3, ticks: 4000, seed: 3 }],
        ['5 frames, 20% loss, B late and with a slower clock', { latency: 5, jitter: 3, loss: 0.2, ticks: 4000, seed: 4, bLate: 20, bSkipEvery: 97, p1: 'ace', p2: 'law' }]
    ];
    for (const [name, o] of cases) {
        it(`both peers match a single-machine replay: ${name}`, () => {
            const { a, b, stalled, compared, log } = run(o);
            expect(a.desync).toBeNull();
            expect(b.desync).toBeNull();
            // The scripts really fought: damage was dealt on both sides.
            const s = a.confirmedState;
            expect(s.fighters[0].health < 1000 || s.fighters[0].wins + s.fighters[1].wins > 0).toBe(true);
            expect(log.length).toBeGreaterThan(o.ticks * 0.8);
            expect(compared).toBeGreaterThan(log.length / 2);
            console.log(`${name}: frames A ${a.frame} B ${b.frame}, confirmed ${a.confirmedFrame}, rollbacks ${a.stats.rollbacks} (${a.stats.framesResimulated} frames, max ${a.stats.maxRollbackSeen}), stalls ${stalled}, sync pauses ${a.stats.syncPauses}/${b.stats.syncPauses}`);
        });
    }

    it('a spectator replaying the confirmed inputs sees the very same match', () => {
        const { a, b } = run({ latency: 4, jitter: 2, loss: 0.2, ticks: 3000, seed: 11, p1: 'ace', p2: 'law' });
        const fromA = a.confirmedInputs(0);
        expect(fromA.length).toBe(a.confirmedFrame);
        // Both players agree on every frame they both confirmed, and on chunks.
        const fromB = b.confirmedInputs(0);
        const n = Math.min(fromA.length, fromB.length);
        expect(fromA.slice(0, n)).toEqual(fromB.slice(0, n));
        expect([...a.confirmedInputs(0, 100), ...a.confirmedInputs(100, 228), ...a.confirmedInputs(228)]).toEqual(fromA);
        expect(a.confirmedInputs(a.confirmedFrame + 5)).toEqual([]);
        const st = createMatch('ace', 'law');
        for (const v of fromA) stepMatch(st, unpackPair(v));
        expect(checksum(st)).toBe(checksum(a.confirmedState));
    });

    it('plays a whole match to the end in sync with 4 frames and 20% loss', () => {
        const { a, b, ref } = run({ latency: 4, jitter: 2, loss: 0.2, ticks: 20000, seed: 9, seedA: 5, seedB: 6 });
        expect(ref.phase).toBe('matchEnd');
        expect(a.desync).toBeNull();
        expect(b.desync).toBeNull();
    });

    it('never predicts more than maxRollback frames: stalls when the remote lags, then recovers', () => {
        // 12 frames one way is more than delay 2 + 8 frames of prediction.
        const { a, b, stalled } = run({ latency: 12, ticks: 1500, session: { maxRollback: 8 } });
        expect(stalled[0]).toBeGreaterThan(0);
        expect(a.stats.maxRollbackSeen).toBeLessThanOrEqual(8);
        expect(b.stats.maxRollbackSeen).toBeLessThanOrEqual(8);
        expect(a.frame).toBeGreaterThan(1000);

        // Total outage for half a second: both freeze, then resume in sync.
        const r = run({ latency: 2, ticks: 1500, outage: [400, 430] });
        expect(r.stalled[0]).toBeGreaterThanOrEqual(15);
        expect(r.stalled[1]).toBeGreaterThanOrEqual(15);
        expect(r.a.frame).toBeGreaterThan(1300);
        expect(r.a.confirmedFrame).toBeGreaterThan(1300);
        expect(r.a.desync).toBeNull();
    });

    it('time sync slows down the peer that runs ahead', () => {
        const { a, b } = run({ latency: 3, ticks: 3000, bLate: 30 });
        expect(a.stats.syncPauses).toBeGreaterThan(0);
        // After catching up, the frame gap is small.
        expect(Math.abs(a.frame - b.frame)).toBeLessThanOrEqual(3);
    });

    it('detects a desync when one state is corrupted', () => {
        const init = startState();
        const a = new RollbackSession(init, 0, { checksumInterval: 60 });
        const b = new RollbackSession(init, 1, { checksumInterval: 60 });
        const sa = script(0, 1, 600);
        const sb = script(1, 2, 600);
        const toB: NetMsg[] = [];
        const toA: NetMsg[] = [];
        for (let t = 0; t < 600; t++) {
            toA.splice(0).forEach((m) => a.receive(m));
            toB.splice(0).forEach((m) => b.receive(m));
            toB.push(...a.tick(sa[t]).outgoing);
            toA.push(...b.tick(sb[t]).outgoing);
            if (t === 200) {
                expect(a.desync).toBeNull();
                a.state.fighters[1].meter += 7;
            }
        }
        expect(a.desync).not.toBeNull();
        expect(b.desync).not.toBeNull();
        expect(a.desync!.frame).toBeGreaterThan(200);
        expect(a.desync!.frame).toBeLessThanOrEqual(300);
        expect(a.desync!.local).toBe(b.desync!.remote);
    });

    it('an 8-frame rollback costs well under 4 ms', () => {
        const init = startState('akainu', 'doflamingo');
        const a = new RollbackSession(init, 0, { delay: 0, maxRollback: 8 });
        const sa = script(0, 8, 5000);
        const sb = script(1, 9, 5000);
        let remote = 0;
        let last = 0;
        const times: number[] = [];
        let t = 0;
        for (let round = 0; round < 300; round++) {
            // 8 predicted frames, then the remote's real (different) inputs arrive.
            for (let i = 0; i < 8; i++) a.tick(sa[t++]);
            // The first real input always differs from the prediction (the last one).
            const bits = Array.from({ length: 8 }, (_, i) => (i === 0 ? last ^ heavy : sb[remote + i]));
            last = bits[7];
            a.receive({ type: 'input', start: remote, bits, ack: -1 });
            remote += 8;
            const t0 = performance.now();
            const r = a.tick(sa[t++]);
            times.push(performance.now() - t0);
            expect(r.stalled || r.rolledBack > 0).toBe(true);
        }
        times.sort((x, y) => x - y);
        const median = times[times.length >> 1];
        const p95 = times[Math.floor(times.length * 0.95)];
        console.log(`8-frame rollback: median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, max ${times[times.length - 1].toFixed(3)} ms`);
        expect(a.stats.maxRollbackSeen).toBe(8);
        expect(median).toBeLessThan(4);
    });
});

describe('rollback input hygiene', () => {
    it('masks the start bit and ignores frames absurdly far ahead', () => {
        const a = new RollbackSession(createMatch('luffy', 'zoro'), 0);
        a.receive({ type: 'input', start: 0, bits: [0xff, 0x80 | right, right], ack: -1 });
        a.receive({ type: 'input', start: 1_000_000, bits: [1], ack: -1 });
        for (let i = 0; i < 6; i++) a.tick(0x80 | left);
        const log = a.inputLog(3);
        expect(log.length).toBe(3);
        for (const [l, r] of log) { expect(l & 0x80).toBe(0); expect(r & 0x80).toBe(0); }
        expect(log[1][1]).toBe(right);
        expect(log[2][0]).toBe(left);
    });
});
