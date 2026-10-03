import { play } from '../audio/sound';
import { startMusic, stopMusic } from '../audio/music';
import { opensWithVoices, playRoundEndVoices, playStartVoices, playVoice } from '../audio/voices';
import { ROSTER } from '../characters';
import { createMatch, METER_MAX, stepMatch } from '../engine/match';
import { getChar } from '../engine/registry';
import { BTN, type CharacterDef, type MatchState, type MoveSlot } from '../engine/types';
import { KEYS, endInputTick, keyLabel, padFamily, readSide, readSolo, rumbleOn, type MenuInput } from '../input/devices';
import { PAD_LABELS } from '../input/gamepad';
import { drawText, textWidth } from '../render/font';
import { FightView, voiceChannel } from '../render/fightView';
import { artOf, drawFrame } from '../render/sprites';
import { STAGES, stageImage } from '../render/stage';
import { settings } from '../settings';
import { Cpu, LEVELS, LEVEL_NAMES, dummyBits, type DummyMode } from './ai';
import { OptionList, type App, type Scene } from './app';
import { InputLog, entryLabel } from './inputLog';
import { SettingsScene } from './settingsScene';
import { COLORS, hint, menuBackdrop, menuItems, notation, panel, title } from './ui';

// ——— Session setup ———

export type Mode = 'arcade' | 'versus' | 'versusCpu' | 'training';

export interface Setup {
    mode: Mode;
    p1: string;
    p2: string;
    stage: string;
    cpuLevel: number;
    /** Arcade: opponents still to beat, and how many were beaten. */
    ladder?: string[];
    beaten?: number;
}

/**
 * Arcade road, weakest to strongest: the Straw Hats and the Corsairs first,
 * then the heavy hitters, Doflamingo before the last fight and the Admiral
 * at the end. Neighbours in rank swap at random so no two runs are
 * identical. A fighter missing from the list (a new file) slots in mid-road.
 */
const ARCADE_RANK = [
    'buggy', 'vivi', 'usopp', 'nami', 'chopper', 'luffy', 'zoro', 'sanji', 'franky', 'robin', 'hody',
    'hancock', 'crocodile', 'drake', 'ivankov', 'lucci', 'enel', 'jinbei', 'law', 'kid', 'ace', 'marco',
    'magellan', 'kuma', 'doflamingo', 'shiki', 'mihawk', 'kizaru', 'aokiji', 'shanks', 'blackbeard', 'whitebeard', 'akainu'
];
/** Fights in one arcade run, bosses included. */
const ARCADE_LENGTH = 8;

export function arcadeLadder(p1: string, rand: () => number): string[] {
    const rank = (id: string) => {
        const r = ARCADE_RANK.indexOf(id);
        return r < 0 ? ARCADE_RANK.length / 2 : r;
    };
    const others = ROSTER.map((c) => c.id).filter((id) => id !== p1);
    others.sort((a, b) => rank(a) - rank(b));
    // The two strongest stay last. The road before them takes one fighter
    // at random from each slice of the ranking, weakest first.
    const bosses = others.splice(Math.max(0, others.length - 2));
    const n = Math.min(others.length, ARCADE_LENGTH - bosses.length);
    const road: string[] = [];
    for (let i = 0; i < n; i++) {
        const lo = Math.floor((i * others.length) / n);
        const hi = Math.floor(((i + 1) * others.length) / n);
        road.push(others[lo + Math.floor(rand() * (hi - lo))]);
    }
    return [...road, ...bosses];
}

/**
 * Rounds to win: against the CPU, the OPTIONS setting; in local versus, the
 * versus menu's. Training has no rounds; the online fight keeps the default.
 */
export function roundsFor(mode: Mode): number | undefined {
    if (mode === 'arcade' || mode === 'versusCpu') return settings.rounds;
    if (mode === 'versus') return settings.versusRounds;
    return undefined;
}

const randomStage = () => STAGES[Math.floor(Math.random() * STAGES.length)].id;

/**
 * Routing hooks filled in by other modules (game/online.ts), so this file
 * does not import them back: "VERSUS J1 CONTRE J2" opens the local / online
 * submenu when one is registered.
 */
export const sceneHooks: { versusMenu?: (app: App, back: Scene) => Scene } = {};

// ——— Title ———

export class TitleScene implements Scene {
    private t = 0;
    constructor(private app: App) {}

    enter(): void { startMusic('title'); }

    tick(menu: MenuInput[]): void {
        this.t++;
        if (menu.some((m) => m.action === 'confirm' || m.action === 'start')) {
            play('uiSelect');
            this.app.go(new MainMenuScene(this.app));
        }
    }

    draw(ctx: CanvasRenderingContext2D): void {
        menuBackdrop(ctx, this.t, 'marineford', 'rgba(16,4,28,0.55)');
        // The roster, breathing in two staggered ranks: odd places stand
        // behind, so ten fighters fit the width without covering each other.
        const n = ROSTER.length;
        const gap = Math.min(104, 600 / n);
        // Within a rank the widest sprites go down first, so a long sword or
        // a giant does not bury a slimmer fighter standing next to it.
        const width = (c: (typeof ROSTER)[number]) => c.manifest.anims.idle.frames[0][2];
        const order = ROSTER.map((c, i) => ({ c, i })).sort((a, b) => (b.i % 2) - (a.i % 2) || width(b.c) - width(a.c));
        for (const { c, i } of order) {
            const x = 320 + (i - (n - 1) / 2) * gap;
            const back = n > 5 && i % 2 === 1;
            const ground = back ? 138 : 152;
            ctx.save();
            ctx.setTransform(2, 0, 0, 2, 0, 0);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.beginPath();
            ctx.ellipse(x / 2, ground, 16, 3, 0, 0, Math.PI * 2);
            ctx.fill();
            const anim = c.manifest.anims.idle;
            const per = Math.round(60 / (anim.fps ?? 6));
            drawFrame(ctx, c.id, 'idle', Math.floor((this.t + i * 7) / per) % anim.frames.length, x / 2, ground, i < n / 2 ? 1 : -1);
            ctx.restore();
        }
        const bob = Math.sin(this.t / 30) * 2;
        drawText(ctx, 'ONE PIEXEL', 320, 44 + bob, { color: '#ffffff', gradient: '#ffd23f', outline: COLORS.ink, shadow: '#7a1a10', scale: 7, align: 'center' });
        drawText(ctx, 'FIGHTING GAME', 320, 110 + bob, { color: '#ff8a5c', gradient: '#e8412c', outline: COLORS.ink, scale: 3, align: 'center' });
        if (this.t % 60 < 40) drawText(ctx, 'APPUYEZ SUR ENTRÉE', 320, 320, { color: '#ffffff', outline: COLORS.ink, scale: 2, align: 'center' });
        drawText(ctx, 'PROJET DE FAN NON OFFICIEL · SPRITES ONE PIECE GIGANT BATTLE 2 (BANDAI NAMCO / GANBARION)', 320, 348, { color: '#9a8fb0', align: 'center' });
    }
}

