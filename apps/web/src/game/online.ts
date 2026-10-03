import { play } from '../audio/sound';
import { startMusic } from '../audio/music';
import { playVoice } from '../audio/voices';
import { ROSTER } from '../characters';
import { getChar } from '../engine/registry';
import { KEYS, keyLabel, type MenuInput } from '../input/devices';
import type { NetMsg } from '../net/protocol';
import { SpectatorRelay } from '../net/spectator';
import type { RollbackSession } from '../net/rollback';
import { CODE_ALPHABET, CODE_LENGTH, codeFromText } from '../net/peer-config';
import { NET_ERROR_TEXT, NetError, hostRoom, joinRoom, type Link, type Room } from '../net/transport';
import { drawText, textWidth } from '../render/font';
import { artOf } from '../render/sprites';
import { STAGES, stageImage } from '../render/stage';
import { settings, updateSettings } from '../settings';
import { OptionList, type App, type Scene } from './app';
import { OnlineFightScene } from './onlineFight';
import { SpectateWaitScene, SpectatorSession } from './spectate';
import { MainMenuScene, SelectScene, VersusScene, gridStep, gridTop, sceneHooks, type Setup } from './scenes';
import { COLORS, hint, menuBackdrop, menuItems, panel, roundPips, title } from './ui';

/**
 * Online versus: the lobby around a match between two browsers.
 *
 *   VERSUS J1 CONTRE J2 → MÊME CLAVIER | CRÉER UN SALON | REJOINDRE UN SALON
 *   host: salon (code + link) ─┐
 *   guest: code / ?salon=CODE ─┴→ synced select → stage (host picks) → VS
 *   → fight (OnlineFightScene, rollback) → results (rematch / select / quit)
 *
 * The host is always J1 (left), the guest J2. Each player uses the J1 keys
 * or the first gamepad. The host is authoritative for the stage and for the
 * `start` message that fixes both fighters.
 *
 * One spectator may join the host's room (?spectateur=CODE, game/spectate.ts):
 * the host tells it where the players are and forwards each match's
 * confirmed inputs.
 */

const ONLINE_BACKDROP = 'shandora';
const stageBackdrop = () => (STAGES.some((s) => s.id === ONLINE_BACKDROP) ? ONLINE_BACKDROP : STAGES[0].id);

// ——— Session ———

/**
 * One connected pair of browsers. Messages are queued in `inbox` and each
 * scene drains them in its tick, so nothing is lost while scenes fade into
 * each other. The room lives as long as its host: when the guest leaves, at
 * any point, the host goes back to the room's waiting screen, same code,
 * for the next guest. When the host leaves, the guest gets a notice.
 */
export class OnlineSession {
    inbox: NetMsg[] = [];
    ended = false;
    /** Host side: the room's spectator, if one is watching. */
    private spec: Link | null = null;
    /** Host side: what the spectator is told (net/spectator.ts). */
    private relay = new SpectatorRelay();
    private unwatch: () => void = () => {};

    /** `room`: the host's room, which outlives this session (next guest, spectator). */
    constructor(readonly app: App, readonly link: Link, readonly code: string, private room?: Room) {
        if (room) this.unwatch = room.onSpectator((l) => {
            if (this.ended) return;
            this.spec = l;
            l.onClose(() => { if (this.spec === l) { this.spec = null; this.relay.detach(); } });
            this.relay.attach((m) => l.send(m));
        });
        link.onMessage((m) => {
            this.inbox.push(m);
            // Hidden tab: network messages keep the game ticking (see App.nudge).
            app.nudge();
        });
        link.onClose((reason) => {
            if (reason === 'local' || this.ended) return;
            this.end();
            play('uiBack');
            const text = NET_ERROR_TEXT[reason === 'left' ? 'left' : 'peerGone'];
            // Host: the room stays open, back to waiting for a guest.
            if (room?.open) app.go(new HostScene(app, room, text));
            else app.go(new NetNoticeScene(app, 'CONNEXION PERDUE', text, () => new VersusMenuScene(app, new MainMenuScene(app))));
        });
    }

    /** 0: host, left fighter. 1: guest, right fighter. */
    get side(): 0 | 1 { return this.link.side; }
    get isHost(): boolean { return this.link.side === 0; }

    /** All queued messages, oldest first. */
    take(): NetMsg[] {
        const q = this.inbox;
        this.inbox = [];
        return q;
    }

    /** Messages a scene took but leaves for the next one (it is switching). */
    putBack(rest: NetMsg[]): void {
        this.inbox = [...rest, ...this.inbox];
    }

    send(msg: NetMsg): void { this.link.send(msg); }

    /** A spectator is watching this room (host side). */
    get watched(): boolean { return !!this.spec?.open; }

    /** Host: the players are between matches, on this screen. */
    watchLobby(what: 'select' | 'stage' | 'results'): void {
        if (this.isHost) this.relay.lobby(what);
    }

    /** Host: a match starts (its `start` was just sent to the guest). */
    watchStart(setup: Setup, seed: number): void {
        if (this.isHost) this.relay.start({ p1: setup.p1, p2: setup.p2, stage: setup.stage, seed });
    }

    /** Host, every fight tick: the frames confirmed since the last call go to the spectator. */
    watchFrames(seed: number, rb: RollbackSession): void {
        this.relay.frames(seed, rb.confirmedFrame, (from, to) => rb.confirmedInputs(from, to));
    }

    /** This session is over; the host's room and its spectator stay. */
    private end(): void {
        this.ended = true;
        this.unwatch();
        this.relay.lobby('waiting');
        this.relay.detach();
        this.spec = null;
    }

    /** Closes everything: the guest's link, and the room when hosting. */
    private closeAll(): void {
        this.end();
        if (this.room) this.room.close();
        else this.link.close();
    }

