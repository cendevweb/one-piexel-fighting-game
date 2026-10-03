import { play } from '../audio/sound';
import { startMusic } from '../audio/music';
import { playRoundEndVoices, playStartVoices, stopVoice } from '../audio/voices';
import { createMatch, stepMatch } from '../engine/match';
import { BTN, type GameEvent, type MatchState } from '../engine/types';
import { endInputTick, readSolo, rumbleOn, type MenuInput } from '../input/devices';
import { checksum } from '../net/checksum';
import type { NetMsg } from '../net/protocol';
import { RollbackSession } from '../net/rollback';
import type { Link } from '../net/transport';
import { drawText } from '../render/font';
import { FightView, voiceChannel } from '../render/fightView';
import { STAGES } from '../render/stage';
import { Cpu, LEVELS } from './ai';
import { OptionList, type App, type Scene } from './app';
import type { Setup } from './scenes';
import { COLORS, menuItems, panel } from './ui';

/**
 * The online fight: both browsers run the same `stepMatch` on the same
 * inputs through a RollbackSession (net/rollback.ts).
 *
 * Every 60 Hz tick: read our pad (J1 keys or first gamepad) → session.tick
 * → send its packets on the fast channel, tagged with the match seed →
 * draw the session's (possibly predicted) state. Everything that decides
 * the fight (KO, rounds, freezes) is in the engine state, so both sides
 * agree; the view only turns events into effects and sounds, each played
 * once even when a rollback simulates its frame again. The match result is
 * read from the confirmed state only.
 *
 * No pause: Escape asks whether to leave (the fight goes on meanwhile).
 */

/** What the fight needs from the lobby's OnlineSession (kept as a type to avoid an import cycle). */
export interface FightLink {
    readonly app: App;
    readonly link: Link;
    readonly ended: boolean;
    readonly side: 0 | 1;
    take(): NetMsg[];
    putBack(rest: NetMsg[]): void;
    send(msg: NetMsg): void;
    quit(): void;
    /** A spectator is watching (host side). */
    readonly watched: boolean;
    /** Host: forwards the newly confirmed frames to the spectator, if any. */
    watchFrames(seed: number, rb: RollbackSession): void;
}

/** Frames of local input delay (`?netdelay=N` to try other values). */
function inputDelay(): number {
    const v = Number(new URLSearchParams(location.search).get('netdelay'));
    return Number.isInteger(v) && v >= 0 && v <= 8 ? v : 2;
}

/** Debug (dev server or ?netdebug): `?bot=0..N` lets the CPU play our side. */
function debugBot(side: 0 | 1): Cpu | null {
    const params = new URLSearchParams(location.search);
    if (!import.meta.env.DEV && !params.has('netdebug')) return null;
    const raw = params.get('bot');
    if (raw === null) return null;
    const lvl = Math.max(0, Math.min(LEVELS.length - 1, Number(raw) || 0));
    return new Cpu(LEVELS[lvl], (Date.now() & 0xffff) + side * 977);
}

/**
 * Identity of an event within its frame, without positions or amounts: a
 * rollback that moves a hit spark a few pixels is the same hit, not a new
 * one to play again.
 */
function eventKey(e: GameEvent): string {
    const r = e as Record<string, unknown>;
    return `${e.type}:${r.side ?? r.attacker ?? ''}:${r.slot ?? r.anim ?? r.spark ?? r.round ?? ''}`;
}

/** An ultimate starting (its voice line follows it). */
const isUltimate = (e: GameEvent): e is Extract<GameEvent, { type: 'move' }> =>
    e.type === 'move' && (e.slot === 'ultimate' || e.slot === 'ultimate2');

const END_DELAY = 150;
/** Waiting on the remote for this many ticks shows the "waiting" notice. */
const STALL_NOTICE = 20;

export class OnlineFightScene implements Scene {
    readonly runsHidden = true;
    private rb: RollbackSession;
    private view: FightView;
    private t = 0;
    private endT = 0;
    private done = false;
    private stalledFor = 0;
    private quitOpen = false;
    private quitList = new OptionList(['NON, CONTINUER', 'OUI, QUITTER']);
    private bot: Cpu | null;
    /** Events already shown, per frame (only the unconfirmed frames are kept). */
    private shown = new Map<number, Set<string>>();
    private fresh: [number, GameEvent[]][] = [];
    private endSoundPlayed = false;
    /**
     * Ultimate lines started from predicted frames: a rollback may find the
     * ultimate never happened, and its line is then cut off.
     */
    private voiced: { frame: number; side: number; slot: string }[] = [];

