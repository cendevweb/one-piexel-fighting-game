/**
 * The host's room over a fake PeerJS: who gets in, who is turned away, and
 * that the room outlives its guests (ticket #37) and its spectator.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type Handler = (...a: unknown[]) => void;

class Emitter {
    private h = new Map<string, Handler[]>();
    on(e: string, f: Handler) { this.h.set(e, [...(this.h.get(e) ?? []), f]); return this; }
    once(e: string, f: Handler) { const g: Handler = (...a) => { this.off(e, g); f(...a); }; return this.on(e, g); }
    off(e: string, f: Handler) { this.h.set(e, (this.h.get(e) ?? []).filter((x) => x !== f)); return this; }
    emit(e: string, ...a: unknown[]) { for (const f of [...(this.h.get(e) ?? [])]) f(...a); }
}

/** A visitor's connection as the host sees it: `sent` is what the host wrote to it. */
class FakeConn extends Emitter {
    open = true;
    sent: unknown[] = [];
    peerConnection = {
        connectionState: 'connected',
        addEventListener: () => {},
        createDataChannel: () => ({ readyState: 'connecting', bufferedAmount: 0, send: () => {}, onmessage: null })
    };
    send(d: unknown) { this.sent.push(typeof d === 'string' ? JSON.parse(d) : d); }
    close() { if (!this.open) return; this.open = false; this.emit('close'); }
    /** The visitor says something. */
    say(msg: object) { this.emit('data', JSON.stringify(msg)); }
}

let lastPeer: FakePeer | null = null;
class FakePeer extends Emitter {
    destroyed = false;
    disconnected = false;
    constructor(readonly id: string) {
        super();
        lastPeer = this;
        setTimeout(() => this.emit('open', id), 0);
    }
    destroy() { this.destroyed = true; }
    reconnect() {}
    disconnect() { this.disconnected = true; }
}

vi.mock('peerjs', () => ({ Peer: FakePeer }));

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    const g = globalThis as Record<string, unknown>;
    g.RTCPeerConnection = class {};
    g.window = { addEventListener: () => {}, removeEventListener: () => {} };
    g.location = { search: '', hostname: 'localhost', origin: 'http://localhost', pathname: '/' };
    g.fetch = async () => ({ ok: false });
});
afterAll(() => { vi.useRealTimers(); });

const { hostRoom } = await import('../net/transport');
const { PROTOCOL_VERSION } = await import('../net/protocol');
const { buildFingerprint } = await import('../net/fingerprint');
const { ROSTER } = await import('../characters');
void ROSTER;

async function openRoom() {
    const p = hostRoom();
    await vi.advanceTimersByTimeAsync(10);
    const room = await p;
    return { room, peer: lastPeer! };
}

const hello = (spec = false) => ({ type: 'hello', v: PROTOCOL_VERSION, name: 'x', b: buildFingerprint(), ...(spec ? { spec: true } : {}) });

function visit(peer: FakePeer, spec = false) {
    const c = new FakeConn();
    peer.emit('connection', c);
    c.say(hello(spec));
    return c;
}

describe('host room', () => {
    it('takes a guest, then another one after the first left: same room, same peer', async () => {
        const { room, peer } = await openRoom();
        const guests: { side: number; open: boolean }[] = [];
        room.onGuest((l) => guests.push(l));
        const a = visit(peer);
        expect(a.sent[0]).toMatchObject({ type: 'helloAck', ok: true });
        expect(guests).toHaveLength(1);
        a.say({ type: 'leave' });
        expect(guests[0].open).toBe(false);
        expect(peer.destroyed).toBe(false);
        expect(room.open).toBe(true);
        const b = visit(peer);
        expect(b.sent[0]).toMatchObject({ type: 'helloAck', ok: true });
        expect(guests).toHaveLength(2);
        room.close();
    });

    it('turns away a second guest while one plays, and other versions', async () => {
        const { room, peer } = await openRoom();
        const refused: string[] = [];
        room.onRefused((k) => refused.push(k));
        room.onGuest(() => {});
        visit(peer);
        const second = visit(peer);
        expect(second.sent[0]).toMatchObject({ type: 'helloAck', ok: false, reason: 'full' });
        const old = new FakeConn();
        peer.emit('connection', old);
        old.say({ ...hello(true), b: 1 });
        expect(old.sent[0]).toMatchObject({ ok: false, reason: 'version' });
        expect(refused).toEqual(['full', 'version']);
        room.close();
    });

    it('keeps a guest that came while nobody listened for the next listener', async () => {
        const { room, peer } = await openRoom();
        const off = room.onGuest(() => { throw new Error('unsubscribed'); });
        off();
        visit(peer);
        const got: unknown[] = [];
        room.onGuest((l) => got.push(l));
        expect(got).toHaveLength(1);
        room.close();
    });

    it('one spectator besides the guest; either may leave without closing the room', async () => {
        const { room, peer } = await openRoom();
        const specs: { open: boolean; close(): void }[] = [];
        const guests: { open: boolean }[] = [];
        room.onSpectator((l) => specs.push(l));
        room.onGuest((l) => guests.push(l));
        const s = visit(peer, true);
        expect(s.sent[0]).toMatchObject({ type: 'helloAck', ok: true });
        expect(specs).toHaveLength(1);
        expect(guests).toHaveLength(0);
        const s2 = visit(peer, true);
        expect(s2.sent[0]).toMatchObject({ ok: false, reason: 'specFull' });
        visit(peer);
        expect(guests).toHaveLength(1);
        // The spectator leaves: the guest stays.
        specs[0].close();
        await vi.advanceTimersByTimeAsync(400);
        expect(s.open).toBe(false);
        expect(guests[0].open).toBe(true);
        expect(peer.destroyed).toBe(false);
        // A late listener still hears about a spectator already there.
        visit(peer, true);
        const late: unknown[] = [];
        room.onSpectator((l) => late.push(l));
        expect(late).toHaveLength(1);
        room.close();
    });

    it('closing the room says goodbye to everyone, then leaves the broker', async () => {
        const { room, peer } = await openRoom();
        room.onGuest(() => {});
        const g = visit(peer);
        const s = visit(peer, true);
        room.close();
        expect(room.open).toBe(false);
        expect(g.sent.at(-1)).toEqual({ type: 'leave' });
        expect(s.sent.at(-1)).toEqual({ type: 'leave' });
        await vi.advanceTimersByTimeAsync(500);
        expect(peer.destroyed).toBe(true);
        const late = new FakeConn();
        peer.emit('connection', late);
        expect(late.open).toBe(false);
    });

    it('a broker failure with nobody playing ends the room and tells the host', async () => {
        const { room, peer } = await openRoom();
        const errors: Error[] = [];
        room.onError((e) => errors.push(e));
        peer.emit('error', { type: 'network', message: '' });
        expect(errors).toHaveLength(1);
        expect(room.open).toBe(false);
        expect(peer.destroyed).toBe(true);
    });
});