    /** Ends the session on a notice (something the two games disagree on). */
    fail(message: string): void {
        if (this.ended) return;
        this.closeAll();
        this.app.go(new NetNoticeScene(this.app, 'PARTIE INTERROMPUE', message));
    }

    /**
     * Checks a `start` from the host names fighters this build has; else
     * the two games differ and the session ends. Returns the setup.
     */
    startSetup(msg: Extract<NetMsg, { type: 'start' }>): Setup | null {
        const known = (id: string) => ROSTER.some((c) => c.id === id);
        if (!known(msg.p1) || !known(msg.p2)) { this.fail(NET_ERROR_TEXT.version); return null; }
        const stage = STAGES.some((s) => s.id === msg.stage) ? msg.stage : STAGES[0].id;
        return setupFor(msg.p1, msg.p2, stage);
    }

    /** Leave on purpose: tell the other side, back to the main menu. */
    quit(): void {
        this.closeAll();
        this.app.go(new MainMenuScene(this.app));
    }
}

/** Hand-off to the rollback fight; at the end, the synced results screen. */
export function startOnlineFight(session: OnlineSession, setup: Setup, seed: number): void {
    session.app.go(new OnlineFightScene(session, setup, seed, (winner) => {
        if (!session.ended) session.app.go(new OnlineResultsScene(session, setup, winner, seed));
    }));
}

function setupFor(p1: string, p2: string, stage: string): Setup {
    return { mode: 'versus', p1, p2, stage, cpuLevel: 0 };
}

function newSeed(): number {
    return (Math.random() * 0x7fffffff) | 0;
}

/** Small ping readout, top right. */
function drawPing(ctx: CanvasRenderingContext2D, session: OnlineSession): void {
    const rtt = session.link.rtt;
    const color = rtt === 0 ? COLORS.dim : rtt < 80 ? '#9dff7a' : rtt < 160 ? COLORS.gold : COLORS.red;
    drawText(ctx, rtt ? `PING ${rtt} MS` : 'PING …', 632, 6, { color, outline: COLORS.ink, align: 'right' });
    if (session.watched) drawText(ctx, '1 SPECTATEUR', 632, 18, { color: COLORS.blue, outline: COLORS.ink, align: 'right' });
}

/** "Really leave?" box shared by the lobby screens. */
class QuitConfirm {
    open = false;
    list = new OptionList(['NON, RESTER', 'OUI, QUITTER']);

    /** Returns true when the player chose to leave. */
    handle(menu: MenuInput[]): boolean {
        const r = this.list.handle(menu);
        if (r === 'back') this.open = false;
        if (r === 'confirm') {
            if (this.list.index === 1) return true;
            this.open = false;
        }
        return false;
    }

    show(): void {
        this.open = true;
        this.list.index = 0;
        play('uiConfirm');
    }

    draw(ctx: CanvasRenderingContext2D, t: number, question = 'QUITTER LE SALON ?'): void {
        if (!this.open) return;
        ctx.fillStyle = 'rgba(8,4,16,0.7)';
        ctx.fillRect(0, 0, 640, 360);
        panel(ctx, 170, 120, 300, 110, COLORS.red);
        drawText(ctx, question, 320, 134, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, scale: 2, align: 'center' });
        menuItems(ctx, this.list.items, this.list.index, 206, 170, t);
    }
}

// ——— Versus submenu ———

export class VersusMenuScene implements Scene {
    private t = 0;
    private list = new OptionList(['MÊME CLAVIER', 'MANCHES À GAGNER', 'CRÉER UN SALON EN LIGNE', 'REJOINDRE UN SALON', 'REGARDER UN SALON']);
    private blurbs = [
        'Deux joueurs sur le même clavier ou deux manettes.',
        'Manches à remporter sur le même clavier (en ligne : toujours 2).',
        'Obtenez un lien à envoyer à votre adversaire, puis attendez-le.',
        'Tapez ou collez le code reçu de votre adversaire.',
        'Suivez en direct le combat d\'un salon, en spectateur.'
    ];

    constructor(private app: App, private back: Scene) {}

    tick(menu: MenuInput[]): void {
        this.t++;
        // Rounds: ← → set them (kept for next time), confirm cycles 1-2-3.
        if (this.list.index === 1) {
            for (const m of menu) {
                if (m.action !== 'left' && m.action !== 'right') continue;
                const v = Math.max(1, Math.min(3, settings.versusRounds + (m.action === 'left' ? -1 : 1)));
                if (v !== settings.versusRounds) { updateSettings({ versusRounds: v }); play('uiMove'); }
            }
        }
        const r = this.list.handle(menu);
        if (r === 'back') { this.app.go(this.back); return; }
        if (r !== 'confirm') return;
        if (this.list.index === 0) this.app.go(new SelectScene(this.app, 'versus'));
        else if (this.list.index === 1) updateSettings({ versusRounds: (settings.versusRounds % 3) + 1 });
        else if (this.list.index === 2) this.app.go(new HostScene(this.app));
        else if (this.list.index === 3) this.app.go(new JoinScene(this.app));
        else this.app.go(new JoinScene(this.app, '', false, true));
    }