// ——— Main menu ———

export class MainMenuScene implements Scene {
    private t = 0;
    private list = new OptionList(['ARCADE', 'VERSUS J1 CONTRE J2', 'VERSUS ORDINATEUR', 'ENTRAÎNEMENT', 'COMMANDES', 'OPTIONS']);
    private blurbs = [
        'Affrontez tout le roster, l\'un après l\'autre.',
        'Deux joueurs sur le même clavier, ou en ligne par un lien.',
        'Choisissez votre adversaire et sa difficulté.',
        'Adversaire immobile, vie et jauge infinies, boîtes visibles.',
        'Touches, manettes et toutes les mécaniques du jeu.',
        'Volume, musique, voix, règles des combats et affichage.'
    ];
    constructor(private app: App) {}

    tick(menu: MenuInput[]): void {
        this.t++;
        const r = this.list.handle(menu);
        if (r === 'back') this.app.go(new TitleScene(this.app));
        if (r !== 'confirm') return;
        const modes: (Mode | 'controls' | 'options')[] = ['arcade', 'versus', 'versusCpu', 'training', 'controls', 'options'];
        const m = modes[this.list.index];
        if (m === 'controls') this.app.go(new ControlsScene(this.app, this));
        else if (m === 'options') this.app.go(new SettingsScene(this.app, this));
        else if (m === 'versus' && sceneHooks.versusMenu) this.app.go(sceneHooks.versusMenu(this.app, this));
        else this.app.go(new SelectScene(this.app, m));
    }

    draw(ctx: CanvasRenderingContext2D): void {
        menuBackdrop(ctx, this.t, 'arlong-park');
        drawText(ctx, 'ONE PIEXEL', 44, 34, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, scale: 4 });
        panel(ctx, 30, 96, 330, 150);
        menuItems(ctx, this.list.items, this.list.index, 52, 114, this.t);
        panel(ctx, 30, 256, 580, 34, COLORS.dim);
        drawText(ctx, this.blurbs[this.list.index], 44, 268, { color: '#e8e0f0' });
        // A fighter on the right, changing with the cursor.
        const c = ROSTER[this.list.index % ROSTER.length];
        const art = artOf(c.id, 'art');
        if (art) {
            const s = Math.min(2, 220 / art.height);
            ctx.drawImage(art, 610 - art.width * s, 250 - art.height * s, art.width * s, art.height * s);
        }
        hint(ctx, `${keyLabel(KEYS[0].up[0])}${keyLabel(KEYS[0].down[0])} / ↑↓ : CHOISIR · ${keyLabel(KEYS[0].light[0])} / ENTRÉE : VALIDER · ${keyLabel(KEYS[0].heavy[0])} / ÉCHAP : RETOUR`);
    }
}

// ——— Character select ———

/**
 * Portrait grid geometry: eleven per row, so 33 fighters make an 11×3
 * block sitting just above the hint bar; a shorter last row is centred.
 */
export const GRID_COLS = 11;
const CELL_W = 50;
const CELL_H = 38;
const CELL_GAP = 3;
const GRID_BOTTOM = 338;

const gridRows = () => Math.ceil(ROSTER.length / GRID_COLS);
/** Top of the grid; also the floor the big art stands on. */
export const gridTop = () => GRID_BOTTOM - gridRows() * (CELL_H + CELL_GAP) + CELL_GAP;

function cellPos(i: number): { x: number; y: number } {
    const row = Math.floor(i / GRID_COLS);
    const inRow = Math.min(GRID_COLS, ROSTER.length - row * GRID_COLS);
    const width = inRow * CELL_W + (inRow - 1) * CELL_GAP;
    return { x: 320 - width / 2 + (i % GRID_COLS) * (CELL_W + CELL_GAP), y: gridTop() + row * (CELL_H + CELL_GAP) };
}

/** Up/down: the nearest cell of the next row, wrapping round. */
export function gridStep(i: number, dir: 1 | -1): number {
    const rows = gridRows();
    if (rows < 2) return i;
    const row = (Math.floor(i / GRID_COLS) + dir + rows) % rows;
    const cx = cellPos(i).x;
    let best = row * GRID_COLS;
    for (let j = best; j < Math.min(ROSTER.length, (row + 1) * GRID_COLS); j++) {
        if (Math.abs(cellPos(j).x - cx) < Math.abs(cellPos(best).x - cx)) best = j;
    }
    return best;
}

export interface Cursor { index: number; locked: boolean; side: 0 | 1 }

export class SelectScene implements Scene {
    protected t = 0;
    protected cursors: Cursor[];
    /** In one-player modes, player 1 picks both, one after the other. */
    private picking: 0 | 1 = 0;
    private level = 2;
    private levelStep = false;

    constructor(private app: App, private mode: Mode, private prev?: Setup) {
        const i1 = prev ? ROSTER.findIndex((c) => c.id === prev.p1) : 0;
        const i2 = prev ? ROSTER.findIndex((c) => c.id === prev.p2) : 1;
        this.cursors = [{ index: Math.max(0, i1), locked: false, side: 0 }, { index: Math.max(0, i2), locked: false, side: 1 }];
        if (prev) this.level = prev.cpuLevel;
    }

    enter(): void { startMusic('select'); }

    private get twoPlayers(): boolean { return this.mode === 'versus'; }

