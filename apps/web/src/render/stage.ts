import stageMeta from '../generated/stages.json';

/**
 * Stages: a painted backdrop scrolling at half speed, a floor drawn here in
 * perspective, and a few ambient particles. Everything is in world pixels
 * (320×180 screen), drawn onto a context already scaled ×2.
 */

export const GROUND_Y = 158;
/** Top edge of the floor, camera at rest. */
const FLOOR_TOP = GROUND_Y - 10;

interface StageMeta {
    /** Line of the painting pinned on the floor's top edge (fraction of its height). */
    horizon: number;
    sky: string;
}

const META = stageMeta as Record<string, StageMeta>;

export interface StageDef {
    id: string;
    name: string;
    /** Floor palette: base, light line, dark line. */
    floor: [string, string, string];
    pattern: 'planks' | 'stone' | 'sand' | 'grate' | 'moss' | 'tiles';
    ambient: 'spray' | 'leaves' | 'embers' | 'dust' | 'mist' | 'birds';
    /** Darkening applied to the backdrop so the fighters stand out. */
    dim: number;
}

export const STAGES: StageDef[] = [
    { id: 'marineford', name: 'Marineford', floor: ['#9aa2ad', '#c8ced6', '#6b7380'], pattern: 'tiles', ambient: 'spray', dim: 0.3 },
    { id: 'arlong-park', name: 'Arlong Park', floor: ['#7a5d44', '#a07c5a', '#4f3a28'], pattern: 'planks', ambient: 'spray', dim: 0.3 },
    { id: 'rain-dinners', name: 'Rain Dinners', floor: ['#e3d8ae', '#f4eccb', '#bfae7c'], pattern: 'sand', ambient: 'dust', dim: 0.3 },
    { id: 'enies-lobby', name: 'Enies Lobby', floor: ['#b99a6b', '#d4b784', '#8c7048'], pattern: 'stone', ambient: 'birds', dim: 0.3 },
    { id: 'shandora', name: 'Shandora', floor: ['#6e7a4d', '#8d9a64', '#4c5634'], pattern: 'moss', ambient: 'leaves', dim: 0.3 },
    { id: 'impel-down', name: 'Impel Down', floor: ['#4d525c', '#6c727e', '#30343b'], pattern: 'grate', ambient: 'embers', dim: 0.3 }
];

const images = new Map<string, HTMLImageElement>();

export function loadStage(id: string): Promise<void> {
    if (images.has(id)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { images.set(id, img); resolve(); };
        img.onerror = () => reject(new Error(`Décor introuvable : ${id}`));
        img.src = `${import.meta.env.BASE_URL}stages/${id}.png`;
    });
}

export const stageImage = (id: string) => images.get(id);

/** The backdrop cropped to fill a w×h box without stretching, its horizon
 *  near the bottom as in a fight. */
