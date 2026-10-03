/**
 * GGPO-style rollback netcode, with no network or DOM access.
 *
 * Both peers run the same deterministic `stepMatch` on the same inputs. Local
 * inputs are scheduled `delay` frames ahead; a remote input not received yet
 * is predicted (its last known value is repeated). When the real input
 * arrives and differs from the prediction, the session reloads the snapshot
 * of that frame and re-simulates up to the present in the same tick.
 *
 * Frames: `frame` is the number of frames simulated; "input of frame f" is
 * what `stepMatch` receives when it goes from f to f + 1. The state at
 * `confirmedFrame` depends only on known inputs and will never change.
 *
 * The caller (the fight scene) calls `tick(localBits)` once per 60 Hz tick,
 * sends every message of `outgoing` over an unreliable, unordered channel,
 * and passes every received input / checksum message to `receive`.
 */
import { stepMatch } from '../engine/match';
import { BTN, type GameEvent, type MatchState } from '../engine/types';
import { checksum, cloneState } from './checksum';
import { packPair, type NetMsg } from './protocol';

export interface RollbackOptions {
    /** Frames between pressing a button and the game using it (default 2). */
    delay?: number;
    /** Most frames that may be predicted before the session waits (default 8). */
    maxRollback?: number;
    /** Checksums are exchanged every this many confirmed frames (default 60). */
    checksumInterval?: number;
    /** Most frames of inputs repeated in one packet (default 64). */
    maxPacketFrames?: number;
    /**
     * Called with the events of every frame simulated, including frames
     * re-simulated by a rollback (so the view can play what a correction
     * revealed, and skip what it already played).
     */
    onFrame?: (frame: number, events: GameEvent[]) => void;
}

export interface TickResult {
    /** Events of the frame simulated this tick (possibly from a prediction). */
    events: GameEvent[];
    /**
     * Events of frames that became final this tick, in order. They lag behind
     * `events` by the network latency but never contradict the final match:
     * use them for things that must not be undone (the match result…).
     */
    confirmedEvents: GameEvent[];
    /** No frame was simulated: waiting for the remote (or letting it catch up). */
    stalled: boolean;
    /** Why it stalled: 'remote' too far behind, 'sync' time sync pause. */
    stallReason: 'remote' | 'sync' | null;
    /** Frames re-simulated by a rollback this tick (0 if none). */
    rolledBack: number;
    outgoing: NetMsg[];
}

export interface DesyncInfo {
    frame: number;
    local: number;
    remote: number;
}

/**
 * Buttons that reach the simulation: every BTN bit except start (pause is
 * local and has no meaning online). Applied to both sides' inputs, so a
 * stray bit from the network cannot make the two simulations differ.
 */
export const INPUT_MASK = BTN.up | BTN.down | BTN.left | BTN.right | BTN.light | BTN.heavy | BTN.special | BTN.ultimate;
/** Remote inputs further than this ahead of us are nonsense and dropped. */
const MAX_AHEAD = 1024;

/** Ticks over which frame advantages are averaged for time sync. */
const SYNC_WINDOW = 32;
/** At most one sync pause every this many ticks. */
const SYNC_EVERY = 8;

export class RollbackSession {
    readonly localSide: 0 | 1;
    readonly delay: number;
    readonly maxRollback: number;
    readonly checksumInterval: number;
    readonly maxPacketFrames: number;
    private readonly onFrame?: (frame: number, events: GameEvent[]) => void;

    private current: MatchState;
    private _frame = 0;

    private localInputs: number[] = [];
    private remoteInputs: number[] = [];
    /** Remote input actually fed to stepMatch for each simulated frame. */
    private usedRemote: number[] = [];
    /** Last frame such that every remote input up to it is known. */
    private remoteConfirmed = -1;
    /** Last frame of our inputs the remote has acknowledged. */
    private localAcked = -1;
    /** Earliest frame whose prediction proved wrong (Infinity if none). */
    private rollbackFrom = Infinity;

    /** snapshots[f]: state before simulating frame f, for f in [confirmedFrame, frame]. */
    private snapshots = new Map<number, MatchState>();
    private frameEvents = new Map<number, GameEvent[]>();
    private _confirmedFrame = 0;

    private localSums = new Map<number, number>();
    private remoteSums = new Map<number, number>();
    private pendingOut: NetMsg[] = [];
    private _desync: DesyncInfo | null = null;

    /** Last frame number the remote said it was at, and its advantage. */
    private remoteFrameSeen = -1;
    private _remoteAdvantage = 0;
    private advLocal: number[] = [];
    private advRemote: number[] = [];
    private ticks = 0;
    private lastSyncPause = -Infinity;

    /** Stats, for the debug overlay and the tests. */
    stats = { rollbacks: 0, framesResimulated: 0, maxRollbackSeen: 0, stalls: 0, syncPauses: 0 };