    tick(menu: MenuInput[]): void {
        this.t++;
        for (const m of menu) {
            // Alone, both key sets drive the cursor being picked.
            const side = this.twoPlayers ? m.side : this.picking;
            const c = this.cursors[side];
            if (this.levelStep) {
                if (m.action === 'left' || m.action === 'down') { this.level = Math.max(0, this.level - 1); play('uiMove'); }
                if (m.action === 'right' || m.action === 'up') { this.level = Math.min(LEVELS.length - 1, this.level + 1); play('uiMove'); }
                if (m.action === 'confirm') { play('uiSelect'); this.finish(); return; }
                if (m.action === 'back') { this.levelStep = false; this.cursors[1].locked = false; play('uiBack'); }
                continue;
            }
            if (m.action === 'back') {
                play('uiBack');
                if (c.locked) c.locked = false;
                else if (!this.twoPlayers && this.picking === 1) { this.picking = 0; this.cursors[0].locked = false; }
                else { this.app.go(new MainMenuScene(this.app)); return; }
                continue;
            }
            if (c.locked) continue;
            const n = ROSTER.length;
            if (m.action === 'left') { c.index = (c.index + n - 1) % n; play('uiMove'); }
            if (m.action === 'right') { c.index = (c.index + 1) % n; play('uiMove'); }
            if (m.action === 'up' || m.action === 'down') {
                const next = gridStep(c.index, m.action === 'up' ? -1 : 1);
                if (next !== c.index) { c.index = next; play('uiMove'); }
            }
            if (m.action === 'confirm') {
                c.locked = true;
                play('uiSelect');
                playVoice(ROSTER[c.index].id, 'select', 'select');
                if (!this.twoPlayers) {
                    if (this.mode === 'arcade') { this.finish(); return; }
                    if (this.picking === 0) this.picking = 1;
                    else if (this.mode === 'versusCpu') this.levelStep = true;
                    else { this.finish(); return; }
                }
            }
        }
        if (this.twoPlayers && this.cursors.every((c) => c.locked)) this.finish();
    }

    private finish(): void {
        const p1 = ROSTER[this.cursors[0].index].id;
        if (this.mode === 'arcade') {
            const ladder = arcadeLadder(p1, Math.random);
            const setup: Setup = { mode: 'arcade', p1, p2: ladder[0], stage: randomStage(), cpuLevel: 1, ladder, beaten: 0 };
            this.app.go(new VersusScene(this.app, setup));
            return;
        }
        const p2 = ROSTER[this.cursors[1].index].id;
        const setup: Setup = { mode: this.mode, p1, p2, stage: this.prev?.stage ?? randomStage(), cpuLevel: this.level };
        if (this.mode === 'training') this.app.go(new FightScene(this.app, { ...setup, stage: 'marineford' }));
        else this.app.go(new StageScene(this.app, setup));
    }

    draw(ctx: CanvasRenderingContext2D): void {
        menuBackdrop(ctx, this.t, 'enies-lobby', 'rgba(14,4,24,0.8)');
        title(ctx, 'CHOIX DU COMBATTANT', 16);
        drawText(ctx, this.subtitle(), 320, 44, { color: COLORS.dim, align: 'center' });

        // Big art for each side.
        for (const side of [0, 1] as const) {
            if (this.mode === 'arcade' && side === 1) continue;
            const c = ROSTER[this.cursors[side].index];
            const active = this.twoPlayers || this.picking === side || this.cursors[side].locked;
            if (!active && side === 1) continue;
            this.drawSide(ctx, c, side, this.cursors[side].locked);
        }

        // Portrait grid: GRID_COLS per row, the last row centred. Cells no
        // cursor sits on are dimmed, so the picks stand out in a full grid.
        const top = gridTop();
        ctx.fillStyle = 'rgba(8,2,16,0.75)';
        ctx.fillRect(0, top - 4, 640, GRID_BOTTOM - top + 6);
        const hovered = new Set(this.cursors.filter((_, side) => this.cursorShown(side as 0 | 1)).map((c) => c.index));
        ROSTER.forEach((c, i) => {
            const { x, y } = cellPos(i);
            ctx.fillStyle = '#12091c';
            ctx.fillRect(x, y, CELL_W, CELL_H);
            ctx.globalAlpha = hovered.has(i) ? 1 : 0.62;
            const p = artOf(c.id, 'portrait');
            if (p) {
                // Cover the cell, keeping the upper part of the card where
                // the face is; odd-sized portraits are centred.
                const s = Math.max(CELL_W / p.width, CELL_H / p.height);
                const sw = CELL_W / s;
                const sh = CELL_H / s;
                ctx.drawImage(p, (p.width - sw) / 2, (p.height - sh) * 0.3, sw, sh, x, y, CELL_W, CELL_H);
            }
            ctx.globalAlpha = 1;
            ctx.strokeStyle = hovered.has(i) ? '#8a6aa8' : '#3a2a4a';
            ctx.strokeRect(x + 0.5, y + 0.5, CELL_W - 1, CELL_H - 1);
        });
        for (const side of [0, 1] as const) {
            if (!this.cursorShown(side)) continue;
            const c = this.cursors[side];
            const { x, y } = cellPos(c.index);
            const color = side === 0 ? '#ff5a3c' : '#4cc3ff';
            const blink = c.locked || this.t % 20 < 14;
            if (blink) {
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                const inset = side === 0 ? 1 : 4;
                ctx.strokeRect(x + inset, y + inset, CELL_W - inset * 2, CELL_H - inset * 2);
                ctx.lineWidth = 1;
            }
            // Tags on the cell's top edge, J1 left and J2 right, so both
            // stay readable when the cursors share a portrait.
            const label = this.tagLabel(side);
            const w = textWidth(label);
            const tx = side === 0 ? x + 2 : x + CELL_W - 4 - w;
            ctx.fillStyle = color;
            ctx.fillRect(tx - 1, y - 5, w + 4, 10);
            drawText(ctx, label, tx + 1, y - 3, { color: '#fff', outline: COLORS.ink });
        }
        if (this.levelStep) {
            panel(ctx, 220, 150, 200, 60, COLORS.blue);
            drawText(ctx, 'DIFFICULTÉ', 320, 160, { color: '#fff', outline: COLORS.ink, align: 'center' });
            drawText(ctx, `← ${LEVEL_NAMES[this.level]} →`, 320, 182, { color: COLORS.gold, outline: COLORS.ink, scale: 2, align: 'center' });
        }
        hint(ctx, this.hintText());
    }

