import type { Spark } from '../engine/types';
import { animLength, drawFrame, hasAnim } from './sprites';

/**
 * Purely visual effects. Nothing here feeds back into the simulation: the
 * engine reports events, this module decorates them.
 */

interface SpriteFx {
    atlas: string;
    anim: string;
    x: number;
    y: number;
    facing: 1 | -1;
    t: number;
    /** Ticks per frame. */
    per: number;
    scale: number;
    additive: boolean;
    alpha: number;
    /** Drawn behind the fighters. */
    behind: boolean;
}

type ParticleKind = 'spark' | 'dust' | 'ember' | 'bolt' | 'shard' | 'smoke' | 'streak';

interface Particle {
    kind: ParticleKind;
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    max: number;
    color: string;
    size: number;
    gravity: number;
    drag: number;
}

interface Ring { x: number; y: number; r: number; vr: number; life: number; max: number; color: string; width: number }

/** A curved blade trail: an arc that sweeps open, then thins out. */
interface Slash { x: number; y: number; r: number; a0: number; sweep: number; life: number; max: number; color: string; width: number }

/** A taut string across the hit point, drawn as a straight line that fades. */
interface Thread { x: number; y: number; dx: number; dy: number; len: number; life: number; max: number; color: string }

interface Popup { text: string; x: number; y: number; t: number; color: string; big: boolean }

export class Vfx {
    sprites: SpriteFx[] = [];
    particles: Particle[] = [];
    rings: Ring[] = [];
    popups: Popup[] = [];
    slashes: Slash[] = [];
    threads: Thread[] = [];
    shake = 0;
    flash = 0;
    flashColor = '#fff';
    private seed = 12345;

    private rand(): number {
        this.seed = (this.seed * 16807) % 2147483647;
        return this.seed / 2147483647;
    }

    sprite(atlas: string, anim: string, x: number, y: number, facing: 1 | -1 = 1, opts: Partial<Pick<SpriteFx, 'per' | 'scale' | 'additive' | 'alpha' | 'behind'>> = {}): void {
        if (!hasAnim(atlas, anim)) return;
        this.sprites.push({
            atlas, anim, x, y, facing, t: 0, per: opts.per ?? 3, scale: opts.scale ?? 1,
            additive: opts.additive ?? false, alpha: opts.alpha ?? 1, behind: opts.behind ?? false
        });
    }

    burst(x: number, y: number, n: number, kind: ParticleKind, colors: string[], speed: number, opts: { gravity?: number; life?: number; size?: number; dir?: number; spread?: number; drag?: number } = {}): void {
        for (let i = 0; i < n; i++) {
            const spread = opts.spread ?? Math.PI * 2;
            const base = opts.dir ?? 0;
            const a = base + (this.rand() - 0.5) * spread;
            const v = speed * (0.35 + this.rand() * 0.9);
            const life = Math.round((opts.life ?? 18) * (0.6 + this.rand() * 0.7));
            this.particles.push({
                kind, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life,
                color: colors[Math.floor(this.rand() * colors.length)],
                size: (opts.size ?? 1) * (0.6 + this.rand() * 0.8), gravity: opts.gravity ?? 0, drag: opts.drag ?? 0.9
            });
        }
    }

    ring(x: number, y: number, color: string, speed = 3, life = 14, width = 1.5): void {
        this.rings.push({ x, y, r: 2, vr: speed, life, max: life, color, width });
    }

    /** A crescent cut centred on (x, y); `dir` mirrors it with the attacker. */
    slash(x: number, y: number, r: number, angle: number, sweep: number, color: string, width: number, life = 10, dir: 1 | -1 = 1): void {
        const a0 = dir === 1 ? angle : Math.PI - angle - sweep;
        this.slashes.push({ x, y, r, a0, sweep, life, max: life, color, width });
    }

    thread(x: number, y: number, angle: number, len: number, color: string, life = 14): void {
        this.threads.push({ x, y, dx: Math.cos(angle), dy: Math.sin(angle), len, life, max: life, color });
    }

    popup(text: string, x: number, y: number, color = '#ffe45e', big = false): void {
        this.popups.push({ text, x, y, t: 0, color, big });
    }

    kick(shake: number, flash = 0, color = '#fff'): void {
        this.shake = Math.max(this.shake, shake);
        if (flash > this.flash) { this.flash = flash; this.flashColor = color; }
    }

