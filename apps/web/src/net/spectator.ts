/**
 * The online spectator's data flow, with no network or DOM access.
 *
 *  - SpectatorRelay (host): what the spectator is told: where the players
 *    are between matches (`lobby`), each match's `start`, then its confirmed
 *    inputs (`watch`) in order, from frame 0 for a spectator arriving late.
 *  - SpectatorFeed (spectator): the received inputs and how many frames to
 *    simulate each tick: a few frames in hand against jitter, two a tick when
 *    falling behind, a silent jump when far behind.
 */
import { MAX_PACKET_FRAMES, unpackPair, type NetMsg, type WatchMsg } from './protocol';

export type LobbyWhat = Extract<NetMsg, { type: 'lobby' }>['what'];
export interface WatchedMatch { p1: string; p2: string; stage: string; seed: number }

export class SpectatorRelay {
    private send: ((msg: NetMsg) => void) | null = null;
    private match: WatchedMatch | null = null;
    /** Frames of `match` already sent. */
    private sent = 0;
    private where: LobbyWhat = 'select';

    get attached(): boolean { return this.send !== null; }

    /** A spectator arrived: tell it where we are (a match in progress: from its start). */
    attach(send: (msg: NetMsg) => void): void {
        this.send = send;
        this.sent = 0;
        if (this.match) send({ type: 'start', ...this.match });
        else send({ type: 'lobby', what: this.where });
    }

    detach(): void { this.send = null; }

    /** The players are between matches, on this screen. */
    lobby(what: LobbyWhat): void {
        this.match = null;
        this.where = what;
        this.send?.({ type: 'lobby', what });
    }

    /** A match starts. */
    start(match: WatchedMatch): void {
        this.match = { ...match };
        this.sent = 0;
        this.send?.({ type: 'start', ...this.match });
    }

    /**
     * Every fight tick: frames up to `confirmed` of match `seed` not sent yet
     * go out, in packets of at most MAX_PACKET_FRAMES. `inputs(from, to)`
     * gives the packed inputs of those frames (RollbackSession.confirmedInputs).
     */
    frames(seed: number, confirmed: number, inputs: (from: number, to: number) => number[]): void {
        const send = this.send;
        if (!send || this.match?.seed !== seed) return;
        while (this.sent < confirmed) {
            const bits = inputs(this.sent, Math.min(confirmed, this.sent + MAX_PACKET_FRAMES));
            if (!bits.length) break;
            send({ type: 'watch', m: seed, start: this.sent, bits });
            this.sent += bits.length;
        }
    }
}

/** Frames kept in hand before playing, against jitter (~100 ms). */
export const SPECTATOR_BUFFER = 6;
/** Further behind than this: jump ahead without effects or sounds. */
export const SPECTATOR_CATCH_UP = 120;

export class SpectatorFeed {
    private inputs: number[] = [];
    private frame = 0;
    private playing = false;
    /** Out of frames during the match (the view says it is waiting). */
    starved = false;

    constructor(readonly seed: number) {}

    get received(): number { return this.inputs.length; }
    /** Frames received but not played yet. */
    get backlog(): number { return this.inputs.length - this.frame; }
    get played(): number { return this.frame; }

    /**
     * Adds a packet of this match. The channel is reliable and ordered, so a
     * packet starts where the last one ended; an overlap is dropped, a gap or
     * another match's packet refused (false).
     */
    push(msg: WatchMsg): boolean {
        if (msg.m !== this.seed) return false;
        const skip = this.inputs.length - msg.start;
        if (skip < 0) return false;
        for (let i = skip; i < msg.bits.length; i++) this.inputs.push(msg.bits[i]);
        return true;
    }

    /**
     * How many frames to simulate this tick: `skip` silently first, then
     * `play` with effects. `over`: the match already ended on screen, so a
     * thin buffer no longer matters.
     */
    plan(over: boolean): { skip: number; play: number } {
        let skip = 0;
        if (this.backlog > SPECTATOR_CATCH_UP) {
            skip = this.backlog - SPECTATOR_BUFFER;
            this.playing = true;
        }
        const left = this.backlog - skip;
        if (!this.playing && (left >= SPECTATOR_BUFFER || (over && left > 0))) this.playing = true;
        if (this.playing && left === 0) this.playing = false;
        this.starved = !this.playing && !over;
        const play = !this.playing ? 0 : Math.min(left, left > SPECTATOR_BUFFER * 3 ? 2 : 1);
        return { skip, play };
    }

    /** Both players' inputs of the next frame; advances. */
    next(): [number, number] {
        return unpackPair(this.inputs[this.frame++]);
    }

    inputAt(frame: number): [number, number] {
        return unpackPair(this.inputs[frame]);
    }
}