    protected cursorShown(side: 0 | 1): boolean {
        if (this.mode === 'arcade' && side === 1) return false;
        return this.twoPlayers || side === 0 || this.picking === 1 || this.cursors[1].locked;
    }

    // Overridden by the online select screen (game/online.ts).
    protected subtitle(): string {
        const labels: Record<Mode, string> = { arcade: 'ARCADE', versus: 'VERSUS', versusCpu: 'CONTRE L\'ORDINATEUR', training: 'ENTRAÎNEMENT' };
        return labels[this.mode];
    }

    protected tagLabel(side: 0 | 1): string {
        return side === 0 ? 'J1' : (this.twoPlayers ? 'J2' : 'CPU');
    }

    protected hintText(): string {
        const [k1, k2] = KEYS;
        const dirs = (k: typeof k1) => `${keyLabel(k.up[0])}${keyLabel(k.left[0])}${keyLabel(k.down[0])}${keyLabel(k.right[0])}`;
        return this.twoPlayers
            ? `J1 : ${dirs(k1)} ET ${keyLabel(k1.light[0])} · J2 : ${dirs(k2)} ET ${keyLabel(k2.light[0])} · RETOUR : ${keyLabel(k1.heavy[0])} / ${keyLabel(k2.heavy[0])}`
            : `${dirs(k1)} : CHOISIR · ${keyLabel(k1.light[0])} / ENTRÉE : VALIDER · ${keyLabel(k1.heavy[0])} / ÉCHAP : RETOUR`;
    }

    private drawSide(ctx: CanvasRenderingContext2D, c: CharacterDef, side: 0 | 1, locked: boolean): void {
        const art = artOf(c.id, 'art');
        // Art sits beside the stat panel (partly under it), never fully behind.
        const x = side === 0 ? 100 : 540;
        if (art) {
            const s = Math.min(1.4, 150 / art.height, 220 / art.width);
            const w = art.width * s;
            const h = art.height * s;
            ctx.save();
            if (side === 1) { ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0); }
            ctx.globalAlpha = locked ? 1 : 0.9;
            ctx.drawImage(art, x, gridTop() - 6 - h, w, h);
            ctx.restore();
        }
        const tx = side === 0 ? 30 : 610;
        const align = side === 0 ? 'left' : 'right';
        ctx.fillStyle = 'rgba(10,4,20,0.7)';
        ctx.fillRect(side === 0 ? 20 : 400, 58, 220, 108);
        drawText(ctx, c.name.toUpperCase(), tx, 64, { color: '#ffffff', gradient: c.color, outline: COLORS.ink, scale: 3, align });
        drawText(ctx, c.title.toUpperCase(), tx, 92, { color: COLORS.gold, outline: COLORS.ink, align });
        // Stats.
        const stats: [string, number][] = [
            ['VIE', (c.health - 850) / 300],
            ['VITESSE', (c.walk - 1) / 1.2],
            ['PUISSANCE', (c.moves.heavy.hits[0]?.damage ?? 60) / 100]
        ];
        stats.forEach(([label, v], i) => {
            const y = 108 + i * 12;
            drawText(ctx, label, side === 0 ? tx : tx - 120, y, { color: '#cfc4dc', outline: COLORS.ink });
            const bx = side === 0 ? tx + 64 : tx - 56;
            ctx.fillStyle = '#20142c';
            ctx.fillRect(bx, y, 56, 6);
            ctx.fillStyle = c.color;
            ctx.fillRect(bx, y, Math.round(56 * Math.max(0.1, Math.min(1, v))), 6);
        });
        if (locked) drawText(ctx, 'PRÊT !', tx, 150, { color: '#9dff7a', outline: COLORS.ink, scale: 2, align });
    }
}

// ——— Stage select ———

export class StageScene implements Scene {
    private t = 0;
    private index: number;
    constructor(private app: App, private setup: Setup) {
        this.index = Math.max(0, STAGES.findIndex((s) => s.id === setup.stage));
    }

    tick(menu: MenuInput[]): void {
        this.t++;
        for (const m of menu) {
            if (m.action === 'left') { this.index = (this.index + STAGES.length - 1) % STAGES.length; play('uiMove'); }
            if (m.action === 'right') { this.index = (this.index + 1) % STAGES.length; play('uiMove'); }
            if (m.action === 'back') { play('uiBack'); this.app.go(new SelectScene(this.app, this.setup.mode, this.setup)); return; }
            if (m.action === 'confirm') {
                play('uiSelect');
                this.app.go(new VersusScene(this.app, { ...this.setup, stage: STAGES[this.index].id }));
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
        drawText(ctx, `← ${s.name.toUpperCase()} →`, 320, 272, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, scale: 3, align: 'center' });
        const dots = STAGES.map((_, i) => (i === this.index ? '•' : '·')).join(' ');
        drawText(ctx, dots, 320, 306, { color: COLORS.gold, align: 'center' });
        hint(ctx, '← → : CHOISIR · J / ENTRÉE : COMBATTRE · K / ÉCHAP : RETOUR');
    }
}

// ——— Versus splash ———

export class VersusScene implements Scene {
    protected t = 0;
    constructor(private app: App, private setup: Setup) {}

    enter(): void { stopMusic(); play('uiSelect'); }

    tick(menu: MenuInput[]): void {
        this.t++;
        if (this.t > 170 || (this.t > 30 && menu.some((m) => m.action === 'confirm'))) {
            this.app.go(new FightScene(this.app, this.setup));
        }
    }