    /** Hit spark, by kind. `dir` is the attacker's facing. */
    hit(x: number, y: number, spark: Spark, heavy: boolean, dir: 1 | -1, counter: boolean): void {
        const warm = ['#fff', '#fff6b0', '#ffd23f', '#ffb020'];
        switch (spark) {
            case 'light':
                this.sprite('common', 'spark', x, y, dir, { per: 2 });
                this.burst(x, y, 6, 'streak', warm, 3.2, { dir: dir === 1 ? 0 : Math.PI, spread: 2.2, life: 8 });
                break;
            case 'heavy':
                this.sprite('common', 'sparkHeavy', x, y, dir, { per: 2 });
                this.burst(x, y, 12, 'streak', warm, 4.2, { dir: dir === 1 ? 0 : Math.PI, spread: 2.6, life: 11 });
                this.ring(x, y, '#fff', 3.2, 10, 1);
                break;
            case 'big':
                this.sprite('common', 'sparkBig', x, y, dir, { per: 3 });
                this.sprite('common', 'burst', x, y, dir, { per: 2, additive: true });
                this.burst(x, y, 22, 'streak', warm, 5.5, { life: 14 });
                this.burst(x, y, 10, 'shard', ['#fff', '#ffe28a'], 3, { gravity: 0.15, life: 26 });
                this.ring(x, y, '#fff', 4.5, 14, 2);
                this.ring(x, y, '#ffd23f', 2.6, 18, 1);
                break;
            case 'fire':
            case 'magma':
                this.sprite('common', 'sparkHeavy', x, y, dir, { per: 2 });
                this.burst(x, y, 16, 'ember', spark === 'magma' ? ['#ff3b1f', '#ff7a1a', '#ffd23f', '#8a1a0a'] : ['#ff9a1f', '#ffd23f', '#fff1a8'], 3.5, { gravity: -0.05, life: 26, size: 1.4 });
                this.burst(x, y, 5, 'smoke', ['#3a2a28', '#584040'], 0.8, { gravity: -0.04, life: 34, size: 4 });
                this.ring(x, y, '#ff8a1c', 3, 12, 1.5);
                break;
            case 'electric':
                this.sprite('common', 'spark', x, y, dir, { per: 2, additive: true });
                this.burst(x, y, 8, 'bolt', ['#ffffff', '#9ff3ff', '#ffe95e'], 4.5, { life: 9, size: 1 });
                this.burst(x, y, 10, 'spark', ['#9ff3ff', '#fff'], 3, { life: 12 });
                if (heavy) this.kick(0, 0.1, '#dff9ff');
                break;
            case 'sand':
                this.sprite('common', 'sparkHeavy', x, y, dir, { per: 2 });
                this.burst(x, y, 18, 'dust', ['#e8cf8c', '#cfae66', '#f5e4b5'], 2.6, { gravity: 0.04, life: 30, size: 2 });
                break;
            case 'cut':
                this.burst(x, y, 1, 'streak', ['#ffffff'], 0.01, { life: 10, size: 3 });
                this.burst(x, y, 10, 'streak', ['#fff', '#dff'], 5, { dir: dir === 1 ? -0.5 : Math.PI + 0.5, spread: 0.5, life: 9 });
                this.sprite('common', 'spark', x, y, dir, { per: 2 });
                break;
            case 'blade': {
                // Two crossing crescents, white core over a steel-blue edge.
                const d = dir;
                this.slash(x - d * 4, y + 2, heavy ? 20 : 15, -2.3, 2.2, '#9fc8ff', heavy ? 5 : 4, 11, d);
                this.slash(x - d * 4, y + 2, heavy ? 20 : 15, -2.3, 2.2, '#ffffff', heavy ? 2 : 1.5, 9, d);
                if (heavy) this.slash(x + d * 2, y - 4, 16, 0.6, 2.0, '#dff0ff', 2, 9, d);
                this.burst(x, y, heavy ? 14 : 8, 'streak', ['#fff', '#cfe6ff', '#7fb2ff'], 5.5, { dir: d === 1 ? -0.4 : Math.PI + 0.4, spread: 0.7, life: 10 });
                this.sprite('common', 'spark', x, y, dir, { per: 2, additive: true });
                this.ring(x, y, '#cfe6ff', 3.4, 9, 1);
                break;
            }
            case 'room': {
                // Kikoku inside the Room: a cyan arc and a thin dome ripple.
                const d = dir;
                this.slash(x - d * 3, y, heavy ? 19 : 14, -2.0, 2.4, '#3fe0ff', heavy ? 4 : 3, 11, d);
                this.slash(x - d * 3, y, heavy ? 19 : 14, -2.0, 2.4, '#e8ffff', 1.5, 9, d);
                this.burst(x, y, heavy ? 12 : 7, 'streak', ['#e8ffff', '#8ff0ff', '#3fe0ff'], 5, { dir: d === 1 ? -0.3 : Math.PI + 0.3, spread: 0.6, life: 9 });
                this.burst(x, y, 6, 'spark', ['#9ff3ff', '#ffffff'], 2, { life: 14 });
                this.ring(x, y, '#3fe0ff', 3.8, 14, 1);
                break;
            }
            case 'thread': {
                // Doflamingo's strings: a fan of taut lines through the target.
                const base = dir === 1 ? -0.35 : Math.PI + 0.35;
                const n = heavy ? 5 : 3;
                for (let i = 0; i < n; i++) {
                    const a = base + (i - (n - 1) / 2) * 0.32 + (this.rand() - 0.5) * 0.12;
                    this.thread(x, y, a, heavy ? 34 : 26, i % 2 ? '#ffb6e1' : '#ffffff', 12 + i * 2);
                }
                this.burst(x, y, 8, 'spark', ['#ff7ac8', '#ffffff', '#ffd0ec'], 3.2, { life: 12 });
                this.sprite('common', 'spark', x, y, dir, { per: 2 });
                break;
            }
            case 'ice':
                // Aokiji: frost shards and a pale ring.
                this.sprite('common', heavy ? 'sparkHeavy' : 'spark', x, y, dir, { per: 2 });
                this.burst(x, y, heavy ? 16 : 10, 'shard', ['#ffffff', '#bfefff', '#7fd4ff'], 3.4, { gravity: 0.12, life: 24, size: 1.3 });
                this.burst(x, y, 8, 'spark', ['#e8fbff', '#9fe6ff'], 2, { life: 16 });
                this.ring(x, y, '#bfefff', 3.2, 12, 1.5);
                break;
            case 'laser':
                // Kizaru: a white-gold flash and fast light needles.
                this.sprite('common', 'burst', x, y, dir, { per: 2, additive: true });
                this.burst(x, y, heavy ? 14 : 9, 'streak', ['#ffffff', '#fff6b0', '#ffe45e'], 6.5, { dir: dir === 1 ? 0 : Math.PI, spread: 1.4, life: 8 });
                this.burst(x, y, 8, 'spark', ['#fffbe0', '#ffe45e'], 2.5, { life: 14 });
                this.ring(x, y, '#fff6b0', 4, 9, 1.5);
                if (heavy) this.kick(0, 0.12, '#fffbe0');
                break;
            case 'quake':
                // Whitebeard: the air cracks, glass shards and a double shockwave.
                this.sprite('common', 'sparkBig', x, y, dir, { per: 3 });
                this.burst(x, y, heavy ? 18 : 10, 'shard', ['#ffffff', '#dfefff', '#a8c8e8'], 4, { gravity: 0.18, life: 26 });
                this.ring(x, y, '#ffffff', 5, 14, 2);
                this.ring(x, y, '#9fc8ff', 3, 20, 1);
                this.kick(heavy ? 6 : 3);
                break;
            case 'petal':
                // Robin (hands in bloom) and Hancock's kicks: petals scatter.
                this.sprite('common', 'spark', x, y, dir, { per: 2 });
                this.burst(x, y, heavy ? 16 : 10, 'shard', ['#ff9ad0', '#ffd0ea', '#c070ff', '#ffffff'], 2.6, { gravity: 0.05, life: 30, drag: 0.93 });
                break;
            case 'magnet':
                // Kid: scrap metal and a violet pull.
                this.sprite('common', 'sparkHeavy', x, y, dir, { per: 2 });
                this.burst(x, y, heavy ? 14 : 9, 'shard', ['#9aa4ad', '#6c747c', '#d0d6dc'], 3.6, { gravity: 0.2, life: 24, size: 1.4 });
                this.burst(x, y, 8, 'bolt', ['#d08cff', '#ffffff'], 3.5, { life: 8 });
                this.ring(x, y, '#b070ff', 3, 12, 1.5);
                break;
            case 'dark':
                // Blackbeard: black matter swallowing the light.
                this.sprite('common', 'sparkHeavy', x, y, dir, { per: 2 });
                this.burst(x, y, heavy ? 14 : 8, 'smoke', ['#140818', '#2a1030', '#3c1a48'], 1.6, { gravity: -0.02, life: 30, size: 4 });
                this.burst(x, y, 10, 'streak', ['#7a3a9a', '#ffffff'], 3.5, { life: 10 });
                this.ring(x, y, '#5a2070', 2.4, 16, 2);
                break;
            case 'poison':
                // Magellan: purple venom splashes and bubbles up.
                this.sprite('common', 'sparkHeavy', x, y, dir, { per: 2 });
                this.burst(x, y, heavy ? 16 : 10, 'ember', ['#9a3ad0', '#c070ff', '#5a1a80', '#e0a0ff'], 2.8, { gravity: 0.08, life: 26, size: 1.5 });
                this.burst(x, y, 4, 'smoke', ['#40184f', '#5a2a6a'], 0.7, { gravity: -0.05, life: 32, size: 4 });
                break;
            case 'paw':
                // Kuma: a paw-shaped pressure wave, the air pushed out.
                this.sprite('common', 'sparkHeavy', x, y, dir, { per: 2, additive: true });
                this.ring(x, y, '#ffffff', 4.2, 12, 2);
                this.ring(x + dir * 4, y, '#cfe6ff', 3, 16, 1);
                this.burst(x, y, heavy ? 14 : 8, 'streak', ['#ffffff', '#dfefff'], 5.5, { dir: dir === 1 ? 0 : Math.PI, spread: 0.9, life: 10 });
                break;
            case 'bluefire':
                // Marco's phoenix flames, blue and gold.
                this.sprite('common', 'sparkHeavy', x, y, dir, { per: 2, additive: true });
                this.burst(x, y, 16, 'ember', ['#3fb4ff', '#8fe0ff', '#ffe45e', '#ffffff'], 3.4, { gravity: -0.06, life: 26, size: 1.4 });
                this.ring(x, y, '#3fb4ff', 3, 12, 1.5);
                break;
            case 'love':
                // Hancock's Mero Mero: pink hearts and a stone-grey chip.
                this.sprite('common', 'spark', x, y, dir, { per: 2, additive: true });
                this.burst(x, y, heavy ? 14 : 9, 'spark', ['#ff5aa8', '#ff9ad0', '#ffffff'], 3, { gravity: -0.03, life: 22, size: 1.6 });
                this.burst(x, y, 6, 'shard', ['#a8a098', '#d0c8c0'], 2.4, { gravity: 0.15, life: 22 });
                this.ring(x, y, '#ff7ac8', 3.4, 12, 1.5);
                break;
        }
        if (counter) {
            this.popup('CONTRE !', x, y - 22, '#ff5a3c');
            this.ring(x, y, '#ff5a3c', 4, 12, 1.5);
        }
        if (heavy && spark !== 'electric') this.kick(0, 0.06);
    }

