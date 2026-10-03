import type { DataConnection, Peer, PeerJSOption } from 'peerjs';
import { buildFingerprint } from './fingerprint';
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, decode, encode, type NetMsg } from './protocol';
import { codeFromText, inviteUrl, makeRoomCode, peerConfig, peerIdFor, type PeerConfig } from './peer-config';

/**
 * Peer-to-peer link between two browsers, over WebRTC.
 *
 * The PeerJS broker (signalling only) introduces the two browsers; after
 * that every byte goes directly from one to the other. Two data channels
 * share the one RTCPeerConnection:
 *  - "lobby" (PeerJS DataConnection): reliable and ordered, for everything
 *    that must arrive once and in order (hello, select, start, checksum…);
 *  - "fast" (a raw negotiated RTCDataChannel, id 100): unordered, no
 *    retransmission, for the per-frame `input` packets and ping/pong, where
 *    a late packet is worth less than the next one. Until it opens, fast
 *    messages go on the lobby channel.
 *
 * The transport handles hello/helloAck (protocol version, room full) and
 * ping/pong (round-trip time, liveness) itself; these never reach listeners.
 */

export type NetErrorKind =
    /** The signalling server could not be reached or dropped us. */
    | 'broker'
    /** No room with this code (host gone or typo). */
    | 'notFound'
    /** The other browser stopped answering / the connection failed. */
    | 'peerGone'
    /** The other side runs another version of the game. */
    | 'version'
    /** The room already has a guest. */
    | 'full'
    /** The room already has its spectator. */
    | 'specFull'
    /** The broker found the room but no direct connection could be made. */
    | 'timeout'
    /** No WebRTC in this browser. */
    | 'unsupported';

export const NET_ERROR_TEXT: Record<NetErrorKind | 'left', string> = {
    broker: 'SERVEUR DE MISE EN RELATION INJOIGNABLE',
    notFound: 'SALON INTROUVABLE',
    peerGone: 'ADVERSAIRE DÉCONNECTÉ',
    version: 'VERSIONS DU JEU DIFFÉRENTES : RECHARGEZ LA PAGE',
    full: 'CE SALON EST DÉJÀ COMPLET',
    specFull: 'UN SPECTATEUR REGARDE DÉJÀ CE SALON',
    timeout: 'CONNEXION DIRECTE IMPOSSIBLE (RÉSEAU)',
    unsupported: 'NAVIGATEUR INCOMPATIBLE (WEBRTC)',
    left: 'L\'ADVERSAIRE A QUITTÉ LE SALON'
};

export class NetError extends Error {
    constructor(readonly kind: NetErrorKind, detail?: string) {
        super(detail ? `${NET_ERROR_TEXT[kind]} (${detail})` : NET_ERROR_TEXT[kind]);
    }
}

/** Why a link closed: the peer vanished, it said goodbye, or we closed it. */
export type CloseReason = 'peerGone' | 'left' | 'local';

export interface Link {
    /** 0 for the host (left fighter), 1 for the guest. */
    readonly side: 0 | 1;
    readonly open: boolean;
    /** Smoothed round-trip time in ms (0 until the first pong). */
    readonly rtt: number;
    /** `input` goes on the unreliable channel, everything else reliably. */
    send(msg: NetMsg): void;
    /** Messages received before the first listener is added are queued for it. */
    onMessage(cb: (msg: NetMsg) => void): () => void;
    onClose(cb: (reason: CloseReason) => void): () => void;
    /** Says goodbye (a `leave` message) and tears the connection down. */
    close(): void;
}

export interface Room {
    code: string;
    /** The invite link: this page with ?salon=CODE. */
    url: string;
    /** The spectator's link: ?spectateur=CODE. */
    watchUrl: string;
    /** Resolves with the first guest that passes the hello; rejects if the room dies. */
    waitForGuest(): Promise<Link>;
    onGuest(cb: (link: Link) => void): void;
    /** A visitor was turned away (other version, room already full). */
    onRefused(cb: (kind: NetErrorKind) => void): void;
    /**
     * A spectator joined (at most one at a time, before or after the guest).
     * Its link shares the room's connection to the broker: closing it leaves
     * the guest alone.
     */
    onSpectator(cb: (link: Link) => void): void;
    /** Abandons the room (before or after a guest joined). */
    close(): void;
}