    draw(ctx: CanvasRenderingContext2D): void {
        const [a, b] = [getChar(this.setup.p1), getChar(this.setup.p2)];
        const k = Math.min(1, this.t / 14);
        const ease = 1 - Math.pow(1 - k, 3);
        // Two halves split by a diagonal.
        ctx.fillStyle = a.color;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(360, 0); ctx.lineTo(280, 360); ctx.lineTo(0, 360); ctx.fill();
        ctx.fillStyle = b.color;
        ctx.beginPath(); ctx.moveTo(360, 0); ctx.lineTo(640, 0); ctx.lineTo(640, 360); ctx.lineTo(280, 360); ctx.fill();
        ctx.fillStyle = 'rgba(10,4,20,0.55)';
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.moveTo(356, 0); ctx.lineTo(364, 0); ctx.lineTo(284, 360); ctx.lineTo(276, 360); ctx.fill();
        for (const [c, side] of [[a, 0], [b, 1]] as const) {
            const art = artOf(c.id, 'art');
            if (!art) continue;
            const s = Math.min(1.8, 250 / art.height);
            const w = art.width * s;
            const h = art.height * s;
            const x = side === 0 ? -w + (w + 20) * ease : 640 - (w + 20) * ease;
            ctx.save();
            if (side === 1) { ctx.translate(x + w, 0); ctx.scale(-1, 1); ctx.drawImage(art, 0, 300 - h, w, h); }
            else ctx.drawImage(art, x, 300 - h, w, h);
            ctx.restore();
            const tx = side === 0 ? 24 : 616;
            const align = side === 0 ? 'left' : 'right';
            drawText(ctx, c.name.toUpperCase(), tx, 300, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, scale: 4, align });
            drawText(ctx, c.title.toUpperCase(), tx, 334, { color: '#fff', outline: COLORS.ink, align });
        }
        const vsScale = this.t < 20 ? 1 : this.t < 26 ? 12 - (this.t - 20) : 6;
        if (this.t >= 20) drawText(ctx, 'VS', 320, 150 - vsScale * 3, { color: '#ffffff', gradient: '#ff5a3c', outline: COLORS.ink, shadow: '#000', scale: Math.round(vsScale), align: 'center' });
        const stage = STAGES.find((s) => s.id === this.setup.stage);
        if (this.setup.mode === 'arcade') {
            drawText(ctx, `COMBAT ${(this.setup.beaten ?? 0) + 1} / ${(this.setup.ladder?.length ?? 1)}`, 320, 20, { color: '#fff', outline: COLORS.ink, scale: 2, align: 'center' });
        }
        if (stage) drawText(ctx, stage.name.toUpperCase(), 320, 44, { color: COLORS.gold, outline: COLORS.ink, align: 'center' });
    }
}

// ——— Fight ———

const SLOT_NOTATION: [MoveSlot, string][] = [
    ['lightA', '[A]'], ['lightB', '[A] [A]'], ['lightC', '[A] [A] [A]'],
    ['heavy', '[B]'], ['heavyFwd', '→ [B]'], ['heavyBack', '← [B]'],
    ['crouchLight', '↓ [A]'], ['crouchHeavy', '↓ [B]'],
    ['airLight', 'SAUT [A]'], ['airHeavy', 'SAUT [B]'], ['airSpecial', 'SAUT [C]'],
    ['specialN', '[C]  OU  ↓↘→ [C]'], ['specialF', '→ [C]'], ['specialU', '↑ [C]  OU  →↓↘ [C]'],
    ['specialD', '↓ [C]  OU  ↓↙← [C]'], ['throw', '[A]+[B] (PRÈS)'], ['ultimate', 'ULTIME  OU  [B]+[C] (1 BARRE)'], ['ultimate2', '[A]+[B]+[C] (2 BARRES)']
];

export class FightScene implements Scene {
    private state: MatchState;
    private view: FightView;
    private cpu: (Cpu | null)[] = [null, null];
    private paused = false;
    private pauseList: OptionList;
    private showMoves = false;
    private endT = 0;
    private dummy: DummyMode = 'stand';
    private boxes = false;
    private showInputs = true;
    private inputLog = new InputLog();
    private t = 0;

    constructor(private app: App, private setup: Setup) {
        const training = setup.mode === 'training';
        this.state = createMatch(setup.p1, setup.p2, { training, roundsToWin: roundsFor(setup.mode) });
        const stage = STAGES.find((s) => s.id === setup.stage) ?? STAGES[0];
        const names: [string, string] = setup.mode === 'versus' ? ['J1', 'J2'] : ['J1', training ? 'MANNEQUIN' : 'CPU'];
        this.view = new FightView(this.state, stage, { names, training });
        if (setup.mode === 'arcade' || setup.mode === 'versusCpu') {
            // Arcade climbs from the level set in OPTIONS (NORMAL by default)
            // to the top over the whole road; VERSUS ORDINATEUR keeps the
            // level picked on the select screen.
            const road = Math.max(1, (setup.ladder?.length ?? 1) - 1);
            const climb = Math.round(((setup.beaten ?? 0) * (LEVELS.length - 2)) / road);
            const level = setup.mode === 'arcade' ? Math.min(LEVELS.length - 1, settings.arcadeLevel + climb) : setup.cpuLevel;
            this.cpu[1] = new Cpu(LEVELS[level], Date.now() & 0xffff);
        }
        this.pauseList = new OptionList(this.pauseItems());
    }

    enter(): void { startMusic(this.setup.stage); }

    private pauseItems(): string[] {
        if (this.setup.mode === 'training') {
            const names: Record<DummyMode, string> = { stand: 'DEBOUT', crouch: 'ACCROUPI', guard: 'GARDE', jump: 'SAUTE', cpu: 'ORDINATEUR' };
            return ['REPRENDRE', 'LISTE DES COUPS', `MANNEQUIN : ${names[this.dummy]}`, `BOÎTES : ${this.boxes ? 'OUI' : 'NON'}`, `INPUTS : ${this.showInputs ? 'OUI' : 'NON'}`, `JAUGE D'ULTIME : ${this.state.fullMeter !== false ? 'PLEINE' : 'NORMALE'}`, 'OPTIONS', 'CHANGER DE PERSONNAGES', 'MENU PRINCIPAL'];
        }
        return ['REPRENDRE', 'LISTE DES COUPS', 'RECOMMENCER', 'OPTIONS', 'MENU PRINCIPAL'];
    }