    block(x: number, y: number, dir: 1 | -1): void {
        this.sprite('common', 'block', x, y, dir, { per: 2 });
        this.burst(x, y, 8, 'spark', ['#9fd4ff', '#ffffff', '#5ab4ff'], 3, { dir: dir === 1 ? Math.PI : 0, spread: 2, life: 10 });
    }

    dust(x: number, y: number, big: boolean): void {
        this.sprite('common', 'dust', x, y, 1, { per: big ? 4 : 3, scale: big ? 1 : 0.6, alpha: 0.8 });
        this.burst(x, y - 1, big ? 12 : 5, 'dust', ['#e6dccb', '#c9bba4', '#fff'], big ? 2 : 1.2, { dir: -Math.PI / 2, spread: Math.PI, gravity: 0.05, life: 22, size: big ? 2.2 : 1.4 });
    }

    update(): void {
        for (const s of this.sprites) s.t++;
        this.sprites = this.sprites.filter((s) => s.t < animLength(s.atlas, s.anim) * s.per);
        for (const p of this.particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= p.drag;
            p.vy = p.vy * p.drag + p.gravity;
            p.life--;
        }
        this.particles = this.particles.filter((p) => p.life > 0);
        for (const r of this.rings) { r.r += r.vr; r.vr *= 0.86; r.life--; }
        this.rings = this.rings.filter((r) => r.life > 0);
        for (const s of this.slashes) s.life--;
        this.slashes = this.slashes.filter((s) => s.life > 0);
        for (const t of this.threads) t.life--;
        this.threads = this.threads.filter((t) => t.life > 0);
        for (const p of this.popups) p.t++;
        this.popups = this.popups.filter((p) => p.t < 50);
        this.shake *= 0.82;
        if (this.shake < 0.2) this.shake = 0;
        this.flash *= 0.8;
        if (this.flash < 0.02) this.flash = 0;
    }

