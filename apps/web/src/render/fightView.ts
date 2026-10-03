import { play } from '../audio/sound';
import { playVoice } from '../audio/voices';
import { METER_MAX, ULTIMATE_COST, GUARD_MAX, activeHitBoxes, hurtBoxes, ultimateUsable } from '../engine/match';
import { getChar } from '../engine/registry';
import { PX, type FighterState, type GameEvent, type MatchState, type Rect } from '../engine/types';
import { settings } from '../settings';
import { drawText, textWidth } from './font';
import { artOf, drawFrame, frameOf, hasAnim, animAlpha, animBehind, animPer, type Tint } from './sprites';
import { GROUND_Y, StageRenderer, type StageDef } from './stage';
import { Vfx } from './vfx';

/**
 * Draws a match: stage, fighters, effects and HUD. Reads the engine state,
 * never writes it. The canvas is 640×360; the world is drawn at ×2 (a 320×180
 * view), the HUD at ×1 for finer text.
 */

/** One voice channel per side: a fighter's new line cuts off its previous one. */
export const voiceChannel = (side: number): string => `fighter${side}`;

interface Ghost { x: number; y: number; anim: string; frame: number; facing: 1 | -1; life: number; tint: Tint }

/** The afterimage tint closest to a character's colour: sand trails are
 *  orange, lightning cyan, magma red. */
function tintOf(color: string): Tint {
    const n = parseInt(color.slice(1), 16);
    const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 0.12) return 'white';
    let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
    h = (h * 60 + 360) % 360;
    if (h < 20 || h >= 330) return 'red';
    if (h < 48) return 'orange';
    if (h < 75) return 'gold';
    if (h < 215) return 'cyan';
    if (h < 255) return 'blue';
    return 'purple';
}

interface FighterFx {
    flash: number;
    flashTint: Tint;
    ghosts: Ghost[];
    comboHits: number;
    comboDamage: number;
    comboT: number;
    lastHealth: number;
    lastMode: string;
}

interface Banner { text: string; sub?: string; t: number; dur: number; color: string; gradient: string; scale: number }

export interface ViewOptions {
    showBoxes?: boolean;
    names?: [string, string];
    /** Hide the clock (training). */
    training?: boolean;
    inputDisplay?: boolean;
}

export class FightView {
    readonly vfx = new Vfx();
    private stage: StageRenderer;
    camX = 0;
    camY = 0;
    private t = 0;
    private fx: [FighterFx, FighterFx];
    private banners: Banner[] = [];
    private cutin: { side: number; char: string; slot: string; t: number } | null = null;
    private koFlash = 0;
    private lastAttacker = 0;

    /** Swapped by the online fight when a rollback replaces the state. */
    state: MatchState;

    constructor(state: MatchState, stageDef: StageDef, readonly options: ViewOptions = {}) {
        this.state = state;
        this.stage = new StageRenderer(stageDef, state.stageWidth / PX);
        const mk = (): FighterFx => ({ flash: 0, flashTint: 'white', ghosts: [], comboHits: 0, comboDamage: 0, comboT: 0, lastHealth: 0, lastMode: '' });
        this.fx = [mk(), mk()];
        this.snapCamera();
    }

    private snapCamera(): void {
        const [a, b] = this.state.fighters;
        const mid = (a.x + b.x) / 2 / PX;
        this.camX = Math.max(0, Math.min(this.state.stageWidth / PX - 320, mid - 160));
    }

    private sx(f: { x: number }): number { return f.x / PX; }
    private sy(f: { y: number }): number { return GROUND_Y - f.y / PX; }

    // ——— Events ———