    draw(ctx: CanvasRenderingContext2D): void {
        menuBackdrop(ctx, this.t, 'arlong-park');
        drawText(ctx, 'VERSUS', 44, 34, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, scale: 4 });
        drawText(ctx, 'J1 CONTRE J2', 44, 70, { color: COLORS.cream, outline: COLORS.ink, scale: 2 });
        panel(ctx, 30, 96, 330, 156);
        drawText(ctx, 'EN LIGNE', 52, 166, { color: COLORS.blue, outline: COLORS.ink });
        menuItems(ctx, this.list.items.slice(0, 2), this.list.index < 2 ? this.list.index : -1, 52, 114, this.t, 22, 2, 316);
        this.drawRounds(ctx, 136, this.list.index === 1);
        menuItems(ctx, this.list.items.slice(2), this.list.index - 2, 52, 182, this.t, 22, 2, 316);
        panel(ctx, 30, 256, 580, 34, COLORS.dim);
        drawText(ctx, this.blurbs[this.list.index], 44, 268, { color: '#e8e0f0' });
        const c = ROSTER[(this.list.index + 3) % ROSTER.length];
        const art = artOf(c.id, 'art');
        if (art) {
            const s = Math.min(2, 220 / art.height);
            ctx.drawImage(art, 610 - art.width * s, 250 - art.height * s, art.width * s, art.height * s);
        }
        const k = KEYS[0];
        const adjust = this.list.index === 1 ? ` · ${keyLabel(k.left[0])}${keyLabel(k.right[0])} / ← → : RÉGLER` : '';
        hint(ctx, `${keyLabel(k.up[0])}${keyLabel(k.down[0])} / ↑↓ : CHOISIR${adjust} · ${keyLabel(k.light[0])} / ENTRÉE : VALIDER · ${keyLabel(k.heavy[0])} / ÉCHAP : RETOUR`);
    }

    /** The rounds value at the right of its row: pips, the number, and arrows when selected. */
    private drawRounds(ctx: CanvasRenderingContext2D, y: number, sel: boolean): void {
        const v = settings.versusRounds;
        const right = 346;
        const bob = sel ? Math.round(Math.sin(this.t / 8)) : 0;
        if (sel) {
            drawText(ctx, '→', right + bob, y + 4, { color: v < 3 ? COLORS.gold : COLORS.dim, outline: COLORS.ink, align: 'right' });
            drawText(ctx, '←', right - 68 - bob, y + 4, { color: v > 1 ? COLORS.gold : COLORS.dim, outline: COLORS.ink, align: 'right' });
        }
        drawText(ctx, String(v), right - 14, y, { color: sel ? '#fff' : '#bdb2cc', gradient: sel ? COLORS.gold : undefined, outline: COLORS.ink, scale: 2, align: 'right' });
        roundPips(ctx, v, right - 30, y + 4);
    }
}

sceneHooks.versusMenu = (app, back) => new VersusMenuScene(app, back);

// ——— Notice (errors, disconnects) ———

export class NetNoticeScene implements Scene {
    private t = 0;
    constructor(private app: App, private heading: string, private message: string, private next?: () => Scene) {}

    tick(menu: MenuInput[]): void {
        this.t++;
        if (this.t > 20 && menu.some((m) => m.action === 'confirm' || m.action === 'back' || m.action === 'start')) {
            play('uiBack');
            this.app.go(this.next ? this.next() : new MainMenuScene(this.app));
        }
    }

    draw(ctx: CanvasRenderingContext2D): void {
        menuBackdrop(ctx, this.t, stageBackdrop(), 'rgba(20,4,12,0.82)');
        title(ctx, this.heading, 90);
        const w = Math.max(360, textWidth(this.message, 2) + 40);
        panel(ctx, 320 - w / 2, 140, w, 60, COLORS.red);
        drawText(ctx, this.message, 320, 164, { color: '#fff', outline: COLORS.ink, scale: 2, align: 'center' });
        hint(ctx, 'ENTRÉE / ÉCHAP : RETOUR AU MENU');
    }
}

// ——— Host: create a room ———

async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Older browsers or no permission: the textarea trick.
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch {
            return false;
        }
    }
}

export class HostScene implements Scene {
    private t = 0;
    private room: Room | null = null;
    private error = '';
    private copied: 'no' | 'yes' | 'failed' = 'no';
    private copiedAt = 0;
    private refused = '';
    private refusedAt = 0;
    private gone = false;
    private watcher: Link | null = null;
    private unsub: (() => void)[] = [];

    /**
     * `room`: back to an open room after its guest left (`notice` says why);
     * else a new room is created.
     */
    constructor(private app: App, private reopen?: Room, private notice = '') {}

    enter(): void {
        startMusic('select');
        if (this.reopen) { this.listen(this.reopen); return; }
        hostRoom().then((room) => {
            if (this.gone) { room.close(); return; }
            void this.copy(room);
            this.listen(room);
        }, (err: unknown) => {
            if (this.gone) return;
            this.error = err instanceof NetError ? NET_ERROR_TEXT[err.kind] : NET_ERROR_TEXT.broker;
            console.warn('Création du salon impossible :', err);
        });
    }

    private listen(room: Room): void {
        this.room = room;
        room.onRefused((kind) => {
            if (this.gone) return;
            this.refused = kind === 'full' ? 'UN SECOND JOUEUR A ÉTÉ REFUSÉ'
                : kind === 'specFull' ? 'UN SECOND SPECTATEUR A ÉTÉ REFUSÉ' : 'UN JOUEUR A ÉTÉ REFUSÉ : VERSION DIFFÉRENTE';
            this.refusedAt = this.t;
        });
        this.unsub.push(room.onSpectator((l) => { this.watcher = l; }));
        this.unsub.push(room.onError((err) => {
            if (!this.gone) this.error = err instanceof NetError ? NET_ERROR_TEXT[err.kind] : 'LE SALON A ÉTÉ FERMÉ';
        }));
        this.unsub.push(room.onGuest((link) => {
            if (this.gone) return;
            this.leave();
            play('uiSelect');
            this.app.go(new OnlineSelectScene(new OnlineSession(this.app, link, room.code, room)));
        }));
    }

    private leave(): void {
        this.gone = true;
        for (const u of this.unsub) u();
        this.unsub = [];
    }

    private copiedWhat: 'invite' | 'watch' = 'invite';

    private async copy(room = this.room, what: 'invite' | 'watch' = 'invite'): Promise<void> {
        if (!room) return;
        this.copiedWhat = what;
        this.notice = '';
        this.copied = (await copyText(what === 'watch' ? room.watchUrl : room.url)) ? 'yes' : 'failed';
        this.copiedAt = this.t;
    }

