/**
 * Wire protocol between two browsers in an online match.
 *
 * Messages are JSON objects tagged by `type`. Input packets are sent every
 * frame and stay small (a few dozen bytes). Everything here is plain data: the transport
 * (net/transport.ts) only has to call `encode` / `decode`.
 */

/** Bump whenever a message or the simulation changes incompatibly. */
export const PROTOCOL_VERSION = 4;

export type NetMsg =
    /**
     * First message of the guest; the host answers with helloAck. `b`: the
     * build fingerprint (net/fingerprint.ts): two builds whose simulations
     * differ cannot play together even under the same protocol version.
     * `spec`: a spectator, not the second player (one at most per room).
     */
    | { type: 'hello'; v: number; name: string; b?: number; spec?: boolean }
    | { type: 'helloAck'; v: number; ok: boolean; reason?: 'version' | 'full' | 'specFull' | string }
    /** Character select: cursor / chosen fighter and whether it is locked in. */
    | { type: 'select'; char: string; ready: boolean }
    /** Stage chosen by the host. */
    | { type: 'stage'; stage: string }
    /** Host → guest: the match starts with these fighters on this stage. */
    | { type: 'start'; p1: string; p2: string; stage: string; seed?: number }
    /**
     * Inputs of the sender for frames `start .. start + bits.length - 1`
     * (redundant: every unacknowledged frame is resent each tick), and `ack`:
     * the last frame of the receiver's inputs the sender has (−1 if none).
     * `f` is the sender's current frame and `adv` its frame advantage, for
     * time sync (see net/rollback.ts). `m` names the match (its `start`
     * seed) so a late packet of the previous match is never mixed into the
     * next one.
     */
    | { type: 'input'; start: number; bits: number[]; ack: number; f?: number; adv?: number; m?: number }
    /** Checksum of the confirmed state after simulating `frame` frames. */
    | { type: 'checksum'; frame: number; sum: number; m?: number }
    | { type: 'rematch'; want: boolean }
    /**
     * Host → spectator, reliable: the confirmed inputs of both players for
     * frames `start .. start + bits.length - 1` of match `m`, each packed as
     * `p1 | p2 << 9`. Sent in order with no gap, from frame 0 (a spectator
     * arriving mid-match replays it to the present).
     */
    | { type: 'watch'; m: number; start: number; bits: number[] }
    /**
     * Host → spectator: what the players are doing between two matches;
     * `waiting`: the guest left, the host waits for another.
     */
    | { type: 'lobby'; what: 'select' | 'stage' | 'results' | 'waiting' }
    /**
     * After a match: back to the character select, both players, same room.
     * `m` names the match just played (its `start` seed), so a request that
     * crossed a rematch never pulls the next match's results screen back.
     */
    | { type: 'reselect'; m: number }
    /** Goodbye; `closed`: the page was closed (shown as a disconnection, not a choice). */
    | { type: 'leave'; closed?: boolean }
    | { type: 'ping'; t: number }
    | { type: 'pong'; t: number };

export type NetMsgType = NetMsg['type'];


export type InputMsg = Extract<NetMsg, { type: 'input' }>;
export type ChecksumMsg = Extract<NetMsg, { type: 'checksum' }>;
export type WatchMsg = Extract<NetMsg, { type: 'watch' }>;

/** Both players' inputs of one frame in one number (a `watch` entry). */
export const packPair = (p1: number, p2: number): number => (p1 & 0x1ff) | ((p2 & 0x1ff) << 9);
export const unpackPair = (v: number): [number, number] => [v & 0x1ff, (v >> 9) & 0x1ff];

export function encode(msg: NetMsg): string {
    return JSON.stringify(msg);
}

/** Longest message accepted (an input packet is well under 1 KB). */
export const MAX_MESSAGE_BYTES = 4096;
/** Most frames of inputs one packet may carry. */
export const MAX_PACKET_FRAMES = 128;
/** Frame numbers stay far below this (a match is a few thousand frames). */
const MAX_FRAME = 1 << 24;

const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 40 && /^[a-z0-9_-]+$/i.test(v);
const optInt = (v: unknown, lo: number, hi: number) => v === undefined || int(v, lo, hi);

/**
 * Parses and validates a message; returns null for anything malformed,
 * oversized or unknown. The result is rebuilt field by field: nothing the
 * sender added beyond the protocol gets through.
 */