    handle(events: GameEvent[]): void {
        const s = this.state;
        for (const e of events) {
            switch (e.type) {
                case 'hit': {
                    const x = e.x / PX;
                    const y = GROUND_Y - e.y / PX;
                    const victim = this.fx[1 - e.attacker];
                    const attacker = s.fighters[e.attacker];
                    this.lastAttacker = e.attacker;
                    if (e.damage > 0) { victim.flash = e.heavy ? 5 : 3; victim.flashTint = e.counter ? 'red' : 'white'; }
                    // The spark flies the way the blow travels, from the
                    // attacker to the victim (not where the attacker faces,
                    // which differs for projectiles and cross-ups).
                    const dir: 1 | -1 = s.fighters[1 - e.attacker].x >= attacker.x ? 1 : -1;
                    this.vfx.hit(x, y, e.spark, e.heavy, dir, e.counter);
                    if (e.shake) this.vfx.kick(e.shake);
                    if (this.options.training && e.damage > 0) this.vfx.popup(String(e.damage), x + dir * 6, y - 12, e.counter ? '#ff8a5c' : '#ffffff');
                    play(e.damage >= 100 || e.spark === 'big' ? 'hitBig' : e.heavy ? 'hitHeavy' : 'hitLight');
                    if (e.counter) play('counter');
                    if (e.sfx) play(e.sfx);
                    break;
                }
                case 'block': {
                    const victim = this.fx[1 - e.attacker];
                    victim.flash = 3;
                    victim.flashTint = 'blue';
                    const a = s.fighters[e.attacker];
                    this.vfx.block(e.x / PX, GROUND_Y - e.y / PX, s.fighters[1 - e.attacker].x >= a.x ? 1 : -1);
                    play('block');
                    break;
                }
                case 'move': {
                    const f = s.fighters[e.side];
                    this.lastAttacker = e.side;
                    const heavy = /heavy|Heavy|special|ultimate/.test(e.slot);
                    play(e.sfx ?? (heavy ? 'swingHeavy' : 'swing'));
                    if (e.slot.startsWith('ultimate')) this.vfx.ring(this.sx(f), this.sy(f) - 30, '#ffd84a', 4, 20, 2);
                    // The line starts on the move's first frame, freeze or not.
                    if (e.slot === 'ultimate' || e.slot === 'ultimate2') playVoice(f.char, e.slot === 'ultimate2' ? 'ultimateMax' : 'ultimate', voiceChannel(e.side));
                    break;
                }
                case 'fx': {
                    const f = s.fighters[e.side];
                    const atlas = hasAnim(f.char, e.anim) ? f.char : 'common';
                    this.vfx.sprite(atlas, e.anim, e.x / PX, GROUND_Y - e.y / PX, e.facing, {
                        per: animPer(atlas, e.anim), alpha: animAlpha(atlas, e.anim), behind: animBehind(atlas, e.anim)
                    });
                    if (e.sfx) play(e.sfx);
                    break;
                }
                case 'dust':
                    this.vfx.dust(e.x / PX, GROUND_Y - e.y / PX, e.big);
                    if (e.big) play('thud');
                    break;
                case 'jump':
                    play('jump');
                    break;
                case 'land':
                    if (!e.heavy) play('land');
                    break;
                case 'superFreeze': {
                    this.cutin = { side: e.side, char: e.char, slot: e.slot, t: 0 };
                    play('superFreeze');
                    break;
                }
                case 'guardCrush': {
                    const f = s.fighters[e.side];
                    this.vfx.popup('GARDE BRISÉE', this.sx(f), this.sy(f) - 70, '#7fd4ff', true);
                    this.vfx.kick(4, 0.3, '#bfe6ff');
                    this.vfx.burst(this.sx(f), this.sy(f) - 30, 20, 'shard', ['#bfe6ff', '#5ab4ff', '#fff'], 4, { gravity: 0.2, life: 30 });
                    play('crush');
                    break;
                }
                case 'throwTech':
                    this.vfx.popup('DÉGAGEMENT', e.x / PX, GROUND_Y - e.y / PX - 30, '#9ff3ff');
                    this.vfx.ring(e.x / PX, GROUND_Y - e.y / PX, '#fff', 4, 12);
                    play('tech');
                    break;
                case 'ko':
                    this.koFlash = 1;
                    this.vfx.kick(8, 0.9);
                    this.banner('K.O.', undefined, 160, '#ff4a2a', '#ffd23f', 6);
                    play('ko');
                    break;
                case 'round':
                    this.banner(e.round >= 3 && this.state.fighters.every((f) => f.wins === this.state.roundsToWin - 1) ? 'ROUND FINAL' : `ROUND ${e.round}`, undefined, 70, '#ffffff', '#ffd23f', 4);
                    play('round');
                    break;
                case 'fight':
                    if (!this.state.training) this.banner('COMBAT !', undefined, 50, '#ffd23f', '#ff6a1a', 5);
                    play('fight');
                    break;
                case 'roundEnd':
                    if (e.timeOver) this.banner('TEMPS ÉCOULÉ', undefined, 110, '#ffffff', '#9fd4ff', 4);
                    if (e.perfect) this.banner('PARFAIT !', undefined, 110, '#ffe95e', '#ff9a1f', 4);
                    break;
                case 'combo': {
                    const fx = this.fx[e.side];
                    fx.comboHits = e.hits;
                    fx.comboDamage = e.damage;
                    fx.comboT = 0;
                    break;
                }
                default:
                    break;
            }
        }
    }