    tick(menu: MenuInput[]): void {
        this.t++;
        if (this.gone) return;
        for (const m of menu) {
            if (m.action === 'back') {
                play('uiBack');
                this.leave();
                this.room?.close();
                this.app.go(new VersusMenuScene(this.app, new MainMenuScene(this.app)));
                return;
            }
            if (m.action === 'confirm' && this.error) {
                play('uiConfirm');
                this.leave();
                this.app.go(new HostScene(this.app));
                return;
            }
            if ((m.action === 'confirm' || m.action === 'right') && this.room) { play('uiConfirm'); void this.copy(); }
            if (m.action === 'left' && this.room) { play('uiConfirm'); void this.copy(this.room, 'watch'); }
        }
    }

    draw(ctx: CanvasRenderingContext2D): void {
        menuBackdrop(ctx, this.t, stageBackdrop(), 'rgba(10,4,24,0.8)');
        title(ctx, 'SALON EN LIGNE', 16);
        if (this.error) {
            panel(ctx, 70, 110, 500, 90, COLORS.red);
            drawText(ctx, 'IMPOSSIBLE DE CRÉER LE SALON', 320, 126, { color: COLORS.red, outline: COLORS.ink, scale: 2, align: 'center' });
            drawText(ctx, this.error, 320, 160, { color: '#fff', outline: COLORS.ink, align: 'center' });
            drawText(ctx, 'VÉRIFIEZ VOTRE CONNEXION À INTERNET.', 320, 176, { color: '#cfc4dc', align: 'center' });
            hint(ctx, 'ENTRÉE : RÉESSAYER · ÉCHAP : RETOUR');
            return;
        }
        if (!this.room) {
            const dots = '.'.repeat(1 + ((this.t >> 4) % 3));
            drawText(ctx, `CRÉATION DU SALON${dots}`, 320, 160, { color: COLORS.gold, outline: COLORS.ink, scale: 2, align: 'center' });
            hint(ctx, 'ÉCHAP : ANNULER');
            return;
        }
        panel(ctx, 60, 58, 520, 118);
        drawText(ctx, 'CODE DU SALON', 320, 70, { color: COLORS.dim, outline: COLORS.ink, align: 'center' });
        const code = this.room.code;
        drawText(ctx, `${code.slice(0, 3)} ${code.slice(3)}`, 320, 88, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, shadow: '#000', scale: 5, align: 'center' });
        drawText(ctx, 'LIEN D\'INVITATION', 320, 140, { color: COLORS.dim, outline: COLORS.ink, align: 'center' });
        drawText(ctx, this.room.url, 320, 154, { color: COLORS.blue, outline: COLORS.ink, align: 'center' });

        const flash = this.t - this.copiedAt < 150;
        if (this.copied === 'yes' && flash) drawText(ctx, this.copiedWhat === 'watch' ? 'LIEN SPECTATEUR COPIÉ !' : 'LIEN COPIÉ DANS LE PRESSE-PAPIERS !', 320, 188, { color: '#9dff7a', outline: COLORS.ink, align: 'center' });
        if (this.copied === 'failed' && flash) drawText(ctx, 'COPIE IMPOSSIBLE : RECOPIEZ LE LIEN OU LE CODE.', 320, 188, { color: COLORS.red, outline: COLORS.ink, align: 'center' });
        if (this.notice) drawText(ctx, `${this.notice} · LE SALON RESTE OUVERT`, 320, 188, { color: COLORS.gold, outline: COLORS.ink, align: 'center' });
        if (this.watcher?.open) drawText(ctx, '1 SPECTATEUR', 632, 6, { color: COLORS.blue, outline: COLORS.ink, align: 'right' });

        panel(ctx, 120, 210, 400, 84, COLORS.dim);
        const dots = '.'.repeat(1 + ((this.t >> 4) % 3));
        drawText(ctx, `EN ATTENTE DE L'ADVERSAIRE${dots}`, 140, 224, { color: '#fff', outline: COLORS.ink, scale: 2 });
        drawText(ctx, 'ENVOYEZ-LUI LE LIEN : IL ARRIVERA ICI', 320, 252, { color: '#cfc4dc', align: 'center' });
        drawText(ctx, 'DIRECTEMENT, OU IL PEUT TAPER LE CODE.', 320, 266, { color: '#cfc4dc', align: 'center' });
        drawText(ctx, `SPECTATEUR (1 MAX.) : ${this.room.watchUrl}`, 320, 300, { color: COLORS.dim, outline: COLORS.ink, align: 'center' });
        if (this.refused && this.t - this.refusedAt < 300) drawText(ctx, this.refused, 320, 314, { color: COLORS.gold, outline: COLORS.ink, align: 'center' });
        else if (__PREVIEW_BUILD__) {
            // Preview URLs sit behind Vercel Authentication: the friend would hit a login page.
            drawText(ctx, 'VERSION D\'APERÇU : CE LIEN DEMANDE UN COMPTE VERCEL.', 320, 314, { color: COLORS.gold, outline: COLORS.ink, align: 'center' });
            if (__PUBLIC_URL__) drawText(ctx, `POUR JOUER, CRÉEZ LE SALON SUR ${__PUBLIC_URL__.replace(/^https?:\/\//, '')}`, 320, 326, { color: COLORS.gold, outline: COLORS.ink, align: 'center' });
        }
        hint(ctx, `ENTRÉE / ${keyLabel(KEYS[0].light[0])} : COPIER LE LIEN · ${keyLabel(KEYS[0].left[0])} / ← : LIEN SPECTATEUR · ÉCHAP : FERMER LE SALON`);
    }
}

// ——— Guest: join a room ———

export class JoinScene implements Scene {
    private t = 0;
    private code = '';
    private state: 'typing' | 'connecting' | 'error' = 'typing';
    private error = '';
    private abort: AbortController | null = null;
    private active = false;