export function decode(data: unknown): NetMsg | null {
    let o: unknown = data;
    if (typeof data === 'string') {
        if (data.length > MAX_MESSAGE_BYTES) return null;
        try {
            o = JSON.parse(data);
        } catch {
            return null;
        }
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const m = o as Record<string, unknown>;
    switch (m.type) {
        case 'hello': {
            if (!int(m.v, 0, 1e6) || typeof m.name !== 'string' || m.name.length > 32 || !optInt(m.b, 0, 0xffffffff)) return null;
            if (m.spec !== undefined && typeof m.spec !== 'boolean') return null;
            const r: NetMsg = { type: 'hello', v: m.v, name: m.name };
            if (m.b !== undefined) r.b = m.b as number;
            if (m.spec === true) r.spec = true;
            return r;
        }
        case 'helloAck': {
            if (!int(m.v, 0, 1e6) || typeof m.ok !== 'boolean') return null;
            if (m.reason !== undefined && (typeof m.reason !== 'string' || m.reason.length > 32)) return null;
            const r: NetMsg = { type: 'helloAck', v: m.v, ok: m.ok };
            if (typeof m.reason === 'string') r.reason = m.reason;
            return r;
        }
        case 'select':
            if (!id(m.char) || typeof m.ready !== 'boolean') return null;
            return { type: 'select', char: m.char, ready: m.ready };
        case 'stage':
            if (!id(m.stage)) return null;
            return { type: 'stage', stage: m.stage };
        case 'start':
            if (!id(m.p1) || !id(m.p2) || !id(m.stage) || !optInt(m.seed, 0, 0x7fffffff)) return null;
            return m.seed === undefined
                ? { type: 'start', p1: m.p1, p2: m.p2, stage: m.stage }
                : { type: 'start', p1: m.p1, p2: m.p2, stage: m.stage, seed: m.seed as number };
        case 'input': {
            if (!int(m.start, 0, MAX_FRAME) || !int(m.ack, -1, MAX_FRAME) || !Array.isArray(m.bits)) return null;
            if (m.bits.length > MAX_PACKET_FRAMES || !m.bits.every((b) => int(b, 0, 0x1ff))) return null;
            if (!optInt(m.f, 0, MAX_FRAME) || !optInt(m.adv, -MAX_FRAME, MAX_FRAME) || !optInt(m.m, 0, 0x7fffffff)) return null;
            const r: InputMsg = { type: 'input', start: m.start, bits: m.bits as number[], ack: m.ack };
            if (m.f !== undefined) r.f = m.f as number;
            if (m.adv !== undefined) r.adv = m.adv as number;
            if (m.m !== undefined) r.m = m.m as number;
            return r;
        }
        case 'checksum': {
            if (!int(m.frame, 0, MAX_FRAME) || !int(m.sum, -0x80000000, 0xffffffff) || !optInt(m.m, 0, 0x7fffffff)) return null;
            const r: ChecksumMsg = { type: 'checksum', frame: m.frame, sum: m.sum };
            if (m.m !== undefined) r.m = m.m as number;
            return r;
        }
        case 'rematch':
            if (typeof m.want !== 'boolean') return null;
            return { type: 'rematch', want: m.want };
        case 'watch':
            if (!int(m.m, 0, 0x7fffffff) || !int(m.start, 0, MAX_FRAME) || !Array.isArray(m.bits)) return null;
            if (m.bits.length > MAX_PACKET_FRAMES || !m.bits.every((b) => int(b, 0, 0x3ffff))) return null;
            return { type: 'watch', m: m.m, start: m.start, bits: m.bits as number[] };
        case 'lobby':
            if (m.what !== 'select' && m.what !== 'stage' && m.what !== 'results' && m.what !== 'waiting') return null;
            return { type: 'lobby', what: m.what };
        case 'reselect':
            if (!int(m.m, 0, 0x7fffffff)) return null;
            return { type: 'reselect', m: m.m };
        case 'leave':
            if (m.closed !== undefined && typeof m.closed !== 'boolean') return null;
            return m.closed === undefined ? { type: 'leave' } : { type: 'leave', closed: m.closed as boolean };
        case 'ping':
        case 'pong':
            if (!num(m.t)) return null;
            return { type: m.type, t: m.t };
        default:
            return null;
    }
}
