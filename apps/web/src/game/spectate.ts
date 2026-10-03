import { play } from '../audio/sound';
import { startMusic } from '../audio/music';
import { playRoundEndVoices, playStartVoices } from '../audio/voices';
import { ROSTER } from '../characters';
import { createMatch, stepMatch } from '../engine/match';
import { getChar } from '../engine/registry';
import type { GameEvent, MatchState } from '../engine/types';
import { endInputTick, type MenuInput } from '../input/devices';
import { checksum } from '../net/checksum';
import { unpackPair, type NetMsg } from '../net/protocol';
import { NET_ERROR_TEXT, type Link } from '../net/transport';
import { drawText } from '../render/font';
import { FightView, voiceChannel } from '../render/fightView';
import { STAGES } from '../render/stage';
import { OptionList, type App, type Scene } from './app';
import { NetNoticeScene } from './online';
import { MainMenuScene, VersusScene, type Setup } from './scenes';
import { COLORS, hint, menuBackdrop, menuItems, panel, title } from './ui';

/**
 * Online spectator: one per room, who only watches.
 *
 *   ?spectateur=CODE (or VERSUS → REGARDER UN SALON) → waiting screen
 *   → VS → the fight, replayed from the host's confirmed inputs → waiting…
 *
 * The host forwards every confirmed frame of both players (`watch`
 * messages, net/protocol.ts) and the spectator runs the same `stepMatch` on
 * them: no prediction, no rollback, so what it shows is final. It plays a
 * few frames behind the host to absorb the network's jitter, and catches up
 * silently when it falls far behind (it arrived mid-match, or its tab was
 * hidden). Nothing it does reaches the players.
 */

/** Frames kept in hand before playing, against jitter (~100 ms). */
const BUFFER = 6;
/** Further behind than this: jump ahead without effects or sounds. */
const CATCH_UP = 120;
/** After the KO, as long as the players' own end of match. */
const END_DELAY = 150;
/** Out of frames for this long: say we are waiting. */
const STALL_NOTICE = 30;

export type LobbyWhat = 'select' | 'stage' | 'results' | 'none';

/** The spectator's link to the host's room. */
export class SpectatorSession {
    inbox: NetMsg[] = [];
    ended = false;
    /** What the players are doing between matches, as last heard. */
    lobby: LobbyWhat = 'none';
    /** The last match seen to its end: its winner's name, for the waiting screen. */
    lastResult = '';

    constructor(readonly app: App, readonly link: Link, readonly code: string) {
        link.onMessage((m) => {
            if (m.type === 'lobby') this.lobby = m.what;
            this.inbox.push(m);
            app.nudge();
        });
        link.onClose((reason) => {
            if (reason === 'local' || this.ended) return;
            this.ended = true;
            play('uiBack');
            app.go(new NetNoticeScene(app, 'DIFFUSION TERMINÉE', reason === 'left' ? 'LES JOUEURS ONT QUITTÉ LE SALON' : NET_ERROR_TEXT.peerGone));
        });
    }

    take(): NetMsg[] {
        const q = this.inbox;
        this.inbox = [];
        return q;
    }

    putBack(rest: NetMsg[]): void {
        this.inbox = [...rest, ...this.inbox];
    }

    quit(): void {
        this.ended = true;
        this.link.close();
        this.app.go(new MainMenuScene(this.app));
    }

    /** The setup of a `start`, or null when this build lacks a fighter (another version). */
    setupOf(msg: Extract<NetMsg, { type: 'start' }>): Setup | null {
        const known = (id: string) => ROSTER.some((c) => c.id === id);
        if (!known(msg.p1) || !known(msg.p2)) {
            this.ended = true;
            this.link.close();
            this.app.go(new NetNoticeScene(this.app, 'DIFFUSION INTERROMPUE', NET_ERROR_TEXT.version));
            return null;
        }
        const stage = STAGES.some((s) => s.id === msg.stage) ? msg.stage : STAGES[0].id;
        return { mode: 'versus', p1: msg.p1, p2: msg.p2, stage, cpuLevel: 0 };
    }
}

/** "Stop watching?" box, Escape on every spectator screen. */
class LeaveBox {
    open = false;
    list = new OptionList(['NON, REGARDER', 'OUI, QUITTER']);

    /** Handles the menu; true when the spectator chose to leave. */
    handle(menu: MenuInput[]): boolean {
        if (!this.open) {
            if (menu.some((m) => m.action === 'start' || m.action === 'back')) { this.open = true; this.list.index = 0; play('uiConfirm'); }
            return false;
        }
        const r = this.list.handle(menu);
        if (r === 'back') this.open = false;
        if (r === 'confirm') {
            if (this.list.index === 1) return true;
            this.open = false;
        }
        return false;
    }