    /** `auto`: came from an invite link, connect right away. `spectate`: join as the room's spectator. */
    constructor(private app: App, prefill = '', private auto = false, private spectate = false) {
        this.code = [...prefill.toUpperCase()].filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, CODE_LENGTH);
    }

    // Letters are typed straight from keyboard events: the menu mapping
    // would read J and K (valid code letters) as confirm and back.
    private onKey = (e: KeyboardEvent) => {
        if (!this.active) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.code === 'Escape') { this.escape(); return; }
        if (this.state === 'error') {
            if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') { play('uiConfirm'); this.state = 'typing'; }
            return;
        }
        if (this.state !== 'typing') return;
        if (e.code === 'Enter' || e.code === 'NumpadEnter') { this.connect(); return; }
        if (e.code === 'Backspace' || e.code === 'Delete') { this.code = this.code.slice(0, -1); play('uiBack'); e.preventDefault(); return; }
        let ch = e.key.length === 1 ? e.key.toUpperCase() : '';
        // AZERTY: the digit row gives é, ', ( … without Shift; take the
        // digit printed on the key (and the numeric keypad's) instead.
        const digit = e.code.match(/^(?:Digit|Numpad)(\d)$/);
        if (!CODE_ALPHABET.includes(ch) && digit) ch = digit[1];
        if (ch && CODE_ALPHABET.includes(ch) && this.code.length < CODE_LENGTH) { this.code += ch; play('uiMove'); }
    };

    private onPaste = (e: ClipboardEvent) => {
        if (!this.active || this.state !== 'typing') return;
        const text = e.clipboardData?.getData('text') ?? '';
        this.pasted(text);
        e.preventDefault();
    };

    private pasted(text: string): void {
        const code = codeFromText(text.trim());
        if (code) { this.code = code; play('uiConfirm'); }
        else play('uiBack');
    }

    enter(): void {
        startMusic('select');
        this.active = true;
        window.addEventListener('keydown', this.onKey);
        window.addEventListener('paste', this.onPaste);
        if (this.auto && this.code.length === CODE_LENGTH) this.connect();
    }

    private leave(to: Scene): void {
        this.active = false;
        window.removeEventListener('keydown', this.onKey);
        window.removeEventListener('paste', this.onPaste);
        this.app.go(to);
    }

    private escape(): void {
        play('uiBack');
        if (this.state === 'connecting') { this.abort?.abort(); this.state = 'typing'; return; }
        this.leave(new VersusMenuScene(this.app, new MainMenuScene(this.app)));
    }

    private connect(): void {
        if (this.code.length !== CODE_LENGTH) { play('uiBack'); return; }
        play('uiConfirm');
        this.state = 'connecting';
        const abort = new AbortController();
        this.abort = abort;
        const code = this.code;
        joinRoom(code, abort.signal, this.spectate).then((link) => {
            if (abort.signal.aborted || !this.active) { link.close(); return; }
            play('uiSelect');
            if (this.spectate) this.leave(new SpectateWaitScene(new SpectatorSession(this.app, link, code)));
            else this.leave(new OnlineSelectScene(new OnlineSession(this.app, link, code)));
        }, (err: unknown) => {
            if (abort.signal.aborted || !this.active) return;
            console.warn('Connexion au salon impossible :', err);
            this.state = 'error';
            this.error = err instanceof NetError ? NET_ERROR_TEXT[err.kind] : 'CONNEXION IMPOSSIBLE';
            play('uiBack');
        });
    }

    tick(): void { this.t++; }

    draw(ctx: CanvasRenderingContext2D): void {
        menuBackdrop(ctx, this.t, stageBackdrop(), 'rgba(10,4,24,0.8)');
        title(ctx, this.spectate ? 'REGARDER UN SALON' : 'REJOINDRE UN SALON', 16);
        panel(ctx, 120, 70, 400, 120);
        drawText(ctx, 'CODE DU SALON', 320, 84, { color: COLORS.dim, outline: COLORS.ink, align: 'center' });
        // Six boxes, a gap after the third.
        const box = 44;
        const x0 = 320 - (CODE_LENGTH * (box + 6) + 14) / 2;
        for (let i = 0; i < CODE_LENGTH; i++) {
            const x = x0 + i * (box + 6) + (i >= 3 ? 14 : 0);
            const cur = this.state === 'typing' && i === this.code.length;
            ctx.fillStyle = '#12091c';
            ctx.fillRect(x, 104, box, 56);
            ctx.strokeStyle = cur && this.t % 40 < 26 ? COLORS.gold : '#3a2a4a';
            ctx.lineWidth = cur ? 2 : 1;
            ctx.strokeRect(x + 0.5, 104.5, box - 1, 55);
            ctx.lineWidth = 1;
            const ch = this.code[i];
            if (ch) drawText(ctx, ch, x + box / 2, 116, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, scale: 4, align: 'center' });
        }
        drawText(ctx, 'TAPEZ LE CODE, OU COLLEZ LE LIEN (CTRL+V).', 320, 172, { color: '#cfc4dc', align: 'center' });

        if (this.state === 'connecting') {
            const dots = '.'.repeat(1 + ((this.t >> 4) % 3));
            drawText(ctx, `CONNEXION${dots}`, 320, 220, { color: COLORS.gold, outline: COLORS.ink, scale: 2, align: 'center' });
            hint(ctx, 'ÉCHAP : ANNULER');
        } else if (this.state === 'error') {
            panel(ctx, 90, 206, 460, 60, COLORS.red);
            drawText(ctx, this.spectate ? 'IMPOSSIBLE DE REGARDER' : 'IMPOSSIBLE DE REJOINDRE', 320, 218, { color: COLORS.red, outline: COLORS.ink, scale: 2, align: 'center' });
            drawText(ctx, this.error, 320, 246, { color: '#fff', outline: COLORS.ink, align: 'center' });
            hint(ctx, 'ENTRÉE : MODIFIER LE CODE · ÉCHAP : RETOUR');
        } else {
            hint(ctx, `ENTRÉE : ${this.spectate ? 'REGARDER' : 'REJOINDRE'} · RETOUR : EFFACER · ÉCHAP : ANNULER`);
        }
    }
}