const BROKER_TIMEOUT = 10_000;
const CONNECT_TIMEOUT = 15_000;
const HELLO_TIMEOUT = 8_000;
/** Without a single message for this long, the other side is gone. */
const SILENCE_TIMEOUT = 6_000;
const PING_EVERY = 250;
const FAST_CHANNEL_ID = 100;
/** Bytes waiting in the fast channel beyond which new packets are dropped. */
const FAST_BUFFER_LIMIT = 32 * 1024;

export function currentPeerConfig(): PeerConfig {
    if (typeof location === 'undefined') return peerConfig(import.meta.env, '');
    return peerConfig(import.meta.env, location.search, location.hostname);
}

/** Waiting longer than this for the TURN credentials: go on without them. */
const ICE_FETCH_TIMEOUT = 3_000;
/** The TURN login lasts 4 h (`api/ice.js`): fetch a fresh one after 1 h. */
const ICE_REFRESH = 3_600_000;
let relayIce: Promise<RTCIceServer[]> | null = null;
let relayIceAt = 0;

/**
 * The TURN relay from the site's `/api/ice` function (`api/ice.js`), fetched
 * at most once an hour: without it, players on two different networks often
 * cannot connect. Empty when the function is missing or not configured.
 * WebRTC tries the direct routes first; the relay only carries the match
 * when none of them works.
 */
function fetchRelayIce(): Promise<RTCIceServer[]> {
    if (relayIce && Date.now() - relayIceAt > ICE_REFRESH) relayIce = null;
    relayIceAt = relayIce ? relayIceAt : Date.now();
    relayIce ??= (async () => {
        if (typeof fetch === 'undefined') return [];
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), ICE_FETCH_TIMEOUT);
        try {
            const res = await fetch('/api/ice', { signal: ctl.signal, cache: 'no-store', credentials: 'omit' });
            if (!res.ok) return [];
            const data = (await res.json()) as { iceServers?: unknown };
            return Array.isArray(data.iceServers) ? (data.iceServers as RTCIceServer[]) : [];
        } catch {
            return [];
        } finally {
            clearTimeout(timer);
        }
    })();
    const p = relayIce;
    // A failed fetch is tried again at the next connection.
    void p.then((list) => { if (!list.length && relayIce === p) relayIce = null; });
    return p;
}

async function openPeer(id: string | undefined): Promise<Peer> {
    if (typeof RTCPeerConnection === 'undefined') throw new NetError('unsupported');
    const { Peer } = await import('peerjs');
    const cfg = currentPeerConfig();
    const relay = cfg.debugPeer ? [] : await fetchRelayIce();
    const opts: PeerJSOption = { config: { iceServers: [...relay, ...cfg.iceServers] }, debug: 1 };
    if (cfg.host) { opts.host = cfg.host; opts.port = cfg.port; opts.secure = cfg.secure; }
    if (cfg.path) opts.path = cfg.path;
    if (cfg.key) opts.key = cfg.key;
    const peer = id ? new Peer(id, opts) : new Peer(opts);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { peer.destroy(); reject(new NetError('broker', 'délai dépassé')); }, BROKER_TIMEOUT);
        peer.once('open', () => { clearTimeout(timer); peer.off('error', onError); resolve(peer); });
        const onError = (err: { type: string; message: string }) => {
            clearTimeout(timer);
            peer.off('error', onError);
            peer.destroy();
            if (err.type === 'unavailable-id') reject(new IdTaken());
            else if (err.type === 'browser-incompatible') reject(new NetError('unsupported'));
            else reject(new NetError('broker', err.type));
        };
        peer.on('error', onError);
    });
}

class IdTaken extends Error {}

// ——— Test hook: a worse network on demand ———

/**
 * `?netlag=80&netjitter=30&netloss=0.1` (debug only): every message we send
 * waits `netlag` ms (plus up to `netjitter` ms for the fast channel, which
 * then arrives out of order) and a fraction `netloss` of fast-channel
 * messages is dropped. The reliable channel keeps its order (same delay for
 * all) and loses nothing, like the real thing.
 */