    constructor(initial: MatchState, localSide: 0 | 1, opts: RollbackOptions = {}) {
        this.current = cloneState(initial);
        this.localSide = localSide;
        this.delay = Math.max(0, opts.delay ?? 2);
        this.maxRollback = Math.max(1, opts.maxRollback ?? 8);
        this.checksumInterval = Math.max(1, opts.checksumInterval ?? 60);
        this.maxPacketFrames = Math.max(1, opts.maxPacketFrames ?? 64);
        this.onFrame = opts.onFrame;
        for (let f = 0; f < this.delay; f++) this.localInputs[f] = 0;
        this.snapshots.set(0, cloneState(this.current));
    }

    /** Current (possibly predicted) state, for rendering. Do not mutate. */
    get state(): MatchState {
        return this.current;
    }
    get frame(): number {
        return this._frame;
    }
    /** Frames whose state is final: the state at this frame will not change. */
    get confirmedFrame(): number {
        return this._confirmedFrame;
    }
    /** The final state at `confirmedFrame` (debug, tests). Do not mutate. */
    get confirmedState(): MatchState {
        return this._confirmedFrame === this._frame ? this.current : this.snapshots.get(this._confirmedFrame)!;
    }
    get desync(): DesyncInfo | null {
        return this._desync;
    }
    /** How many frames the remote says it is ahead of us, averaged (see time sync). */
    get remoteFrameAdvantage(): number {
        return this._remoteAdvantage;
    }
    /** How many frames we are ahead of what we last heard from the remote. */
    get localFrameAdvantage(): number {
        return this.remoteFrameSeen < 0 ? 0 : this._frame - this.remoteFrameSeen;
    }
    /** Frames currently predicted (simulated without the remote's input). */
    get predictedFrames(): number {
        return this._frame - (this.remoteConfirmed + 1) > 0 ? this._frame - (this.remoteConfirmed + 1) : 0;
    }

    /** Local input of a frame, and the remote one when known (tests, replays). */
    inputLog(upTo = this._confirmedFrame): [number, number][] {
        const out: [number, number][] = [];
        for (let f = 0; f < upTo; f++) {
            const l = this.localInputs[f] ?? 0;
            const r = this.remoteInputs[f] ?? 0;
            out.push(this.localSide === 0 ? [l, r] : [r, l]);
        }
        return out;
    }

    /**
     * Inputs of frames `from .. to - 1` (confirmed frames only), both players
     * packed per frame as in a `watch` message: what a spectator replays.
     */
    confirmedInputs(from: number, to = this._confirmedFrame): number[] {
        const out: number[] = [];
        for (let f = Math.max(0, from); f < Math.min(to, this._confirmedFrame); f++) {
            const l = this.localInputs[f] ?? 0;
            const r = this.remoteInputs[f] ?? 0;
            out.push(this.localSide === 0 ? packPair(l, r) : packPair(r, l));
        }
        return out;
    }

    tick(localBits: number): TickResult {
        this.ticks++;
        // 1. Schedule the local input. While stalled, the frame it belongs to
        //    is already filled: the extra press is dropped.
        const target = this._frame + this.delay;
        if (this.localInputs[target] === undefined) this.localInputs[target] = localBits & INPUT_MASK;

        // 2. Correct mispredictions.
        const rolledBack = this.rollback();

        // 3. Advance, unless the remote is too far behind or time sync says wait.
        let stallReason: TickResult['stallReason'] = null;
        const events: GameEvent[] = [];
        if (this._frame - (this.remoteConfirmed + 1) >= this.maxRollback) {
            stallReason = 'remote';
            this.stats.stalls++;
        } else if (this.shouldSyncPause()) {
            stallReason = 'sync';
            this.stats.syncPauses++;
            this.lastSyncPause = this.ticks;
        } else {
            events.push(...this.simulate());
        }

        // 4. Confirm what can be, checksum it, drop old snapshots.
        const confirmedEvents = this.confirm();

        // 5. Send our inputs (also while stalled, so the link recovers).
        this.recordAdvantage();
        const outgoing = this.pendingOut;
        this.pendingOut = [];
        outgoing.unshift(this.inputPacket());
        return { events, confirmedEvents, stalled: stallReason !== null, stallReason, rolledBack, outgoing };
    }

    receive(msg: NetMsg): void {
        if (msg.type === 'input') this.receiveInput(msg.start, msg.bits, msg.ack, msg.f, msg.adv);
        else if (msg.type === 'checksum') {
            if (msg.frame < this._confirmedFrame - 20 * this.checksumInterval) return;
            this.remoteSums.set(msg.frame, msg.sum >>> 0);
            this.compareSums(msg.frame);
        }
    }

    // ——— Internals ———