// ——— Synced character select ———

export class OnlineSelectScene extends SelectScene {
    readonly runsHidden = true;
    private quitBox = new QuitConfirm();
    private leaving = false;
    private waitHost = false;

    constructor(private session: OnlineSession, private prevSetup?: Setup) {
        super(session.app, 'versus', prevSetup);
    }

    /** Back from the arena: the host picks again, the guest stays locked. */
    relockAfterStage(): void {
        this.mine.locked = !this.session.isHost;
        this.theirs.locked = this.session.isHost;
    }

    /** Host side: the guest unlocked while we were already on the arena. */
    guestBackedOut(char: string): void {
        this.mine.locked = true;
        this.theirs.locked = false;
        const i = ROSTER.findIndex((c) => c.id === char);
        if (i >= 0) this.theirs.index = i;
    }

    private get mine() { return this.cursors[this.session.side]; }
    private get theirs() { return this.cursors[1 - this.session.side]; }

    enter(): void {
        super.enter();
        this.announce();
        this.session.watchLobby('select');
    }

    private announce(): void {
        this.session.send({ type: 'select', char: ROSTER[this.mine.index].id, ready: this.mine.locked });
    }

    private go(scene: Scene): void {
        this.leaving = true;
        this.session.app.go(scene);
    }

    tick(menu: MenuInput[]): void {
        this.t++;
        if (this.leaving || this.session.ended) return;
        const inbox = this.session.take();
        for (let n = 0; n < inbox.length; n++) {
            const msg = inbox[n];
            const rest = () => this.session.putBack(inbox.slice(n + 1));
            if (msg.type === 'select') {
                const i = ROSTER.findIndex((c) => c.id === msg.char);
                if (i >= 0) {
                    if (i !== this.theirs.index) play('uiMove');
                    if (msg.ready && !this.theirs.locked) { play('uiSelect'); playVoice(msg.char, 'select', 'select'); }
                    this.theirs.index = i;
                    this.theirs.locked = msg.ready;
                }
            } else if (msg.type === 'stage' && !this.session.isHost && this.mine.locked) {
                // The host moved on to the arena: follow. (If we unlocked in
                // the meantime, the host comes back when it hears so.)
                const p1 = ROSTER[this.cursors[0].index].id;
                const p2 = ROSTER[this.cursors[1].index].id;
                rest();
                this.go(new OnlineStageScene(this.session, p1, p2, msg.stage));
                return;
            } else if (msg.type === 'start' && !this.session.isHost) {
                rest();
                const setup = this.session.startSetup(msg);
                if (setup) this.go(new OnlineVersusScene(this.session, setup, msg.seed ?? 0));
                else this.leaving = true;
                return;
            }
        }

        if (this.quitBox.open) {
            if (this.quitBox.handle(menu)) { this.leaving = true; this.session.quit(); }
            return;
        }
        // One local player: every local key set drives our own cursor.
        const c = this.mine;
        let changed = false;
        for (const m of menu) {
            if (m.action === 'back') {
                if (c.locked) { c.locked = false; changed = true; play('uiBack'); }
                else { this.quitBox.show(); break; }
                continue;
            }
            if (m.action === 'start' && !c.locked) { this.quitBox.show(); break; }
            if (c.locked) continue;
            const n = ROSTER.length;
            const before = c.index;
            if (m.action === 'left') c.index = (c.index + n - 1) % n;
            if (m.action === 'right') c.index = (c.index + 1) % n;
            if (m.action === 'up' || m.action === 'down') c.index = gridStep(c.index, m.action === 'up' ? -1 : 1);
            if (c.index !== before) { play('uiMove'); changed = true; }
            if (m.action === 'confirm') { c.locked = true; changed = true; play('uiSelect'); playVoice(ROSTER[c.index].id, 'select', 'select'); }
        }
        if (changed) this.announce();

        this.waitHost = !this.session.isHost && this.mine.locked && this.theirs.locked;
        if (this.session.isHost && this.cursors.every((k) => k.locked)) {
            const p1 = ROSTER[this.cursors[0].index].id;
            const p2 = ROSTER[this.cursors[1].index].id;
            const stage = this.prevSetup?.stage ?? STAGES[Math.floor(Math.random() * STAGES.length)].id;
            this.session.send({ type: 'stage', stage });
            this.go(new OnlineStageScene(this.session, p1, p2, stage));
        }
    }

    draw(ctx: CanvasRenderingContext2D): void {
        super.draw(ctx);
        drawPing(ctx, this.session);
        if (this.waitHost) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, gridTop() - 26, 640, 20);
            drawText(ctx, 'L\'HÔTE VA CHOISIR L\'ARÈNE…', 320, gridTop() - 20, { color: COLORS.gold, outline: COLORS.ink, align: 'center' });
        }
        this.quitBox.draw(ctx, this.t);
    }

    protected subtitle(): string {
        return `EN LIGNE · SALON ${this.session.code} · ${this.session.isHost ? 'VOUS ÊTES J1 (HÔTE)' : 'VOUS ÊTES J2'}`;
    }

    protected tagLabel(side: 0 | 1): string {
        return side === this.session.side ? 'VOUS' : (side === 0 ? 'J1' : 'J2');
    }

    protected hintText(): string {
        const k = KEYS[0];
        const dirs = `${keyLabel(k.up[0])}${keyLabel(k.left[0])}${keyLabel(k.down[0])}${keyLabel(k.right[0])}`;
        return `${dirs} / ↑←↓→ : CHOISIR · ${keyLabel(k.light[0])} / ENTRÉE : VALIDER · ${keyLabel(k.heavy[0])} : ANNULER · ÉCHAP : QUITTER`;
    }
}