    tick(menu: MenuInput[]): void {
        this.t++;
        if (this.showMoves || this.paused) endInputTick();
        if (this.showMoves) {
            if (menu.some((m) => m.action === 'back' || m.action === 'confirm' || m.action === 'start')) { this.showMoves = false; play('uiBack'); }
            return;
        }
        if (this.paused) {
            const r = this.pauseList.handle(menu);
            if (menu.some((m) => m.action === 'start') || r === 'back') { this.paused = false; return; }
            if (r === 'confirm') this.pauseChoice(this.pauseList.items[this.pauseList.index]);
            return;
        }
        if (menu.some((m) => m.action === 'start') && this.state.phase !== 'matchEnd') {
            this.paused = true;
            this.pauseList.index = 0;
            play('uiConfirm');
            return;
        }

        const inputs: [number, number] = [0, 0];
        for (const side of [0, 1] as const) {
            const cpu = this.cpu[side];
            if (cpu) inputs[side] = cpu.next(this.state, side);
            else if (this.setup.mode === 'training' && side === 1) inputs[side] = dummyBits(this.dummy, this.state.fighters[1], this.t);
            else if (this.setup.mode === 'versus') inputs[side] = readSide(side) & ~BTN.start;
            else if (side === 0) inputs[side] = readSolo() & ~BTN.start;
        }
        endInputTick();
        if (this.setup.mode === 'training') this.inputLog.push(inputs[0], this.state.fighters[0].facing);
        // Dev only: the inputs and state, for the end-to-end input checks.
        if (import.meta.env.DEV) (window as unknown as { __opfgFight?: unknown }).__opfgFight = { inputs, state: this.state };
        const events = stepMatch(this.state, inputs);
        this.view.handle(events);
        // Both opening lines once, as the first round is called (never in
        // training); then at each round's end, a human winner's victory line
        // and a human loser's defeat line (in versus, both players are human).
        const chars = this.state.fighters.map((f) => f.char);
        for (const e of events) {
            if (e.type === 'round' && e.round === 1 && opensWithVoices(this.setup.mode)) playStartVoices(chars, voiceChannel);
            if (e.type === 'roundEnd') playRoundEndVoices(chars, e.winner, this.setup.mode === 'versus' ? [0, 1] : [0], voiceChannel);
        }
        if (this.setup.mode === 'versus') { rumbleOn(events, 0, [0]); rumbleOn(events, 1, [1]); }
        else rumbleOn(events, 0, [0, 1]);
        this.view.update();
        if (events.some((e) => e.type === 'matchEnd')) {
            const w = this.state.winner;
            const human = this.setup.mode === 'versus' ? w < 2 : w === 0;
            play(human ? 'win' : 'lose');
        }
        if (this.state.phase === 'matchEnd') {
            this.endT++;
            if (this.endT > 150) this.app.go(new ResultsScene(this.app, this.setup, this.state.winner));
        }
    }

    private pauseChoice(item: string): void {
        if (item === 'REPRENDRE') this.paused = false;
        else if (item === 'LISTE DES COUPS') this.showMoves = true;
        else if (item === 'RECOMMENCER') this.app.go(new FightScene(this.app, this.setup));
        // The fight waits, paused, and picks up where it was on the way back.
        else if (item === 'OPTIONS') this.app.go(new SettingsScene(this.app, this));
        else if (item === 'MENU PRINCIPAL') this.app.go(new MainMenuScene(this.app));
        else if (item === 'CHANGER DE PERSONNAGES') this.app.go(new SelectScene(this.app, this.setup.mode, this.setup));
        else if (item.startsWith('MANNEQUIN')) {
            const order: DummyMode[] = ['stand', 'crouch', 'guard', 'jump', 'cpu'];
            this.dummy = order[(order.indexOf(this.dummy) + 1) % order.length];
            this.cpu[1] = this.dummy === 'cpu' ? new Cpu(LEVELS[2], 3) : null;
        } else if (item.startsWith('BOÎTES')) {
            this.boxes = !this.boxes;
            this.view.options.showBoxes = this.boxes;
        } else if (item.startsWith('INPUTS')) {
            this.showInputs = !this.showInputs;
            this.inputLog.clear();
        } else if (item.startsWith('JAUGE')) {
            // Normal: both meters start empty and fill as in a real fight.
            this.state.fullMeter = this.state.fullMeter === false;
            for (const f of this.state.fighters) f.meter = this.state.fullMeter ? METER_MAX : 0;
        }
        const i = this.pauseList.index;
        this.pauseList.items = this.pauseItems();
        this.pauseList.index = i;
    }

    draw(ctx: CanvasRenderingContext2D): void {
        this.view.draw(ctx);
        if (this.setup.mode === 'training') this.drawTrainingInfo(ctx);
        if (this.paused) {
            ctx.fillStyle = 'rgba(8,4,16,0.7)';
            ctx.fillRect(0, 0, 640, 360);
            // Wide enough for the longest line, its selection shift included,
            // and raised as the list grows so the longest (training) one
            // stays centred instead of sinking to the bottom of the screen.
            const items = this.pauseList.items;
            const w = Math.max(280, Math.max(...items.map((it) => textWidth(it, 2))) + 64);
            const h = items.length * 22 + 20;
            const x = 320 - (w >> 1);
            const y = Math.min(110, Math.round((360 - h) / 2) + 14);
            title(ctx, 'PAUSE', y - 40);
            panel(ctx, x, y, w, h);
            menuItems(ctx, items, this.pauseList.index, x + 20, y + 14, this.t, 22, 2, w - 12);
        }
        if (this.showMoves) this.drawMoveList(ctx, getChar(this.setup.p1));
    }

    private drawTrainingInfo(ctx: CanvasRenderingContext2D): void {
        const f = this.state.fighters[0];
        const d = this.state.fighters[1];
        const moveLine = `COUP : ${f.move ? getChar(f.char).moves[f.move as MoveSlot].name.toUpperCase() : '—'}`;
        const w = Math.max(172, textWidth(moveLine) + 12);
        panel(ctx, 320 - (w >> 1), 48, w, 30, COLORS.dim);
        drawText(ctx, `COMBO ${d.combo}  DÉGÂTS ${d.comboDamage}`, 320, 52, { color: '#fff', align: 'center' });
        drawText(ctx, moveLine, 320, 64, { color: COLORS.gold, align: 'center' });
        drawText(ctx, 'ÉCHAP : PAUSE / OPTIONS', 320, 330, { color: '#cfc4dc', outline: COLORS.ink, align: 'center' });
        if (this.showInputs) this.drawInputLog(ctx);
    }