    banner(text: string, sub: string | undefined, dur: number, color: string, gradient: string, scale: number): void {
        this.banners.push({ text, sub, t: 0, dur, color, gradient, scale });
    }

    // ——— Update ———

    update(): void {
        this.t++;
        const s = this.state;
        const frozen = !!s.freeze;
        if (!frozen) this.vfx.update();
        else this.vfx.shake *= 0.9;
        for (let i = 0; i < 2; i++) {
            const f = s.fighters[i];
            const fx = this.fx[i];
            if (fx.flash > 0 && !frozen) fx.flash--;
            // Afterimages while dashing, or while a move carries the fighter
            // fast (a rush, a rising uppercut), in the fighter's element.
            const rushing = f.mode === 'move' && (Math.abs(f.vx) >= 2.5 * PX || f.vy >= 3 * PX);
            const trail = f.mode === 'dash' || f.mode === 'backdash' || rushing;
            if (trail && !frozen && f.hitstop === 0 && this.t % 3 === 0) {
                const tint: Tint = f.move?.startsWith('ultimate') ? 'gold' : tintOf(getChar(f.char).color);
                fx.ghosts.push({ x: this.sx(f), y: this.sy(f), anim: f.anim, frame: f.frame, facing: f.facing, life: 12, tint });
            }
            if ((f.mode === 'dash' || f.mode === 'backdash') && fx.lastMode !== f.mode) play('dash');
            fx.lastMode = f.mode;
            for (const g of fx.ghosts) g.life--;
            fx.ghosts = fx.ghosts.filter((g) => g.life > 0);
            // The combo counter stays up a moment after the combo ends.
            const victim = s.fighters[1 - i];
            if (victim.combo === 0 || victim.mode === 'idle') fx.comboT++;
            if (f.mode === 'dizzy' && this.t % 10 === 0) {
                this.vfx.burst(this.sx(f), this.sy(f) - getChar(f.char).height, 1, 'spark', ['#ffe95e', '#fff'], 0.6, { life: 20 });
            }
            if (f.mode === 'move' && f.move?.startsWith('ultimate') && this.t % 2 === 0 && !frozen) {
                this.vfx.burst(this.sx(f), this.sy(f) - 20, 2, 'ember', ['#ffd84a', '#fff4b0', getChar(f.char).color], 1.6, { gravity: -0.06, life: 20 });
            }
        }
        if (this.cutin) {
            this.cutin.t++;
            if (!s.freeze && this.cutin.t > 20) this.cutin = null;
        }
        for (const b of this.banners) b.t++;
        this.banners = this.banners.filter((b) => b.t < b.dur);
        this.koFlash *= 0.9;

        // Camera: follow the midpoint, lift a little when someone jumps high.
        const [a, b] = s.fighters;
        const mid = (a.x + b.x) / 2 / PX;
        const target = Math.max(0, Math.min(s.stageWidth / PX - 320, mid - 160));
        this.camX += (target - this.camX) * 0.18;
        if (Math.abs(target - this.camX) < 0.25) this.camX = target;
        const high = Math.max(a.y, b.y) / PX;
        const ty = high > 70 ? -Math.min(30, (high - 70) * 0.5) : 0;
        this.camY += (ty - this.camY) * 0.12;
    }