    draw(ctx: CanvasRenderingContext2D, t: number): void {
        if (!this.open) return;
        ctx.fillStyle = 'rgba(8,4,16,0.7)';
        ctx.fillRect(0, 0, 640, 360);
        panel(ctx, 170, 120, 300, 110, COLORS.red);
        drawText(ctx, 'ARRÊTER DE REGARDER ?', 320, 134, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, scale: 2, align: 'center' });
        menuItems(ctx, this.list.items, this.list.index, 206, 170, t);
    }
}

/** "SPECTATEUR" badge and ping, top right. */
function drawBadge(ctx: CanvasRenderingContext2D, session: SpectatorSession): void {
    const rtt = session.link.rtt;
    drawText(ctx, `SPECTATEUR · SALON ${session.code}${rtt ? ` · PING ${rtt} MS` : ''}`, 632, 6, { color: COLORS.blue, outline: COLORS.ink, align: 'right' });
}

const LOBBY_TEXT: Record<LobbyWhat, string> = {
    none: 'EN ATTENTE DES JOUEURS',
    select: 'LES JOUEURS CHOISISSENT LEURS PERSONNAGES',
    stage: 'L\'HÔTE CHOISIT L\'ARÈNE',
    results: 'LES JOUEURS DÉCIDENT DE LA SUITE'
};

// ——— Between matches ———

export class SpectateWaitScene implements Scene {
    readonly runsHidden = true;
    private t = 0;
    private leaving = false;
    private leave = new LeaveBox();

    constructor(private session: SpectatorSession) {}

    enter(): void { startMusic('select'); }

    tick(menu: MenuInput[]): void {
        this.t++;
        if (this.leaving || this.session.ended) return;
        const inbox = this.session.take();
        for (let n = 0; n < inbox.length; n++) {
            const msg = inbox[n];
            if (msg.type !== 'start') continue;
            this.session.putBack(inbox.slice(n + 1));
            this.leaving = true;
            const setup = this.session.setupOf(msg);
            if (setup) this.session.app.go(new SpectateVersusScene(this.session, setup, msg.seed ?? 0));
            return;
        }
        if (this.leave.handle(menu)) { this.leaving = true; this.session.quit(); }
    }

    draw(ctx: CanvasRenderingContext2D): void {
        menuBackdrop(ctx, this.t, STAGES[0].id, 'rgba(10,4,24,0.8)');
        title(ctx, 'MODE SPECTATEUR', 16);
        drawBadge(ctx, this.session);
        if (this.session.lastResult) {
            panel(ctx, 120, 70, 400, 50, COLORS.gold);
            drawText(ctx, 'DERNIER COMBAT', 320, 80, { color: COLORS.dim, outline: COLORS.ink, align: 'center' });
            drawText(ctx, this.session.lastResult, 320, 96, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, scale: 2, align: 'center' });
        }
        panel(ctx, 70, 150, 500, 70, COLORS.dim);
        const dots = '.'.repeat(1 + ((this.t >> 4) % 3));
        drawText(ctx, `${LOBBY_TEXT[this.session.lobby]}${dots}`, 320, 168, { color: '#fff', outline: COLORS.ink, align: 'center' });
        drawText(ctx, 'LE PROCHAIN COMBAT S\'AFFICHERA ICI EN DIRECT.', 320, 190, { color: '#cfc4dc', align: 'center' });
        hint(ctx, 'ÉCHAP : ARRÊTER DE REGARDER');
        this.leave.draw(ctx, this.t);
    }
}

class SpectateVersusScene extends VersusScene {
    readonly runsHidden = true;
    private started = false;

    constructor(private session: SpectatorSession, private online: Setup, private seed: number) {
        super(session.app, online);
    }

    tick(): void {
        this.t++;
        if (this.started || this.session.ended) return;
        // Arrived mid-match: no need to wait for the splash to end.
        const behind = this.session.inbox.some((m) => m.type === 'watch' && m.m === this.seed && m.start > 0);
        if (this.t > 170 || (behind && this.t > 60)) {
            this.started = true;
            this.session.app.go(new SpectateFightScene(this.session, this.online, this.seed));
        }
    }

    draw(ctx: CanvasRenderingContext2D): void {
        super.draw(ctx);
        drawText(ctx, 'EN DIRECT · SPECTATEUR', 320, 20, { color: '#fff', outline: COLORS.ink, align: 'center' });
    }
}

// ——— The fight, replayed ———

export class SpectateFightScene implements Scene {
    readonly runsHidden = true;
    private state: MatchState;
    private view: FightView;
    /** Both players' inputs, packed, for frames 0 .. inputs.length - 1. */
    private inputs: number[] = [];
    private frame = 0;
    private playing = false;
    private starved = 0;
    private t = 0;
    private endT = 0;
    private done = false;
    /** The next match's `start` already arrived: leave its messages queued. */
    private nextQueued = false;
    private leave = new LeaveBox();