    constructor(
        private session: FightLink,
        private setup: Setup,
        private seed: number,
        private onEnd: (winner: number) => void
    ) {
        const initial = createMatch(setup.p1, setup.p2);
        this.rb = new RollbackSession(initial, session.side, {
            delay: inputDelay(),
            onFrame: (f, ev) => { if (ev.length) this.fresh.push([f, ev]); }
        });
        const stage = STAGES.find((s) => s.id === setup.stage) ?? STAGES[0];
        const names: [string, string] = session.side === 0 ? ['J1 · VOUS', 'J2'] : ['J1', 'J2 · VOUS'];
        this.view = new FightView(this.rb.state, stage, { names });
        this.bot = debugBot(session.side);
        this.exposeDebug();
    }

    enter(): void { startMusic(this.setup.stage); }

    tick(menu: MenuInput[]): void {
        this.t++;
        if (this.done || this.session.ended) { endInputTick(); return; }
        this.receive();

        // Escape: leave? The match does not stop for it.
        let bits = 0;
        if (this.quitOpen) {
            const r = this.quitList.handle(menu);
            if (r === 'back' || menu.some((m) => m.action === 'start')) this.quitOpen = false;
            else if (r === 'confirm') {
                if (this.quitList.index === 1) { this.done = true; endInputTick(); this.session.quit(); return; }
                this.quitOpen = false;
            }
        } else if (menu.some((m) => m.action === 'start')) {
            this.quitOpen = true;
            this.quitList.index = 0;
            play('uiConfirm');
        } else {
            bits = this.bot ? this.bot.next(this.rb.state, this.session.side) : readSolo() & ~BTN.start;
        }
        const r = this.rb.tick(bits);
        // A stalled tick drops our input: keep a short tap for the next one.
        if (!r.stalled) endInputTick();
        for (const m of r.outgoing) this.session.send({ ...m, m: this.seed } as NetMsg);
        this.session.watchFrames(this.seed, this.rb);
        this.stalledFor = r.stallReason === 'remote' ? this.stalledFor + 1 : 0;
        this.view.state = this.rb.state;
        this.showEvents();
        this.settleVoices(r.confirmedEvents);
        if (!r.stalled) this.view.update();

        // The result comes from the confirmed state: it can no longer change.
        for (const e of r.confirmedEvents) {
            // Both opening lines once, as the first round is called; then our
            // round won or lost, once it is certain (a prediction could be wrong).
            const chars = this.rb.confirmedState.fighters.map((f) => f.char);
            if (e.type === 'round' && e.round === 1) playStartVoices(chars, voiceChannel);
            if (e.type === 'roundEnd') playRoundEndVoices(chars, e.winner, [this.session.side], voiceChannel);
            if (e.type === 'matchEnd' && !this.endSoundPlayed) {
                this.endSoundPlayed = true;
                play(e.winner === this.session.side ? 'win' : e.winner === 2 ? 'win' : 'lose');
            }
        }
        if (this.rb.confirmedState.phase === 'matchEnd') {
            this.endT++;
            if (this.endT > END_DELAY) {
                this.done = true;
                this.onEnd(this.rb.confirmedState.winner);
            }
        }
    }

    /** Feeds this match's packets to the session; keeps lobby messages for the results screen. */
    private receive(): void {
        const keep: NetMsg[] = [];
        for (const msg of this.session.take()) {
            if (msg.type === 'input' || msg.type === 'checksum') {
                if (msg.m === this.seed) this.rb.receive(msg);
                // Else: a straggler of the previous match.
            } else keep.push(msg);
        }
        if (keep.length) this.session.putBack(keep);
    }

    /**
     * Plays each event of each simulated frame once: a rollback re-simulates
     * frames whose events were mostly shown already; only what the
     * correction changed (a hit that did land after all…) is new.
     */
    private showEvents(): void {
        const out: GameEvent[] = [];
        for (const [f, evs] of this.fresh) {
            const predicted = f >= this.rb.confirmedFrame;
            let seen = this.shown.get(f);
            if (!seen) { seen = new Set(); this.shown.set(f, seen); }
            const count = new Map<string, number>();
            for (const e of evs) {
                const k = eventKey(e);
                const n = (count.get(k) ?? 0) + 1;
                count.set(k, n);
                const id = `${k}#${n}`;
                // A correction can move the same event by a frame.
                if (seen.has(id) || this.shown.get(f - 1)?.has(id) || this.shown.get(f + 1)?.has(id)) continue;
                seen.add(id);
                out.push(e);
                if (predicted && isUltimate(e)) this.voiced.push({ frame: f, side: e.side, slot: e.slot });
            }
        }
        this.fresh = [];
        const oldest = this.rb.confirmedFrame - 2;
        for (const f of this.shown.keys()) if (f < oldest) this.shown.delete(f);
        if (out.length) {
            this.view.handle(out);
            rumbleOn(out, this.session.side, [0, 1]);
        }
    }