    // ——— Drawing ———

    draw(ctx: CanvasRenderingContext2D): void {
        const s = this.state;
        ctx.save();
        ctx.setTransform(2, 0, 0, 2, 0, 0);
        // A quick decaying wobble rather than random jumps: readable, and
        // never more than a few pixels.
        const shake = settings.shake ? Math.min(6, this.vfx.shake) : 0;
        const ox = shake ? Math.round(Math.sin(this.t * 2.3) * shake * 2) / 2 : 0;
        const oy = shake ? Math.round(Math.cos(this.t * 3.1) * shake) / 2 : 0;
        const freeze = s.freeze;
        this.stage.drawBack(ctx, this.camX, this.camY, this.t, freeze ? 0.55 : 0);
        if (freeze) this.drawSpeedLines(ctx);
        ctx.translate(-Math.round(this.camX * 2) / 2 + ox, -this.camY + oy);

        // Shadows first, then the fighter who is not attacking, then the attacker.
        for (const f of s.fighters) this.drawShadow(ctx, f);
        const order = this.lastAttacker === 0 ? [1, 0] : [0, 1];
        this.vfx.drawBehind(ctx);
        for (const i of order) this.drawFighter(ctx, s.fighters[i], this.fx[i], freeze?.by === i);
        for (const p of s.projectiles) {
            const def = getChar(p.char).moves[p.def as keyof ReturnType<typeof getChar>['moves']]?.projectile;
            if (!def) continue;
            const per = Math.max(1, Math.round(60 / (def.fps ?? 15)));
            const n = Math.max(1, (getChar(p.char).manifest.anims[def.anim]?.frames.length ?? 1));
            const x = p.x / PX;
            const y = GROUND_Y - p.y / PX;
            drawFrame(ctx, p.char, def.anim, Math.floor(p.t / per) % n, x, y, p.facing);
            drawFrame(ctx, p.char, def.anim, Math.floor(p.t / per) % n, x, y, p.facing, { additive: true, alpha: 0.35 });
        }
        this.vfx.draw(ctx);
        if (this.options.showBoxes) this.drawBoxes(ctx);
        this.drawPopups(ctx);
        ctx.restore();

        if (this.vfx.flash > 0) {
            ctx.fillStyle = this.vfx.flashColor;
            ctx.globalAlpha = Math.min(0.8, this.vfx.flash);
            ctx.fillRect(0, 0, 640, 360);
            ctx.globalAlpha = 1;
        }
        if (this.cutin) this.drawCutin(ctx);
        this.drawHud(ctx);
        this.drawBanners(ctx);
    }

