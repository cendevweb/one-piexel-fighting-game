import { drawText } from '../render/font';
import { stageImage } from '../render/stage';

/** Drawing helpers shared by the menus. All in 640×360 screen pixels. */

export const COLORS = {
    ink: '#1a0b12',
    gold: '#ffd23f',
    goldLight: '#fff7b0',
    red: '#e8412c',
    blue: '#4cc3ff',
    cream: '#fff4dc',
    dim: '#8a7f9a'
};

export function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accent = COLORS.gold): void {
    ctx.fillStyle = 'rgba(14,8,24,0.86)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = accent;
    ctx.fillRect(x, y, 6, 2);
    ctx.fillRect(x, y, 2, 6);
    ctx.fillRect(x + w - 6, y + h - 2, 6, 2);
    ctx.fillRect(x + w - 2, y + h - 6, 2, 6);
}

/** Animated backdrop for menus: a stage painting, darkened, with drifting stripes. */
export function menuBackdrop(ctx: CanvasRenderingContext2D, t: number, stage = 'marineford', tint = 'rgba(20,6,30,0.72)'): void {
    const img = stageImage(stage);
    if (img) {
        const w = img.width * (360 / img.height);
        const drift = (Math.sin(t / 400) + 1) * 0.5 * (w - 640);
        ctx.drawImage(img, -drift, 0, w, 360);
    }
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, 640, 360);
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#ffd23f';
    for (let i = -2; i < 14; i++) {
        const x = ((i * 70 + t * 0.6) % 980) - 160;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 26, 0);
        ctx.lineTo(x - 100, 360);
        ctx.lineTo(x - 126, 360);
        ctx.fill();
    }
    ctx.restore();
}

export function title(ctx: CanvasRenderingContext2D, text: string, y = 24): void {
    drawText(ctx, text, 320, y, { color: COLORS.cream, gradient: COLORS.gold, outline: COLORS.ink, shadow: '#000', scale: 3, align: 'center' });
}

export function hint(ctx: CanvasRenderingContext2D, text: string): void {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 344, 640, 16);
    drawText(ctx, text, 320, 348, { color: '#cfc4dc', align: 'center' });
}

export function menuItems(ctx: CanvasRenderingContext2D, items: string[], index: number, x: number, y: number, t: number, gap = 22, scale = 2, width = 280): void {
    items.forEach((item, i) => {
        const sel = i === index;
        const dx = sel ? Math.round(Math.sin(t / 8) * 2) + 6 : 0;
        if (sel) {
            ctx.fillStyle = 'rgba(255,210,63,0.16)';
            ctx.fillRect(x - 14, y + i * gap - 5, width, gap - 2);
            drawText(ctx, '»', x - 10 + dx / 2, y + i * gap, { color: COLORS.gold, outline: COLORS.ink, scale });
        }
        drawText(ctx, item, x + 8 + dx, y + i * gap, {
            color: sel ? '#ffffff' : '#bdb2cc', gradient: sel ? COLORS.gold : undefined, outline: COLORS.ink, scale
        });
    });
}

/**
 * Round pips, as on the fight HUD: `n` gold squares (8 px, 10 apart) ending
 * at `right`, `y` their top. Returns the width drawn.
 */
export function roundPips(ctx: CanvasRenderingContext2D, n: number, right: number, y: number, scale = 1): number {
    const step = 10 * scale;
    for (let r = 0; r < n; r++) {
        const x = right - (r + 1) * step + 2 * scale;
        ctx.fillStyle = COLORS.ink;
        ctx.fillRect(x, y, 8 * scale, 8 * scale);
        ctx.fillStyle = COLORS.gold;
        ctx.fillRect(x + scale, y + scale, 6 * scale, 6 * scale);
        ctx.fillStyle = COLORS.goldLight;
        ctx.fillRect(x + scale, y + scale, 6 * scale, 2 * scale);
    }
    return n * step;
}

/** A button glyph: the letter in a coloured box. */
export function buttonGlyph(ctx: CanvasRenderingContext2D, letter: string, x: number, y: number): number {
    const colors: Record<string, string> = { A: '#4c9aff', B: '#ff5a3c', C: '#ffd23f', U: '#c77dff' };
    ctx.fillStyle = colors[letter] ?? '#888';
    ctx.fillRect(x, y - 2, 11, 11);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x, y + 7, 11, 2);
    drawText(ctx, letter, x + 3, y, { color: '#1a0b12' });
    return 13;
}

/**
 * Inline notation: text in which [A] [B] [C] (and [U], the ultimate key)
 * become button glyphs.
 * Returns the width drawn.
 */
export function notation(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#ffffff'): number {
    let cx = x;
    for (const part of text.split(/(\[[ABCU]\])/)) {
        if (!part) continue;
        const m = part.match(/^\[([ABCU])\]$/);
        if (m) cx += buttonGlyph(ctx, m[1], cx, y);
        else {
            drawText(ctx, part, cx, y, { color, outline: COLORS.ink });
            cx += [...part].length * 6;
        }
    }
    return cx - x;
}