    private receiveInput(start: number, bits: number[], ack: number, f?: number, adv?: number): void {
        if (ack > this.localAcked) this.localAcked = ack;
        if (f !== undefined && f > this.remoteFrameSeen) {
            this.remoteFrameSeen = f;
            if (adv !== undefined) this._remoteAdvantage = adv;
        }
        for (let i = 0; i < bits.length; i++) {
            const fr = start + i;
            if (fr > this._frame + MAX_AHEAD) break;
            if (fr < 0 || this.remoteInputs[fr] !== undefined) continue;
            const b = bits[i] & INPUT_MASK;
            this.remoteInputs[fr] = b;
            if (fr < this._frame && this.usedRemote[fr] !== b && fr < this.rollbackFrom) this.rollbackFrom = fr;
        }
        while (this.remoteInputs[this.remoteConfirmed + 1] !== undefined) this.remoteConfirmed++;
    }

    private predictRemote(f: number): number {
        const known = this.remoteInputs[f];
        if (known !== undefined) return known;
        return this.remoteConfirmed >= 0 ? this.remoteInputs[this.remoteConfirmed] : 0;
    }

    /** Simulates frame `this._frame` and saves the snapshot of the next one. */
    private simulate(): GameEvent[] {
        const f = this._frame;
        const local = this.localInputs[f] ?? 0;
        const remote = this.predictRemote(f);
        this.usedRemote[f] = remote;
        const ev = stepMatch(this.current, this.localSide === 0 ? [local, remote] : [remote, local]);
        this.frameEvents.set(f, ev);
        this.onFrame?.(f, ev);
        this._frame = f + 1;
        this.snapshots.set(this._frame, cloneState(this.current));
        return ev;
    }

    private rollback(): number {
        const from = this.rollbackFrom;
        this.rollbackFrom = Infinity;
        if (from >= this._frame) return 0;
        const snap = this.snapshots.get(from);
        if (!snap) throw new Error(`rollback: no snapshot for frame ${from} (confirmed ${this._confirmedFrame})`);
        const to = this._frame;
        this.current = cloneState(snap);
        this._frame = from;
        while (this._frame < to) this.simulate();
        const n = to - from;
        this.stats.rollbacks++;
        this.stats.framesResimulated += n;
        if (n > this.stats.maxRollbackSeen) this.stats.maxRollbackSeen = n;
        return n;
    }

    private confirm(): GameEvent[] {
        const out: GameEvent[] = [];
        const upTo = Math.min(this.remoteConfirmed + 1, this._frame);
        // Mispredictions not yet rolled back (inputs received after this tick's
        // rollback) keep the frames from `rollbackFrom` on unconfirmed.
        const limit = Math.min(upTo, this.rollbackFrom);
        while (this._confirmedFrame < limit) {
            const f = this._confirmedFrame;
            const ev = this.frameEvents.get(f);
            if (ev) out.push(...ev);
            this.frameEvents.delete(f);
            this.snapshots.delete(f);
            this._confirmedFrame = f + 1;
            const c = this._confirmedFrame;
            if (c % this.checksumInterval === 0) {
                const snap = this.snapshots.get(c);
                if (snap) {
                    const sum = checksum(snap);
                    this.localSums.set(c, sum);
                    this.pendingOut.push({ type: 'checksum', frame: c, sum });
                    this.compareSums(c);
                }
            }
        }
        return out;
    }

    private compareSums(frame: number): void {
        const l = this.localSums.get(frame);
        const r = this.remoteSums.get(frame);
        if (l === undefined || r === undefined) return;
        if (l !== r && !this._desync) {
            this._desync = { frame, local: l, remote: r };
            console.warn(`[rollback] désynchronisation à la frame ${frame} : local ${l.toString(16)}, distant ${r.toString(16)}`);
        }
        this.localSums.delete(frame);
        this.remoteSums.delete(frame);
    }

    private inputPacket(): NetMsg {
        // Oldest unacknowledged frames first: the remote cannot confirm
        // anything past a gap, so those are the ones it needs.
        const start = Math.max(this.localAcked + 1, 0);
        const end = Math.min(this.localInputs.length, start + this.maxPacketFrames);
        const bits = this.localInputs.slice(start, end);
        return {
            type: 'input',
            start,
            bits,
            ack: this.remoteConfirmed,
            f: this._frame,
            adv: this.localFrameAdvantage
        };
    }

    private recordAdvantage(): void {
        if (this.remoteFrameSeen < 0) return;
        this.advLocal.push(this.localFrameAdvantage);
        this.advRemote.push(this._remoteAdvantage);
        if (this.advLocal.length > SYNC_WINDOW) this.advLocal.shift();
        if (this.advRemote.length > SYNC_WINDOW) this.advRemote.shift();
    }

    /**
     * Time sync: each side's advantage is its frame minus the remote's frame
     * as last heard. Latency inflates both equally, so half their difference
     * is how far ahead we really are. The side that is ahead skips a tick
     * now and then, so rollbacks stay balanced and short.
     */
    private shouldSyncPause(): boolean {
        if (this.advLocal.length < SYNC_WINDOW / 2) return false;
        if (this.ticks - this.lastSyncPause < SYNC_EVERY) return false;
        const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
        return (avg(this.advLocal) - avg(this.advRemote)) / 2 >= 1;
    }
}