    private drawShadow(ctx: CanvasRenderingContext2D, f: FighterState): void {
        const x = this.sx(f);
        const h = f.y / PX;
        const w = Math.max(6, 18 - h * 0.08);
        ctx.fillStyle = `rgba(0,0,0,${Math.max(0.12, 0.38 - h * 0.003)})`;
        ctx.beginPath();
        ctx.ellipse(x, GROUND_Y + 0.5, w, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    private drawFighter(ctx: CanvasRenderingContext2D, f: FighterState, fx: FighterFx, super_: boolean): void {
        const def = getChar(f.char);
        let x = this.sx(f);
        const y = this.sy(f);
        if (f.hitstop > 0 && (f.mode === 'hitstun' || f.mode === 'juggle' || f.mode === 'blockstun' || f.mode === 'ko')) {
            x += (f.hitstop % 2 === 0 ? 1 : -1) * (f.mode === 'blockstun' ? 0.5 : 1);
        }
        for (const g of fx.ghosts) {
            drawFrame(ctx, f.char, g.anim, g.frame, g.x, g.y, g.facing, {
                tint: g.tint, alpha: (g.life / 12) * 0.45, additive: true
            });
        }
        if (super_ || (f.mode === 'move' && f.move?.startsWith('ultimate'))) {
            const pulse = 0.35 + 0.25 * Math.sin(this.t / 3);
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                drawFrame(ctx, f.char, f.anim, f.frame, x + dx, y + dy, f.facing, { tint: 'gold', alpha: pulse, additive: true });
            }
        }
        const meterReady = f.meter >= ULTIMATE_COST && f.mode !== 'ko';
        if (meterReady && this.t % 60 < 6) {
            drawFrame(ctx, f.char, f.anim, f.frame, x, y, f.facing, { tint: 'gold', alpha: 0.3, additive: true });
        }
        drawFrame(ctx, f.char, f.anim, f.frame, x, y, f.facing);
        if (fx.flash > 0) {
            drawFrame(ctx, f.char, f.anim, f.frame, x, y, f.facing, { tint: fx.flashTint, alpha: fx.flashTint === 'white' ? 0.85 : 0.55 });
        }
        if (f.mode === 'dizzy') {
            const hy = y - def.height - 6;
            for (let i = 0; i < 3; i++) {
                const a = this.t / 10 + (i * Math.PI * 2) / 3;
                drawText(ctx, '★', x + Math.cos(a) * 9 - 2, hy + Math.sin(a) * 2.5, { color: '#ffe95e', scale: 0.5 });
            }
        }
        void frameOf;
    }

    private drawSpeedLines(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,240,200,0.35)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let i = 0; i < 40; i++) {
            const a = (i / 40) * Math.PI * 2 + this.t * 0.01;
            const r0 = 60 + ((i * 37 + this.t * 7) % 60);
            ctx.moveTo(160 + Math.cos(a) * r0, 90 + Math.sin(a) * r0 * 0.6);
            ctx.lineTo(160 + Math.cos(a) * 260, 90 + Math.sin(a) * 160);
        }
        ctx.stroke();
        ctx.restore();
    }

    private drawBoxes(ctx: CanvasRenderingContext2D): void {
        const draw = (f: FighterState, r: Rect, color: string) => {
            const x0 = this.sx(f) + (f.facing === 1 ? r[0] : -(r[0] + r[2]));
            const y0 = this.sy(f) - r[1] - r[3];
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x0, y0, r[2], r[3]);
        };
        for (const f of this.state.fighters) {
            for (const r of hurtBoxes(f)) draw(f, r, f.invuln > 0 ? '#ffffff' : '#3cff6a');
            for (const r of activeHitBoxes(f)) draw(f, r, '#ff3b30');
        }
    }

    private drawPopups(ctx: CanvasRenderingContext2D): void {
        for (const p of this.vfx.popups) {
            const rise = Math.min(10, p.t * 0.6);
            const alpha = p.t > 36 ? 1 - (p.t - 36) / 14 : 1;
            ctx.globalAlpha = Math.max(0, alpha);
            drawText(ctx, p.text, p.x, p.y - rise, { color: p.color, outline: '#1a0b12', scale: p.big ? 1 : 0.5, align: 'center' });
        }
        ctx.globalAlpha = 1;
    }

    private drawCutin(ctx: CanvasRenderingContext2D): void {
        const c = this.cutin!;
        const art = artOf(c.char, 'cutin');
        const def = getChar(c.char);
        const t = c.t;
        const slide = Math.min(1, t / 10);
        const out = this.state.freeze ? 0 : Math.min(1, t / 20);
        const bandH = 96;
        const y = 132;
        const dir = c.side === 0 ? 1 : -1;
        ctx.save();
        ctx.globalAlpha = 1 - out;
        // A slanted band crossing the screen, in the fighter's colour.
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(0, y - 4, 640, bandH + 8);
        const grad = ctx.createLinearGradient(0, y, 0, y + bandH);
        grad.addColorStop(0, def.color);
        grad.addColorStop(1, '#1a0b12');
        ctx.fillStyle = grad;
        ctx.globalAlpha = (1 - out) * 0.85;
        ctx.fillRect(0, y, 640, bandH);
        ctx.globalAlpha = 1 - out;
        const max = c.slot === 'ultimate2';
        if (max) {
            // The two-bar ultimate: burning edges and a red flash behind.
            const pulse = t % 6 < 3;
            ctx.fillStyle = pulse ? '#ffd23f' : '#ff4a2a';
            ctx.fillRect(0, y - 4, 640, 3);
            ctx.fillRect(0, y + bandH + 1, 640, 3);
            if (t < 6) { ctx.fillStyle = `rgba(255,80,40,${0.35 * (1 - t / 6)})`; ctx.fillRect(0, 0, 640, 360); }
        }
        // Streaks.
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        for (let i = 0; i < 12; i++) {
            const sy = y + ((i * 29) % bandH);
            const sx = ((i * 97 + t * 24 * dir) % 800 + 800) % 800 - 80;
            ctx.fillRect(sx, sy, 60 + (i % 3) * 20, 1);
        }
        if (art) {
            const scale = Math.min(bandH / art.height, 2);
            const w = art.width * scale;
            const h = art.height * scale;
            const targetX = c.side === 0 ? 40 : 600 - w;
            const startX = c.side === 0 ? -w : 640;
            const ax = startX + (targetX - startX) * (1 - Math.pow(1 - slide, 3)) + t * 0.3 * dir;
            ctx.drawImage(art, Math.round(ax), Math.round(y + (bandH - h) / 2), Math.round(w), Math.round(h));
        }
        const move = def.moves[c.slot as 'ultimate' | 'ultimate2'] ?? def.moves.ultimate;
        const tx = c.side === 0 ? 600 : 40;
        // Long names shrink rather than run into the art on the other side.
        const title = move.name.toUpperCase();
        drawText(ctx, title, tx, y + bandH / 2 - 6, {
            color: '#ffffff', gradient: '#ffd23f', outline: '#1a0b12', scale: Math.min(2, 330 / textWidth(title)), align: c.side === 0 ? 'right' : 'left'
        });
        if (max) drawText(ctx, 'ULTIME MAX', tx, y + bandH / 2 - 20, { color: t % 8 < 4 ? '#ff7a4a' : '#ffe95e', outline: '#1a0b12', align: c.side === 0 ? 'right' : 'left' });
        drawText(ctx, def.name.toUpperCase(), tx, y + bandH / 2 + 18, { color: def.color, outline: '#000', scale: 1, align: c.side === 0 ? 'right' : 'left' });
        ctx.restore();
    }

    private drawBanners(ctx: CanvasRenderingContext2D): void {
        for (const b of this.banners) {
            const inT = Math.min(1, b.t / 8);
            const outT = b.t > b.dur - 10 ? (b.dur - b.t) / 10 : 1;
            const scale = b.scale * (inT < 1 ? 1.8 - 0.8 * inT : 1);
            ctx.globalAlpha = Math.max(0, outT);
            const s = Math.max(1, Math.round(scale));
            drawText(ctx, b.text, 320, 150 - s * 3, { color: b.color, gradient: b.gradient, outline: '#1a0b12', shadow: '#000', scale: s, align: 'center' });
            if (b.sub) drawText(ctx, b.sub, 320, 150 + s * 6, { color: '#fff', outline: '#000', scale: 2, align: 'center' });
        }
        ctx.globalAlpha = 1;
        if (this.koFlash > 0.05) {
            ctx.fillStyle = `rgba(255,255,255,${this.koFlash * 0.5})`;
            ctx.fillRect(0, 0, 640, 360);
        }
    }

    // ——— HUD ———

    private drawHud(ctx: CanvasRenderingContext2D): void {
        const s = this.state;
        const names = this.options.names ?? ['J1', 'J2'];
        for (const side of [0, 1] as const) this.drawBar(ctx, s.fighters[side], side, names[side]);
        // Clock.
        if (!this.options.training) {
            const secs = Math.ceil(s.clock / 60);
            const low = secs <= 10 && s.phase === 'fight';
            ctx.fillStyle = 'rgba(10,8,20,0.85)';
            ctx.fillRect(302, 6, 36, 28);
            ctx.strokeStyle = '#c9a55a';
            ctx.lineWidth = 1;
            ctx.strokeRect(302.5, 6.5, 35, 27);
            drawText(ctx, String(secs).padStart(2, '0'), 320, 13, {
                color: low && this.t % 30 < 15 ? '#ff5a3c' : '#ffffff', gradient: low ? '#ff5a3c' : '#ffd23f', outline: '#1a0b12', scale: 2, align: 'center'
            });
        } else {
            drawText(ctx, 'ENTRAÎNEMENT', 320, 40, { color: '#9fd4ff', outline: '#000', align: 'center' });
        }
        for (const side of [0, 1] as const) this.drawMeter(ctx, s, s.fighters[side], side);
        for (const side of [0, 1] as const) this.drawCombo(ctx, side);
    }

    private drawBar(ctx: CanvasRenderingContext2D, f: FighterState, side: 0 | 1, label: string): void {
        const def = getChar(f.char);
        const face = artOf(f.char, 'face');
        const w = 250;
        const x0 = side === 0 ? 44 : 640 - 44 - w;
        const y0 = 12;
        const h = 11;
        // Face.
        const fx = side === 0 ? 6 : 640 - 6 - 34;
        ctx.fillStyle = '#1a0b12';
        ctx.fillRect(fx - 1, 5, 36, 28);
        if (face) {
            ctx.save();
            if (side === 1) {
                ctx.translate(fx + 34, 6);
                ctx.scale(-1, 1);
                ctx.drawImage(face, 0, 0, 34, 26);
            } else ctx.drawImage(face, fx, 6, 34, 26);
            ctx.restore();
        }
        ctx.strokeStyle = def.color;
        ctx.strokeRect(fx - 0.5, 5.5, 35, 27);
        // Frame.
        ctx.fillStyle = '#1a0b12';
        ctx.fillRect(x0 - 2, y0 - 2, w + 4, h + 4);
        ctx.fillStyle = '#3b1420';
        ctx.fillRect(x0, y0, w, h);
        const ratio = f.health / def.health;
        const red = f.redHealth / def.health;
        const fill = (r: number, color: string | CanvasGradient) => {
            const len = Math.round(w * Math.max(0, Math.min(1, r)));
            ctx.fillStyle = color;
            if (side === 0) ctx.fillRect(x0 + w - len, y0, len, h);
            else ctx.fillRect(x0, y0, len, h);
        };
        fill(red, '#ff4a2a');
        const grad = ctx.createLinearGradient(0, y0, 0, y0 + h);
        const danger = ratio < 0.25;
        const pulse = danger && this.t % 40 < 20;
        grad.addColorStop(0, pulse ? '#ffb0a0' : '#fff7b0');
        grad.addColorStop(0.45, pulse ? '#ff5a3c' : '#ffd23f');
        grad.addColorStop(1, pulse ? '#b3200f' : '#e89a10');
        fill(ratio, grad);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x0, y0 + 1, w, 1);
        // Guard gauge under the bar.
        const gw = Math.round(120 * (f.guard / GUARD_MAX));
        ctx.fillStyle = '#10202e';
        ctx.fillRect(side === 0 ? x0 + w - 120 : x0, y0 + h + 3, 120, 3);
        ctx.fillStyle = f.guard < 30 ? (this.t % 20 < 10 ? '#ff5a3c' : '#5ab4ff') : '#5ab4ff';
        ctx.fillRect(side === 0 ? x0 + w - gw : x0, y0 + h + 3, gw, 3);
        // Name.
        drawText(ctx, def.name.toUpperCase(), side === 0 ? x0 : x0 + w, y0 + h + 9, { color: '#ffffff', outline: '#1a0b12', align: side === 0 ? 'left' : 'right' });
        drawText(ctx, label, side === 0 ? x0 + 4 + def.name.length * 6 + 4 : x0 + w - def.name.length * 6 - 8, y0 + h + 9, { color: side === 0 ? '#ff8a5c' : '#5ab4ff', outline: '#1a0b12', align: side === 0 ? 'left' : 'right' });
        // Round wins, next to the clock.
        for (let i = 0; i < this.state.roundsToWin; i++) {
            const won = i < f.wins;
            const cx = side === 0 ? 290 - i * 10 : 350 + i * 10;
            ctx.fillStyle = '#1a0b12';
            ctx.fillRect(cx - 4, 38, 8, 8);
            ctx.fillStyle = won ? '#ffd23f' : '#3b3040';
            ctx.fillRect(cx - 3, 39, 6, 6);
            if (won) { ctx.fillStyle = '#fff7b0'; ctx.fillRect(cx - 3, 39, 6, 2); }
        }
    }

    private drawMeter(ctx: CanvasRenderingContext2D, s: MatchState, f: FighterState, side: 0 | 1): void {
        const w = 150;
        const x0 = side === 0 ? 40 : 640 - 40 - w;
        const y0 = 340;
        const bars = METER_MAX / ULTIMATE_COST;
        ctx.fillStyle = '#1a0b12';
        ctx.fillRect(x0 - 2, y0 - 2, w + 4, 10);
        const seg = w / bars;
        for (let i = 0; i < bars; i++) {
            const v = Math.max(0, Math.min(1, (f.meter - i * ULTIMATE_COST) / ULTIMATE_COST));
            const sx = side === 0 ? x0 + i * seg : x0 + w - (i + 1) * seg;
            ctx.fillStyle = '#20183a';
            ctx.fillRect(sx + 1, y0, seg - 2, 6);
            const full = v >= 1;
            ctx.fillStyle = full ? (this.t % 16 < 8 ? '#9ff3ff' : '#4cc3ff') : '#3a6cff';
            const len = (seg - 2) * v;
            ctx.fillRect(side === 0 ? sx + 1 : sx + 1 + (seg - 2) - len, y0, len, 6);
            if (full) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(sx + 1, y0, seg - 2, 1); }
        }
        const stock = Math.floor(f.meter / ULTIMATE_COST);
        const lx = side === 0 ? x0 - 18 : x0 + w + 18;
        drawText(ctx, String(stock), lx, y0 - 6, { color: stock ? '#9ff3ff' : '#6a6a8a', outline: '#1a0b12', scale: 2, align: 'center' });
        const max = ultimateUsable(s, f, 'ultimate2');
        if (stock > 0) {
            drawText(ctx, max ? 'ULTIME MAX' : 'ULTIME', side === 0 ? x0 : x0 + w, y0 - 11, { color: this.t % 30 < 20 ? (max ? '#ff7a4a' : '#ffe95e') : '#ffffff', outline: '#1a0b12', align: side === 0 ? 'left' : 'right' });
        }
    }

    private drawCombo(ctx: CanvasRenderingContext2D, side: 0 | 1): void {
        const fx = this.fx[side];
        if (fx.comboHits < 2 || fx.comboT > 70) return;
        const x = side === 0 ? 24 : 616;
        const align = side === 0 ? 'left' : 'right';
        const pop = fx.comboT < 4 ? 3 : 2;
        const alpha = fx.comboT > 55 ? (70 - fx.comboT) / 15 : 1;
        ctx.globalAlpha = Math.max(0, alpha);
        drawText(ctx, `${fx.comboHits}`, x, 110, { color: '#ffffff', gradient: '#ffd23f', outline: '#1a0b12', scale: pop + 1, align });
        drawText(ctx, 'COUPS', side === 0 ? x : x, 110 + (pop + 1) * 7 + 6, { color: '#ffd23f', outline: '#1a0b12', scale: 2, align });
        drawText(ctx, `${fx.comboDamage} DÉGÂTS`, x, 110 + (pop + 1) * 7 + 26, { color: '#ffffff', outline: '#1a0b12', align });
        ctx.globalAlpha = 1;
    }
}