    constructor(private session: SpectatorSession, private setup: Setup, private seed: number) {
        this.state = createMatch(setup.p1, setup.p2);
        const stage = STAGES.find((s) => s.id === setup.stage) ?? STAGES[0];
        this.view = new FightView(this.state, stage, { names: ['J1', 'J2'] });
        this.exposeDebug();
    }

    enter(): void { startMusic(this.setup.stage); }

    /** Frames received but not played yet. */
    get backlog(): number { return this.inputs.length - this.frame; }

    tick(menu: MenuInput[]): void {
        this.t++;
        endInputTick();
        if (this.done || this.session.ended) return;
        this.receive();
        if (this.leave.handle(menu)) { this.done = true; this.session.quit(); return; }

        // Far behind: jump ahead without effects, then play normally.
        if (this.backlog > CATCH_UP) {
            while (this.backlog > BUFFER) this.step();
            this.playing = true;
        }
        if (!this.playing && (this.backlog >= BUFFER || this.state.phase === 'matchEnd')) this.playing = true;
        if (this.playing && this.backlog === 0 && this.state.phase !== 'matchEnd') this.playing = false;
        this.starved = this.playing || this.state.phase === 'matchEnd' ? 0 : this.starved + 1;

        if (this.playing) {
            // Getting behind (a slow tick, a burst after a hiccup): two frames a tick.
            const steps = Math.min(this.backlog, this.backlog > BUFFER * 3 ? 2 : 1);
            const out: GameEvent[] = [];
            for (let i = 0; i < steps; i++) out.push(...this.step());
            if (out.length) this.show(out);
            this.view.update();
        }

        if (this.state.phase === 'matchEnd') {
            this.endT++;
            if (this.endT > END_DELAY) this.finish();
        }
    }

    private step(): GameEvent[] {
        const ev = stepMatch(this.state, unpackPair(this.inputs[this.frame]));
        this.frame++;
        return ev;
    }

    private receive(): void {
        if (this.nextQueued) return;
        const inbox = this.session.take();
        for (let n = 0; n < inbox.length; n++) {
            const msg = inbox[n];
            if (msg.type === 'watch' && msg.m === this.seed) {
                // Reliable and ordered: each packet starts where the last one ended.
                const skip = this.inputs.length - msg.start;
                if (skip < 0) { console.warn(`[spectateur] trou dans les frames (${this.inputs.length} → ${msg.start})`); continue; }
                for (let i = skip; i < msg.bits.length; i++) this.inputs.push(msg.bits[i]);
            } else if (msg.type === 'start') {
                // The players are already on their next match: finish this one first.
                this.nextQueued = true;
                this.session.putBack(inbox.slice(n));
                return;
            }
        }
    }

    private show(events: GameEvent[]): void {
        this.view.handle(events);
        const chars = this.state.fighters.map((f) => f.char);
        for (const e of events) {
            if (e.type === 'round' && e.round === 1) playStartVoices(chars, voiceChannel);
            if (e.type === 'roundEnd') playRoundEndVoices(chars, e.winner, [0, 1], voiceChannel);
            if (e.type === 'matchEnd') play('win');
        }
    }

    private finish(): void {
        this.done = true;
        const w = this.state.winner;
        this.session.lastResult = w === 2 ? 'MATCH NUL' : `${getChar(w === 1 ? this.setup.p2 : this.setup.p1).name.toUpperCase()} (J${w + 1}) GAGNE`;
        this.session.app.go(new SpectateWaitScene(this.session));
    }

    draw(ctx: CanvasRenderingContext2D): void {
        this.view.draw(ctx);
        drawText(ctx, 'EN DIRECT · SPECTATEUR', 320, 348, { color: COLORS.blue, outline: COLORS.ink, align: 'center' });
        if (this.starved > STALL_NOTICE) {
            const dots = '.'.repeat(1 + ((this.t >> 4) % 3));
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, 150, 640, 24);
            drawText(ctx, `EN ATTENTE DU DIRECT${dots}`, 320, 156, { color: COLORS.gold, outline: COLORS.ink, scale: 2, align: 'center' });
        }
        this.leave.draw(ctx, this.t);
    }

    /** Read-only hook for the end-to-end test (dev server or ?netdebug). */
    private exposeDebug(): void {
        if (!import.meta.env.DEV && !new URLSearchParams(location.search).has('netdebug')) return;
        const view = { seed: this.seed, frame: () => this.frame, received: () => this.inputs.length, phase: () => this.state.phase,
            /** State after `n` received frames, to compare with the players' own replay. */
            replay: (n: number) => {
                const st = createMatch(this.setup.p1, this.setup.p2);
                const k = Math.min(n, this.inputs.length);
                for (let f = 0; f < k; f++) stepMatch(st, unpackPair(this.inputs[f]));
                return { frames: k, health: st.fighters.map((f) => f.health), sum: checksum(st) };
            }
        };
        (window as unknown as { __opfgSpec: unknown }).__opfgSpec = view;
    }
}