    /** J1's inputs, newest on top, under the combo counter on the left. */
    private drawInputLog(ctx: CanvasRenderingContext2D): void {
        const entries = this.inputLog.entries;
        if (!entries.length) return;
        const x = 6;
        const y = 176;
        const row = 12;
        ctx.fillStyle = 'rgba(8,4,16,0.55)';
        ctx.fillRect(x - 2, y - 4, 82, entries.length * row + 4);
        entries.forEach((e, i) => {
            const ry = y + i * row;
            // Older lines fade a little so the newest one reads first.
            ctx.globalAlpha = i === 0 ? 1 : Math.max(0.45, 0.9 - i * 0.04);
            drawText(ctx, String(e.frames).padStart(2, ' '), x + 12, ry, { color: COLORS.dim, outline: COLORS.ink, align: 'right' });
            notation(ctx, entryLabel(e), x + 18, ry, '#ffffff');
        });
        ctx.globalAlpha = 1;
    }

    private drawMoveList(ctx: CanvasRenderingContext2D, c: CharacterDef): void {
        ctx.fillStyle = 'rgba(8,4,16,0.88)';
        ctx.fillRect(0, 0, 640, 360);
        drawText(ctx, `${c.name.toUpperCase()} · LISTE DES COUPS`, 320, 14, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, scale: 2, align: 'center' });
        const k = KEYS[0];
        drawText(ctx, `[A] LÉGER = ${keyLabel(k.light[0])}   [B] FORT = ${keyLabel(k.heavy[0])}   [C] SPÉCIAL = ${keyLabel(k.special[0])}`.replace(/\[|\]/g, ''), 320, 36, { color: COLORS.dim, align: 'center' });
        SLOT_NOTATION.forEach(([slot, input], i) => {
            const col = i < 9 ? 0 : 1;
            const row = i < 9 ? i : i - 9;
            const x = col === 0 ? 24 : 330;
            const y = 58 + row * 30;
            const move = c.moves[slot];
            const kind = move.kind === 'ultimate' ? '#ffd23f' : move.kind === 'special' ? '#9ff3ff' : '#ffffff';
            drawText(ctx, move.name.toUpperCase().slice(0, 44), x, y, { color: kind, outline: COLORS.ink });
            notation(ctx, input, x + 8, y + 12, '#cfc4dc');
        });
        hint(ctx, 'N\'IMPORTE QUELLE TOUCHE : FERMER');
    }
}

// ——— Results ———

export class ResultsScene implements Scene {
    private t = 0;
    private list: OptionList;

    constructor(private app: App, private setup: Setup, private winner: number) {
        const arcade = setup.mode === 'arcade';
        const won = winner === 0;
        if (arcade && won) {
            const done = (setup.beaten ?? 0) + 1 >= (setup.ladder?.length ?? 0);
            this.list = new OptionList(done ? ['GÉNÉRIQUE'] : ['COMBAT SUIVANT', 'MENU PRINCIPAL']);
        } else if (arcade) {
            this.list = new OptionList(['CONTINUER', 'MENU PRINCIPAL']);
        } else {
            this.list = new OptionList(['REVANCHE', 'CHANGER DE PERSONNAGES', 'MENU PRINCIPAL']);
        }
    }

    enter(): void { startMusic('results'); }

    tick(menu: MenuInput[]): void {
        this.t++;
        const r = this.list.handle(menu, this.setup.mode === 'versus' ? [0] : [0, 1]);
        if (r !== 'confirm') return;
        const item = this.list.items[this.list.index];
        const s = this.setup;
        if (item === 'REVANCHE' || item === 'CONTINUER') this.app.go(new VersusScene(this.app, s));
        else if (item === 'CHANGER DE PERSONNAGES') this.app.go(new SelectScene(this.app, s.mode, s));
        else if (item === 'MENU PRINCIPAL') this.app.go(new MainMenuScene(this.app));
        else if (item === 'COMBAT SUIVANT') {
            const beaten = (s.beaten ?? 0) + 1;
            this.app.go(new VersusScene(this.app, { ...s, beaten, p2: s.ladder![beaten], stage: randomStage() }));
        } else if (item === 'GÉNÉRIQUE') this.app.go(new EndingScene(this.app, s.p1));
    }

    draw(ctx: CanvasRenderingContext2D): void {
        const draw = this.winner === 2;
        const winId = draw ? this.setup.p1 : this.winner === 0 ? this.setup.p1 : this.setup.p2;
        const c = getChar(winId);
        menuBackdrop(ctx, this.t, this.setup.stage, 'rgba(12,4,22,0.7)');
        const art = artOf(winId, 'art');
        if (art) {
            const s = Math.min(1.9, 300 / art.height);
            ctx.drawImage(art, 330, 340 - art.height * s, art.width * s, art.height * s);
        }
        const who = this.setup.mode === 'versus' ? (this.winner === 0 ? 'J1' : 'J2') : this.winner === 0 ? 'VOUS' : 'L\'ORDINATEUR';
        drawText(ctx, draw ? 'MATCH NUL' : 'VICTOIRE', 40, 50, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, shadow: '#000', scale: 5 });
        if (!draw) {
            drawText(ctx, c.name.toUpperCase(), 40, 100, { color: c.color, outline: COLORS.ink, scale: 3 });
            drawText(ctx, who, 40, 128, { color: '#cfc4dc', outline: COLORS.ink, scale: 2 });
        }
        panel(ctx, 30, 180, 280, this.list.items.length * 22 + 20);
        menuItems(ctx, this.list.items, this.list.index, 50, 194, this.t);
    }
}

export class EndingScene implements Scene {
    private t = 0;
    constructor(private app: App, private hero: string) {}
    enter(): void { startMusic('results'); play('win'); }
    tick(menu: MenuInput[]): void {
        this.t++;
        if (this.t > 60 && menu.some((m) => m.action === 'confirm' || m.action === 'start')) this.app.go(new TitleScene(this.app));
    }
    draw(ctx: CanvasRenderingContext2D): void {
        const c = getChar(this.hero);
        menuBackdrop(ctx, this.t, 'marineford', 'rgba(40,20,0,0.5)');
        const art = artOf(this.hero, 'art');
        if (art) {
            const s = Math.min(2, 280 / art.height);
            ctx.drawImage(art, 320 - (art.width * s) / 2, 330 - art.height * s, art.width * s, art.height * s);
        }
        drawText(ctx, 'FÉLICITATIONS !', 320, 30, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, scale: 4, align: 'center' });
        drawText(ctx, `${c.name.toUpperCase()} A VAINCU TOUS SES ADVERSAIRES.`, 320, 70, { color: '#fff', outline: COLORS.ink, scale: 2, align: 'center' });
        if (this.t > 60 && this.t % 60 < 40) drawText(ctx, 'APPUYEZ SUR ENTRÉE', 320, 340, { color: '#fff', outline: COLORS.ink, align: 'center' });
    }
}