    /** Effects that stand behind the fighters, drawn before them. */
    drawBehind(ctx: CanvasRenderingContext2D): void {
        for (const s of this.sprites) {
            if (!s.behind) continue;
            drawFrame(ctx, s.atlas, s.anim, Math.floor(s.t / s.per), s.x, s.y, s.facing, { scale: s.scale, additive: s.additive, alpha: s.alpha });
        }
    }

    /** World-space drawing (context already offset by the camera). */
    draw(ctx: CanvasRenderingContext2D): void {
        for (const s of this.sprites) {
            if (s.behind) continue;
            drawFrame(ctx, s.atlas, s.anim, Math.floor(s.t / s.per), s.x, s.y, s.facing, { scale: s.scale, additive: s.additive, alpha: s.alpha });
        }
        ctx.save();
        for (const r of this.rings) {
            ctx.globalAlpha = r.life / r.max;
            ctx.strokeStyle = r.color;
            ctx.lineWidth = r.width;
            ctx.beginPath();
            ctx.ellipse(r.x, r.y, r.r, r.r * 0.8, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        for (const s of this.slashes) {
            const k = s.life / s.max;
            // Opens over the first ticks, then thins while it fades.
            const open = Math.min(1, (1 - k) * 3 + 0.35);
            ctx.globalAlpha = Math.min(1, k * 1.6);
            ctx.strokeStyle = s.color;
            ctx.lineWidth = Math.max(0.5, s.width * k);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, s.a0, s.a0 + s.sweep * open);
            ctx.stroke();
        }
        ctx.lineCap = 'butt';
        for (const t of this.threads) {
            const k = t.life / t.max;
            // Snaps taut from the centre outwards, then fades.
            const half = (t.len / 2) * Math.min(1, (1 - k) * 4 + 0.3);
            ctx.globalAlpha = Math.min(1, k * 1.5);
            ctx.strokeStyle = t.color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(t.x - t.dx * half, t.y - t.dy * half);
            ctx.lineTo(t.x + t.dx * half, t.y + t.dy * half);
            ctx.stroke();
        }
        for (const p of this.particles) {
            const k = p.life / p.max;
            ctx.globalAlpha = p.kind === 'smoke' ? k * 0.5 : Math.min(1, k * 1.5);
            ctx.fillStyle = p.color;
            ctx.strokeStyle = p.color;
            switch (p.kind) {
                case 'streak': {
                    ctx.lineWidth = Math.max(0.5, p.size * k);
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
                    ctx.stroke();
                    break;
                }
                case 'bolt': {
                    ctx.lineWidth = 0.75;
                    ctx.beginPath();
                    let x = p.x - p.vx * 4;
                    let y = p.y - p.vy * 4;
                    ctx.moveTo(x, y);
                    for (let i = 0; i < 4; i++) {
                        x += p.vx + (this.rand() - 0.5) * 3;
                        y += p.vy + (this.rand() - 0.5) * 3;
                        ctx.lineTo(x, y);
                    }
                    ctx.stroke();
                    break;
                }
                case 'smoke':
                case 'dust': {
                    const s = p.size * (p.kind === 'smoke' ? 1 + (1 - k) * 1.5 : 1);
                    ctx.fillRect(Math.round((p.x - s / 2) * 2) / 2, Math.round((p.y - s / 2) * 2) / 2, s, s);
                    break;
                }
                default: {
                    const s = p.size;
                    ctx.fillRect(Math.round(p.x * 2) / 2, Math.round(p.y * 2) / 2, s, s);
                }
            }
        }
        ctx.restore();
    }
}