export interface NetSim { lag: number; jitter: number; loss: number }

export function netSimFrom(search: string): NetSim | null {
    const q = new URLSearchParams(search);
    const num = (k: string) => {
        const v = Number(q.get(k));
        return Number.isFinite(v) && v > 0 ? v : 0;
    };
    const sim = { lag: num('netlag'), jitter: num('netjitter'), loss: Math.min(0.9, num('netloss')) };
    return sim.lag || sim.jitter || sim.loss ? sim : null;
}

// ——— Link ———

class PeerLink implements Link {
    rtt = 0;
    open = true;
    private fast: RTCDataChannel | null = null;
    private msgCbs: ((msg: NetMsg) => void)[] = [];
    private closeCbs: ((reason: CloseReason) => void)[] = [];
    private queue: NetMsg[] = [];
    private lastHeard = performance.now();
    private timer: ReturnType<typeof setInterval>;
    private onUnload = () => this.close(true);
    private sim = typeof location === 'undefined' ? null : netSimFrom(location.search);

    /** `ownsPeer`: false for the host's spectator link, which shares the room's Peer with the guest's. */
    constructor(readonly side: 0 | 1, private peer: Peer, private conn: DataConnection, private ownsPeer = true) {
        conn.on('data', (d) => this.receive(d));
        conn.on('close', () => this.shut('peerGone'));
        conn.on('error', () => this.shut('peerGone'));
        const pc = conn.peerConnection;
        pc.addEventListener('connectionstatechange', () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.shut('peerGone');
        });
        try {
            const dc = pc.createDataChannel('fast', { negotiated: true, id: FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
            dc.onmessage = (e) => this.receive(e.data);
            this.fast = dc;
        } catch (e) {
            console.warn('Canal rapide indisponible, tout passe par le canal fiable.', e);
        }
        // The broker is only needed to meet; errors on it no longer matter.
        peer.on('error', (err) => console.warn('PeerJS :', err.type));
        this.timer = setInterval(() => this.heartbeat(), PING_EVERY);
        window.addEventListener('pagehide', this.onUnload);
    }

    send(msg: NetMsg): void {
        if (!this.open) return;
        const data = encode(msg);
        const unreliable = msg.type === 'input' || msg.type === 'ping' || msg.type === 'pong';
        const sim = this.sim;
        if (sim && msg.type !== 'leave') {
            if (unreliable && Math.random() < sim.loss) return;
            const wait = sim.lag + (unreliable ? Math.random() * sim.jitter : 0);
            setTimeout(() => this.rawSend(data, unreliable), wait);
            return;
        }
        this.rawSend(data, unreliable);
    }

    private rawSend(data: string, unreliable: boolean): void {
        if (!this.open) return;
        try {
            if (unreliable && this.fast?.readyState === 'open') {
                // Congested: drop rather than queue. Input packets repeat
                // every unacknowledged frame, so the next one makes up for it.
                if (this.fast.bufferedAmount < FAST_BUFFER_LIMIT) this.fast.send(data);
            }
            else if (this.conn.open) this.conn.send(data);
        } catch (e) {
            console.warn('Envoi impossible :', e);
        }
    }

    onMessage(cb: (msg: NetMsg) => void): () => void {
        this.msgCbs.push(cb);
        if (this.queue.length) {
            const q = this.queue;
            this.queue = [];
            for (const m of q) this.dispatch(m);
        }
        return () => { this.msgCbs = this.msgCbs.filter((c) => c !== cb); };
    }

    onClose(cb: (reason: CloseReason) => void): () => void {
        this.closeCbs.push(cb);
        return () => { this.closeCbs = this.closeCbs.filter((c) => c !== cb); };
    }

    close(pageClosed = false): void {
        if (!this.open) return;
        this.send(pageClosed ? { type: 'leave', closed: true } : { type: 'leave' });
        // Give the goodbye a moment to leave before tearing everything down.
        const { peer, conn } = this;
        setTimeout(() => (this.ownsPeer ? peer.destroy() : conn.close()), 300);
        this.shut('local', false);
    }

    private receive(data: unknown): void {
        // Only text frames (or small binary ones) are protocol messages.
        const text = typeof data === 'string' ? data
            : data instanceof ArrayBuffer && data.byteLength <= MAX_MESSAGE_BYTES ? new TextDecoder().decode(data) : null;
        const msg = text === null ? null : decode(text);
        if (!msg || !this.open) return;
        this.lastHeard = performance.now();
        if (msg.type === 'ping') { this.send({ type: 'pong', t: msg.t }); return; }
        if (msg.type === 'pong') {
            const sample = Math.max(0, performance.now() - msg.t);
            this.rtt = this.rtt ? Math.round(this.rtt * 0.8 + sample * 0.2) : Math.round(sample);
            return;
        }
        if (msg.type === 'hello' || msg.type === 'helloAck') return;
        if (msg.type === 'leave') { this.shut(msg.closed ? 'peerGone' : 'left'); return; }
        this.dispatch(msg);
    }

    private dispatch(msg: NetMsg): void {
        if (!this.msgCbs.length) { this.queue.push(msg); return; }
        for (const cb of [...this.msgCbs]) cb(msg);
    }

    private heartbeat(): void {
        if (!this.open) return;
        if (performance.now() - this.lastHeard > SILENCE_TIMEOUT) { this.shut('peerGone'); return; }
        this.send({ type: 'ping', t: performance.now() });
    }

    private shut(reason: CloseReason, destroy = true): void {
        if (!this.open) return;
        this.open = false;
        clearInterval(this.timer);
        window.removeEventListener('pagehide', this.onUnload);
        if (destroy) {
            if (this.ownsPeer) this.peer.destroy();
            else this.conn.close();
        }
        for (const cb of this.closeCbs) cb(reason);
    }
}

// ——— Host ———

/**
 * Registers a room on the broker. Resolves once the room exists (its code is
 * then valid); rejects with NetError('broker') when the broker is unreachable.
 */
export async function hostRoom(): Promise<Room> {
    let peer: Peer | null = null;
    let code = '';
    for (let tries = 0; !peer; tries++) {
        code = makeRoomCode();
        try {
            peer = await openPeer(peerIdFor(code));
        } catch (e) {
            if (!(e instanceof IdTaken) || tries >= 4) throw e instanceof IdTaken ? new NetError('broker', 'code indisponible') : e;
        }
    }
    const p = peer;
    let link: PeerLink | null = null;
    let spectator: PeerLink | null = null;
    let closed = false;
    const guestCbs: ((l: Link) => void)[] = [];
    const spectatorCbs: ((l: Link) => void)[] = [];
    const refusedCbs: ((k: NetErrorKind) => void)[] = [];
    let resolveGuest!: (l: Link) => void;
    let rejectGuest!: (e: Error) => void;
    const guest = new Promise<Link>((res, rej) => { resolveGuest = res; rejectGuest = rej; });
    guest.catch(() => { /* surfaced to whoever awaits it */ });

    const refuse = (conn: DataConnection, reason: 'version' | 'full' | 'specFull') => {
        conn.send(encode({ type: 'helloAck', v: PROTOCOL_VERSION, ok: false, reason }));
        setTimeout(() => conn.close(), 500);
        for (const cb of refusedCbs) cb(reason);
    };

    p.on('connection', (conn) => {
        if (closed) { conn.close(); return; }
        const onData = (data: unknown) => {
            const msg = typeof data === 'string' ? decode(data) : null;
            if (!msg || msg.type !== 'hello') return;
            conn.off('data', onData);
            if (msg.spec ? spectator?.open : link) { refuse(conn, msg.spec ? 'specFull' : 'full'); return; }
            if (msg.v !== PROTOCOL_VERSION || msg.b !== buildFingerprint()) { refuse(conn, 'version'); return; }
            if (msg.spec) {
                conn.send(encode({ type: 'helloAck', v: PROTOCOL_VERSION, ok: true }));
                const s = new PeerLink(0, p, conn, false);
                spectator = s;
                s.onClose(() => { if (spectator === s) spectator = null; });
                for (const cb of spectatorCbs) cb(s);
                return;
            }
            conn.send(encode({ type: 'helloAck', v: PROTOCOL_VERSION, ok: true }));
            link = new PeerLink(0, p, conn);
            resolveGuest(link);
            for (const cb of guestCbs) cb(link);
        };
        conn.on('data', onData);
    });
    // Stay on the broker as long as the room is open: after the guest, a
    // spectator may still come.
    p.on('disconnected', () => {
        if (closed) return;
        setTimeout(() => { if (!closed && !p.destroyed && p.disconnected) p.reconnect(); }, 1000);
    });
    p.on('error', (err) => {
        if (link || closed) return;
        if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
            closed = true;
            p.destroy();
            rejectGuest(new NetError('broker', err.type));
        }
    });