export function drawStageThumb(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, w: number, h: number): void {
    const img = images.get(id);
    if (!img) return;
    let sw = img.width;
    let sh = (img.width * h) / w;
    if (sh > img.height) {
        sh = img.height;
        sw = (img.height * w) / h;
    }
    const sx = (img.width - sw) / 2;
    const horizon = (META[id]?.horizon ?? 1) * img.height;
    const sy = Math.max(0, Math.min(img.height - sh, horizon - sh * 0.9));
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

interface Mote { x: number; y: number; vx: number; vy: number; life: number; size: number; phase: number }

export class StageRenderer {
    private motes: Mote[] = [];
    private seed = 1;

    constructor(readonly def: StageDef, readonly stageWidth: number) {}

    private rand(): number {
        // Visual-only randomness: never feeds the simulation.
        this.seed = (this.seed * 16807) % 2147483647;
        return this.seed / 2147483647;
    }

    /** camX: world x of the screen's left edge. */
    drawBack(ctx: CanvasRenderingContext2D, camX: number, camY: number, t: number, darken = 0): void {
        const img = images.get(this.def.id);
        const meta = META[this.def.id];
        ctx.fillStyle = meta?.sky ?? '#3a8ee6';
        ctx.fillRect(0, 0, 320, 180);
        if (img) {
            // The backdrop is 440 world px wide and scrolls at half speed;
            // its horizon sits just under the floor's dark top edge, and the
            // camera lifting on high jumps uncovers a little more below it.
            const range = this.stageWidth - 320;
            const bx = -((camX / Math.max(1, range)) * (img.width / 2 - 320));
            const by = FLOOR_TOP + 3 - (meta?.horizon ?? 1) * (img.height / 2) - camY * 0.5;
            ctx.drawImage(img, Math.round(bx * 2) / 2, Math.round(by * 2) / 2, img.width / 2, img.height / 2);
        }
        const dim = this.def.dim + darken;
        if (dim > 0) {
            ctx.fillStyle = `rgba(10,12,30,${Math.min(0.9, dim)})`;
            ctx.fillRect(0, 0, 320, 180);
        }
        this.drawFloor(ctx, camX, camY);
        this.drawAmbient(ctx, t, camX);
    }

    private drawFloor(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
        const [base, light, dark] = this.def.floor;
        const top = FLOOR_TOP - camY;
        ctx.fillStyle = base;
        ctx.fillRect(0, top, 320, 180 - top);
        // A dark edge where the floor meets the backdrop.
        ctx.fillStyle = dark;
        ctx.fillRect(0, top, 320, 1.5);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(0, top + 1.5, 320, 2);
        // Perspective: lines converge towards a vanishing point far above the
        // screen centre; horizontal lines get closer together near the back.
        const vpX = 160;
        const depth = 180 - top;
        const rows = [0, 0.14, 0.32, 0.55, 0.82, 1.15];
        ctx.fillStyle = light;
        for (const r of rows) {
            const y = top + 3 + r * depth * 0.62;
            if (y < 180) ctx.fillRect(0, Math.round(y * 2) / 2, 320, this.def.pattern === 'sand' ? 0 : 0.5);
        }
        const spacing = this.def.pattern === 'planks' ? 22 : this.def.pattern === 'grate' ? 10 : 28;
        if (this.def.pattern !== 'sand' && this.def.pattern !== 'moss') {
            ctx.strokeStyle = dark;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            const offset = -(camX % spacing);
            for (let x = offset - spacing * 8; x < 320 + spacing * 8; x += spacing) {
                const bottomX = x;
                const topX = vpX + (x - vpX) * 0.55;
                ctx.moveTo(topX, top + 3);
                ctx.lineTo(bottomX + (bottomX - vpX) * 0.35, 180);
            }
            ctx.stroke();
        }
        if (this.def.pattern === 'sand' || this.def.pattern === 'moss') {
            // Speckles that scroll with the floor.
            ctx.fillStyle = this.def.pattern === 'sand' ? dark : light;
            for (let i = 0; i < 90; i++) {
                const wx = (i * 97.3) % this.stageWidth;
                const row = (i * 37) % 23;
                const y = top + 4 + row * (depth - 6) / 23;
                const k = 0.55 + 0.45 * (row / 23);
                const x = vpX + (wx - camX - vpX) * k;
                if (x > -2 && x < 322) ctx.fillRect(Math.round(x), Math.round(y), 1, 0.5);
            }
        }
        // Soft vignette at the front of the floor.
        const g = ctx.createLinearGradient(0, top, 0, 180);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = g;
        ctx.fillRect(0, top, 320, 180 - top);
    }

    private drawAmbient(ctx: CanvasRenderingContext2D, t: number, camX: number): void {
        const kind = this.def.ambient;
        const max = kind === 'mist' ? 0 : 26;
        while (this.motes.length < max) {
            const r = this.rand();
            this.motes.push({
                x: this.rand() * 360 - 20,
                y: kind === 'embers' ? 180 + this.rand() * 20 : this.rand() * 150,
                vx: kind === 'leaves' ? 0.25 + r * 0.3 : kind === 'birds' ? 0.3 + r * 0.2 : (r - 0.5) * 0.2,
                vy: kind === 'embers' ? -0.3 - r * 0.4 : kind === 'leaves' ? 0.2 + r * 0.2 : kind === 'dust' ? 0.02 : -0.05,
                life: 200 + this.rand() * 300,
                size: kind === 'birds' ? 2 : r < 0.7 ? 0.5 : 1,
                phase: this.rand() * 6.28
            });
        }
        for (const m of this.motes) {
            m.x += m.vx + Math.sin((t + m.phase * 30) / 40) * 0.1;
            m.y += m.vy;
            m.life--;
        }
        this.motes = this.motes.filter((m) => m.life > 0 && m.y > -10 && m.y < 200 && m.x > -30 && m.x < 350);
        for (const m of this.motes) {
            const px = m.x - (camX * 0.1) % 320;
            const x = ((px % 360) + 360) % 360 - 20;
            if (kind === 'embers') ctx.fillStyle = `rgba(255,${120 + Math.floor(m.phase * 20)},40,${0.6 + 0.4 * Math.sin(t / 8 + m.phase)})`;
            else if (kind === 'leaves') ctx.fillStyle = '#9ccf5a';
            else if (kind === 'spray') ctx.fillStyle = 'rgba(230,245,255,0.5)';
            else if (kind === 'dust') ctx.fillStyle = 'rgba(255,235,190,0.45)';
            else ctx.fillStyle = 'rgba(30,30,40,0.7)';
            if (kind === 'birds') {
                const flap = Math.sin(t / 6 + m.phase) > 0 ? 1 : 0;
                const y = m.y * 0.4 + 10;
                ctx.fillRect(x, y, 1, 0.5);
                ctx.fillRect(x - 1, y - flap * 0.5, 1, 0.5);
                ctx.fillRect(x + 1, y - flap * 0.5, 1, 0.5);
            } else {
                ctx.fillRect(Math.round(x * 2) / 2, Math.round(m.y * 2) / 2, m.size, m.size);
            }
        }
    }
}