// ——— Stage: the host picks, the guest watches ———

export class OnlineStageScene implements Scene {
    readonly runsHidden = true;
    private t = 0;
    private index: number;
    private leaving = false;
    private quitBox = new QuitConfirm();

    constructor(private session: OnlineSession, private p1: string, private p2: string, stage: string) {
        this.index = Math.max(0, STAGES.findIndex((s) => s.id === stage));
    }

    enter(): void { this.session.watchLobby('stage'); }

    private go(scene: Scene): void {
        this.leaving = true;
        this.session.app.go(scene);
    }

    /** `guestChar`: the guest backed out (host side); else the host did. */
    private backToSelect(guestChar?: string): void {
        const prev = setupFor(this.p1, this.p2, STAGES[this.index].id);
        const scene = new OnlineSelectScene(this.session, prev);
        if (guestChar === undefined) scene.relockAfterStage();
        else scene.guestBackedOut(guestChar);
        this.go(scene);
    }

    tick(menu: MenuInput[]): void {
        this.t++;
        if (this.leaving || this.session.ended) return;
        const host = this.session.isHost;
        const inbox = this.session.take();
        for (let n = 0; n < inbox.length; n++) {
            const msg = inbox[n];
            if (host) {
                // The guest cancelled its fighter just as we moved on (its
                // message crossed ours): back to the select, guest unlocked.
                if (msg.type === 'select' && !msg.ready) {
                    this.session.putBack(inbox.slice(n + 1));
                    this.backToSelect(msg.char);
                    return;
                }
                continue;
            }
            if (msg.type === 'stage') {
                const i = STAGES.findIndex((s) => s.id === msg.stage);
                if (i >= 0 && i !== this.index) { this.index = i; play('uiMove'); }
            } else if (msg.type === 'start') {
                this.session.putBack(inbox.slice(n + 1));
                const setup = this.session.startSetup(msg);
                if (setup) this.go(new OnlineVersusScene(this.session, setup, msg.seed ?? 0));
                else this.leaving = true;
                return;
            } else if (msg.type === 'select' && !msg.ready) {
                // The host backed out to the character select.
                this.session.putBack(inbox.slice(n + 1));
                this.backToSelect();
                return;
            }
        }
        if (this.quitBox.open) {
            if (this.quitBox.handle(menu)) { this.leaving = true; this.session.quit(); }
            return;
        }
        for (const m of menu) {
            if (m.action === 'start') { this.quitBox.show(); return; }
            if (!host) continue;
            const before = this.index;
            if (m.action === 'left') this.index = (this.index + STAGES.length - 1) % STAGES.length;
            if (m.action === 'right') this.index = (this.index + 1) % STAGES.length;
            if (before !== this.index) { play('uiMove'); this.session.send({ type: 'stage', stage: STAGES[this.index].id }); }
            if (m.action === 'back') {
                play('uiBack');
                this.session.send({ type: 'select', char: this.p1, ready: false });
                this.backToSelect();
                return;
            }
            if (m.action === 'confirm') {
                play('uiSelect');
                const seed = newSeed();
                const stage = STAGES[this.index].id;
                this.session.send({ type: 'start', p1: this.p1, p2: this.p2, stage, seed });
                this.go(new OnlineVersusScene(this.session, setupFor(this.p1, this.p2, stage), seed));
                return;
            }
        }
    }

    draw(ctx: CanvasRenderingContext2D): void {
        const s = STAGES[this.index];
        menuBackdrop(ctx, this.t, s.id, 'rgba(10,4,20,0.35)');
        title(ctx, 'CHOIX DE L\'ARÈNE', 16);
        const img = stageImage(s.id);
        panel(ctx, 110, 60, 420, 200);
        if (img) ctx.drawImage(img, 0, 0, img.width, img.height, 114, 64, 412, 192);
        const arrows = this.session.isHost;
        drawText(ctx, arrows ? `← ${s.name.toUpperCase()} →` : s.name.toUpperCase(), 320, 272, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, scale: 3, align: 'center' });
        const dots = STAGES.map((_, i) => (i === this.index ? '•' : '·')).join(' ');
        drawText(ctx, dots, 320, 306, { color: COLORS.gold, align: 'center' });
        const [a, b] = [getChar(this.p1), getChar(this.p2)];
        drawText(ctx, `${a.name.toUpperCase()}  VS  ${b.name.toUpperCase()}`, 320, 46, { color: '#cfc4dc', outline: COLORS.ink, align: 'center' });
        drawPing(ctx, this.session);
        if (this.session.isHost) hint(ctx, '← → : CHOISIR · J / ENTRÉE : COMBATTRE · K : PERSONNAGES · ÉCHAP : QUITTER');
        else hint(ctx, 'L\'HÔTE CHOISIT L\'ARÈNE… · ÉCHAP : QUITTER');
        this.quitBox.draw(ctx, this.t);
    }
}

// ——— VS splash, the same length on both machines ———

export class OnlineVersusScene extends VersusScene {
    readonly runsHidden = true;
    private started = false;
    constructor(private session: OnlineSession, private online: Setup, private seed: number) {
        super(session.app, online);
        session.watchStart(online, seed);
    }

    // No skipping: both screens should end at about the same moment.
    tick(): void {
        this.t++;
        if (this.started || this.session.ended) return;
        if (this.t > 170) {
            this.started = true;
            startOnlineFight(this.session, this.online, this.seed);
        }
    }