// ——— Controls ———

export class ControlsScene implements Scene {
    private t = 0;
    private page = 0;
    constructor(private app: App, private back: Scene) {}

    tick(menu: MenuInput[]): void {
        this.t++;
        for (const m of menu) {
            if (m.action === 'left' || m.action === 'right') { this.page = 1 - this.page; play('uiMove'); }
            if (m.action === 'back' || m.action === 'start') { play('uiBack'); this.app.go(this.back); return; }
            if (m.action === 'confirm') { this.page = 1 - this.page; play('uiMove'); }
        }
    }

    draw(ctx: CanvasRenderingContext2D): void {
        menuBackdrop(ctx, this.t, 'rain-dinners', 'rgba(12,4,22,0.85)');
        title(ctx, this.page === 0 ? 'COMMANDES' : 'MÉCANIQUES', 14);
        if (this.page === 0) this.drawKeys(ctx);
        else this.drawSystems(ctx);
        hint(ctx, `← → : PAGE SUIVANTE · ${keyLabel(KEYS[0].heavy[0])} / ÉCHAP : RETOUR`);
    }

    private drawKeys(ctx: CanvasRenderingContext2D): void {
        for (const side of [0, 1] as const) {
            const k = KEYS[side];
            const x = side === 0 ? 30 : 330;
            panel(ctx, x, 50, 280, 176, side === 0 ? '#ff5a3c' : '#4cc3ff');
            drawText(ctx, side === 0 ? 'JOUEUR 1 · CLAVIER' : 'JOUEUR 2 · CLAVIER', x + 12, 60, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink, scale: 1 });
            const rows: [string, string][] = [
                ['DÉPLACEMENT', `${keyLabel(k.up[0])} ${keyLabel(k.left[0])} ${keyLabel(k.down[0])} ${keyLabel(k.right[0])}`],
                ['[A] LÉGER', keyLabel(k.light[0])],
                ['[B] FORT', keyLabel(k.heavy[0])],
                ['[C] SPÉCIAL', keyLabel(k.special[0])],
                ['CHOPE [A]+[B]', keyLabel(k.throwKey[0])],
                ['ULTIME', keyLabel(k.ultimate[0])],
                ['ULTIME MAX [A]+[B]+[C]', keyLabel(k.ultimate2[0])],
                ['PAUSE', keyLabel(k.start[0])]
            ];
            rows.forEach(([label, key], i) => {
                notation(ctx, label, x + 14, 80 + i * 18, '#cfc4dc');
                drawText(ctx, key, x + 266, 80 + i * 18, { color: '#fff', outline: COLORS.ink, align: 'right' });
            });
        }
        panel(ctx, 30, 236, 580, 96, COLORS.dim);
        // Button names of the pad plugged in; none yet: Xbox names, PlayStation in brackets.
        const fam = padFamily(0) ?? padFamily(1);
        const xb = PAD_LABELS.xbox, ps = PAD_LABELS.playstation;
        const name = (k: Exclude<keyof typeof xb, 'name'>) => fam ? PAD_LABELS[fam][k] : `${xb[k]} (${ps[k]})`;
        drawText(ctx, fam ? `MANETTE · ${PAD_LABELS[fam].name}` : 'MANETTE · XBOX, PLAYSTATION, SWITCH PRO', 44, 246, { color: '#fff', gradient: COLORS.gold, outline: COLORS.ink });
        const lines = [
            `FLÈCHES OU STICK GAUCHE : DÉPLACEMENT    ${name('start')} : PAUSE`,
            `${name('west')} OU ${name('south')} : [A] LÉGER    ${name('north')} : [B] FORT    ${name('east')} : [C] SPÉCIAL`,
            `${name('l1')} : CHOPE    ${name('r1')} : ULTIME    ${name('l2')} / ${name('r2')} : ULTIME MAX`,
            'LA PREMIÈRE MANETTE BRANCHÉE JOUE J1, LA SECONDE J2 (APPUYER SUR UN BOUTON).'
        ];
        lines.forEach((l, i) => notation(ctx, l, 44, 266 + i * 18, '#cfc4dc'));
    }

    private drawSystems(ctx: CanvasRenderingContext2D): void {
        const items: [string, string][] = [
            ['GARDE', 'Maintenir la direction opposée à l\'adversaire. Debout : bloque les coups hauts. Accroupi : les coups bas.'],
            ['JAUGE DE GARDE', 'Chaque coup bloqué l\'use. Vide : garde brisée, le combattant est étourdi.'],
            ['ENCHAÎNEMENTS', '[A] [A] [A] forme une série. Un coup normal qui touche s\'annule en coup spécial.'],
            ['COUPS DIRECTIONNELS', '→ [B] passe la garde basse, ← [B] projette en l\'air, ↓ [B] fauche.'],
            ['JONGLAGES', 'Un adversaire projeté peut être frappé en l\'air, dans une certaine limite.'],
            ['CHOPE', '[A]+[B] près de l\'adversaire. Se dégage en appuyant [A]+[B] à temps.'],
            ['ULTIME', 'La jauge se remplit en frappant et en encaissant. Touche ultime (ou [B]+[C]) avec une barre pleine.'],
            ['DÉPLACEMENTS', 'Double tap avant : ruée. Double tap arrière : esquive (brièvement invulnérable).']
        ];
        items.forEach(([h, text], i) => {
            const y = 48 + i * 36;
            drawText(ctx, h, 30, y, { color: COLORS.gold, outline: COLORS.ink });
            notation(ctx, text.toUpperCase(), 30, y + 13, '#e8e0f0');
        });
    }
}