    /** Keeps the ultimate lines the confirmed frames agree with; cuts the others off. */
    private settleVoices(confirmed: GameEvent[]): void {
        for (const e of confirmed) {
            if (!isUltimate(e)) continue;
            const i = this.voiced.findIndex((v) => v.side === e.side && v.slot === e.slot);
            if (i >= 0) this.voiced.splice(i, 1);
        }
        // A correction can move an event by a frame: wait one more.
        this.voiced = this.voiced.filter((v) => {
            if (this.rb.confirmedFrame <= v.frame + 1) return true;
            stopVoice(voiceChannel(v.side));
            return false;
        });
    }

    draw(ctx: CanvasRenderingContext2D): void {
        this.view.draw(ctx);
        this.drawNet(ctx);
        if (this.quitOpen) {
            ctx.fillStyle = 'rgba(8,4,16,0.7)';
            ctx.fillRect(0, 0, 640, 360);
            panel(ctx, 170, 120, 300, 110, COLORS.red);
            drawText(ctx, 'QUITTER LE COMBAT ?', 320, 134, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, scale: 2, align: 'center' });
            drawText(ctx, 'LE COMBAT CONTINUE PENDANT CE TEMPS.', 320, 156, { color: '#cfc4dc', outline: COLORS.ink, align: 'center' });
            menuItems(ctx, this.quitList.items, this.quitList.index, 206, 176, this.t);
        }
    }

    /** Ping, waiting notice and desync warning. */
    private drawNet(ctx: CanvasRenderingContext2D): void {
        const rtt = this.session.link.rtt;
        const color = rtt === 0 ? COLORS.dim : rtt < 80 ? '#9dff7a' : rtt < 160 ? COLORS.gold : COLORS.red;
        drawText(ctx, rtt ? `PING ${rtt} MS` : 'PING …', 320, 348, { color, outline: COLORS.ink, align: 'center' });
        if (this.session.watched) drawText(ctx, '1 SPECTATEUR', 632, 348, { color: COLORS.blue, outline: COLORS.ink, align: 'right' });
        if (this.stalledFor > STALL_NOTICE) {
            const dots = '.'.repeat(1 + ((this.t >> 4) % 3));
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, 150, 640, 24);
            drawText(ctx, `EN ATTENTE DE L'ADVERSAIRE${dots}`, 320, 156, { color: COLORS.gold, outline: COLORS.ink, scale: 2, align: 'center' });
        }
        if (this.rb.desync) {
            ctx.fillStyle = 'rgba(60,0,0,0.75)';
            ctx.fillRect(0, 44, 640, 16);
            drawText(ctx, 'DÉSYNCHRONISATION DÉTECTÉE : LES DEUX ÉCRANS DIFFÈRENT', 320, 48, { color: '#fff', outline: COLORS.ink, align: 'center' });
        }
    }

    /** Read-only hook for the end-to-end test (dev server or ?netdebug). */
    private exposeDebug(): void {
        if (!import.meta.env.DEV && !new URLSearchParams(location.search).has('netdebug')) return;
        const rb = this.rb;
        const summary = (s: MatchState) => ({
            phase: s.phase, round: s.round, winner: s.winner, clock: s.clock,
            health: s.fighters.map((f) => f.health), wins: s.fighters.map((f) => f.wins), meter: s.fighters.map((f) => f.meter)
        });
        (window as unknown as { __opfg: unknown }).__opfg = {
            scene: 'onlineFight',
            seed: this.seed,
            side: this.session.side,
            get frame() { return rb.frame; },
            get confirmedFrame() { return rb.confirmedFrame; },
            get desync() { return rb.desync; },
            get stats() { return rb.stats; },
            get confirmed() { return summary(rb.confirmedState); },
            get current() { return summary(rb.state); },
            /** Checksum of the confirmed state, with the frame it belongs to. */
            confirmedSum: () => ({ frame: rb.confirmedFrame, sum: checksum(rb.confirmedState) }),
            inputLog: () => rb.inputLog(),
            rtt: () => this.session.link.rtt,
            /** Replays the input log from the start: state summary and checksum after `n` frames. */
            replay: (n: number) => {
                const st = createMatch(this.setup.p1, this.setup.p2);
                for (const inputs of rb.inputLog(Math.min(n, rb.confirmedFrame))) stepMatch(st, inputs);
                return { ...summary(st), sum: checksum(st) };
            },
            /** Test hook: a CPU of this level plays our side, or null for the keyboard. */
            setBot: (level: number | null) => { this.bot = level === null ? null : new Cpu(LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level))], 7 + this.session.side); }
        };
    }
}