    draw(ctx: CanvasRenderingContext2D): void {
        super.draw(ctx);
        drawText(ctx, 'EN LIGNE', 320, 20, { color: '#fff', outline: COLORS.ink, align: 'center' });
        const you = this.session.side === 0 ? 24 : 616;
        drawText(ctx, 'VOUS', you, 270, { color: '#9dff7a', outline: COLORS.ink, scale: 2, align: this.session.side === 0 ? 'left' : 'right' });
        drawPing(ctx, this.session);
    }
}

// ——— Results: a rematch both must accept, or back to the select ———

export class OnlineResultsScene implements Scene {
    readonly runsHidden = true;
    private t = 0;
    private list = new OptionList(['REVANCHE', 'CHANGER DE PERSONNAGES', 'QUITTER']);
    private want = false;
    private theyWant = false;
    private leaving = false;

    constructor(private session: OnlineSession, private setup: Setup, private winner: number, private seed: number) {}

    /** Both back to the synced select, previous fighters under the cursors. */
    private toSelect(): void {
        this.leaving = true;
        this.session.app.go(new OnlineSelectScene(this.session, this.setup));
    }

    enter(): void {
        startMusic('results');
        this.session.watchLobby('results');
    }

    tick(menu: MenuInput[]): void {
        this.t++;
        if (this.leaving || this.session.ended) return;
        const inbox = this.session.take();
        for (let n = 0; n < inbox.length; n++) {
            const msg = inbox[n];
            if (msg.type === 'rematch') {
                if (msg.want && !this.theyWant) play('uiSelect');
                this.theyWant = msg.want;
            } else if (msg.type === 'reselect' && msg.m === this.seed) {
                // The other player chose to change fighters: follow.
                play('uiSelect');
                this.session.putBack(inbox.slice(n + 1));
                this.toSelect();
                return;
            } else if (msg.type === 'start' && !this.session.isHost) {
                this.leaving = true;
                this.session.putBack(inbox.slice(n + 1));
                const setup = this.session.startSetup(msg);
                if (setup) this.session.app.go(new OnlineVersusScene(this.session, setup, msg.seed ?? 0));
                return;
            }
        }
        // Both asked: the host is starting, a late cancel would desync.
        const r = this.want && this.theyWant ? null : this.list.handle(menu);
        if (r === 'back' && this.want) {
            this.want = false;
            this.session.send({ type: 'rematch', want: false });
        } else if (r === 'confirm') {
            if (this.list.index === 2) { this.leaving = true; this.session.quit(); return; }
            if (this.list.index === 1) {
                this.session.send({ type: 'reselect', m: this.seed });
                this.toSelect();
                return;
            }
            this.want = !this.want;
            this.session.send({ type: 'rematch', want: this.want });
        }
        if (this.session.isHost && this.want && this.theyWant) {
            const seed = newSeed();
            const { p1, p2, stage } = this.setup;
            this.session.send({ type: 'start', p1, p2, stage, seed });
            this.leaving = true;
            this.session.app.go(new OnlineVersusScene(this.session, this.setup, seed));
        }
    }

    draw(ctx: CanvasRenderingContext2D): void {
        const draw = this.winner === 2;
        const winId = this.winner === 1 ? this.setup.p2 : this.setup.p1;
        const c = getChar(winId);
        menuBackdrop(ctx, this.t, this.setup.stage, 'rgba(12,4,22,0.7)');
        const art = artOf(winId, 'art');
        if (art && !draw) {
            const s = Math.min(1.9, 300 / art.height);
            ctx.drawImage(art, 330, 340 - art.height * s, art.width * s, art.height * s);
        }
        const won = this.winner === this.session.side;
        drawText(ctx, draw ? 'MATCH NUL' : won ? 'VICTOIRE' : 'DÉFAITE', 40, 50, { color: '#fff', gradient: won || draw ? COLORS.gold : COLORS.red, outline: COLORS.ink, shadow: '#000', scale: 5 });
        if (!draw) {
            drawText(ctx, c.name.toUpperCase(), 40, 100, { color: c.color, outline: COLORS.ink, scale: 3 });
            drawText(ctx, won ? 'VOUS' : 'VOTRE ADVERSAIRE', 40, 128, { color: '#cfc4dc', outline: COLORS.ink, scale: 2 });
        }
        const items = [this.want ? 'REVANCHE (ANNULER)' : 'REVANCHE', 'CHANGER DE PERSONNAGES', 'QUITTER'];
        panel(ctx, 30, 180, 280, items.length * 22 + 20);
        menuItems(ctx, items, this.list.index, 50, 194, this.t);
        const lines: [string, string][] = [
            [this.want ? 'VOUS : REVANCHE DEMANDÉE' : 'VOUS : …', this.want ? '#9dff7a' : COLORS.dim],
            [this.theyWant ? 'ADVERSAIRE : REVANCHE DEMANDÉE' : 'ADVERSAIRE : …', this.theyWant ? '#9dff7a' : COLORS.dim]
        ];
        lines.forEach(([text, color], i) => drawText(ctx, text, 40, 278 + i * 14, { color, outline: COLORS.ink }));
        drawPing(ctx, this.session);
    }
}

// ——— Start-up: an invite link goes straight into joining ———

/**
 * The first scene: the join screen when the page was opened from an invite
 * link (?salon=CODE, or ?spectateur=CODE to watch), else `fallback`. The parameter is removed from the
 * address bar so a reload does not join again.
 */
export function initialScene(app: App, fallback: Scene): Scene {
    const params = new URLSearchParams(location.search);
    // A link retyped from the screen (drawn in capitals) says ?SALON=.
    // ?spectateur=CODE: the spectator's link.
    const key = [...params.keys()].find((k) => k.toLowerCase() === 'salon' || k.toLowerCase() === 'spectateur');
    const raw = key ? params.get(key) : null;
    if (!key || !raw) return fallback;
    params.delete(key);
    const q = params.toString();
    history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
    const code = codeFromText(raw);
    return new JoinScene(app, code ?? raw, code !== null, key.toLowerCase() === 'spectateur');
}