    const cfg = currentPeerConfig();
    const publicUrl = __PREVIEW_BUILD__ ? undefined : __PUBLIC_URL__;
    return {
        code,
        url: inviteUrl(code, location, cfg.debugPeer, publicUrl),
        watchUrl: inviteUrl(code, location, cfg.debugPeer, publicUrl, 'spectateur'),
        waitForGuest: () => guest,
        onGuest: (cb) => { guestCbs.push(cb); if (link) cb(link); },
        onRefused: (cb) => { refusedCbs.push(cb); },
        onSpectator: (cb) => { spectatorCbs.push(cb); if (spectator?.open) cb(spectator); },
        close: () => {
            if (closed) return;
            closed = true;
            spectator?.close();
            if (link) link.close();
            else p.destroy();
            rejectGuest(new Error('salon fermé'));
        }
    };
}

// ——— Guest ———

/**
 * Joins a room by code (or pasted invite link). Resolves with a live link
 * once the host has accepted our hello; rejects with a NetError otherwise.
 * `spectate`: as the room's spectator, who only receives the match.
 */
export async function joinRoom(codeOrUrl: string, signal?: AbortSignal, spectate = false): Promise<Link> {
    const code = codeFromText(codeOrUrl);
    if (!code) throw new NetError('notFound', 'code invalide');
    const peer = await openPeer(undefined);
    if (signal?.aborted) { peer.destroy(); throw new Error('annulé'); }
    const abort = () => peer.destroy();
    signal?.addEventListener('abort', abort);
    try {
        const conn = peer.connect(peerIdFor(code), { serialization: 'raw', reliable: true, label: 'lobby' });
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new NetError('timeout')), CONNECT_TIMEOUT);
            const done = (e?: Error) => { clearTimeout(timer); peer.off('error', onError); if (e) reject(e); else resolve(); };
            const onError = (err: { type: string }) => {
                if (err.type === 'peer-unavailable') done(new NetError('notFound'));
                else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') done(new NetError('broker', err.type));
                else if (err.type === 'webrtc' || err.type === 'negotiation-failed') done(new NetError('timeout', err.type));
            };
            peer.on('error', onError);
            conn.once('open', () => done());
            signal?.addEventListener('abort', () => done(new Error('annulé')));
        });
        // Hello: the host checks our version and whether the room is free.
        const ack = await new Promise<Extract<NetMsg, { type: 'helloAck' }>>((resolve, reject) => {
            const timer = setTimeout(() => { conn.off('data', onData); reject(new NetError('timeout', 'pas de réponse de l\'hôte')); }, HELLO_TIMEOUT);
            const onData = (data: unknown) => {
                const msg = decode(data);
                if (msg?.type !== 'helloAck') return;
                clearTimeout(timer);
                conn.off('data', onData);
                resolve(msg);
            };
            conn.on('data', onData);
            conn.once('close', () => { clearTimeout(timer); reject(new NetError('peerGone')); });
            const hello: NetMsg = { type: 'hello', v: PROTOCOL_VERSION, name: spectate ? 'SPECTATEUR' : 'J2', b: buildFingerprint() };
            if (spectate) hello.spec = true;
            conn.send(encode(hello));
        });
        if (!ack.ok || ack.v !== PROTOCOL_VERSION) {
            throw new NetError(ack.reason === 'full' ? 'full' : ack.reason === 'specFull' ? 'specFull' : 'version');
        }
        signal?.removeEventListener('abort', abort);
        // The broker has done its job; keep the WebRTC connection only.
        const link = new PeerLink(1, peer, conn);
        peer.disconnect();
        return link;
    } catch (e) {
        peer.destroy();
        throw e;
    }
}
