import commonManifest from '../generated/sprites/common.json';
import type { ManifestFrame, SpriteManifest } from '../engine/types';

/**
 * Loaded atlases, plus flat-colour silhouettes of each one for hit flashes,
 * afterimages and the ultimate's glow. Silhouettes are made once at load:
 * tinting per frame with composite operations would cost a canvas each draw.
 */

export type Tint = 'white' | 'red' | 'blue' | 'gold' | 'black' | 'cyan' | 'orange' | 'purple';

const TINTS: Record<Tint, string> = {
    white: '#ffffff', red: '#ff3b30', blue: '#5ab4ff', gold: '#ffd84a',
    black: '#000000', cyan: '#7ff6ff', orange: '#ff8a1c', purple: '#c77dff'
};

interface Atlas {
    manifest: SpriteManifest;
    image: HTMLImageElement;
    tints: Partial<Record<Tint, HTMLCanvasElement>>;
    images: Record<string, HTMLImageElement>;
}

const atlases = new Map<string, Atlas>();

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Image introuvable : ${src}`));
        img.src = `${import.meta.env.BASE_URL}${src}`;
    });
}

function silhouette(img: HTMLImageElement, color: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
}

export async function loadAtlas(manifest: SpriteManifest): Promise<void> {
    if (atlases.has(manifest.id)) return;
    const image = await loadImage(manifest.image);
    const images: Record<string, HTMLImageElement> = {};
    await Promise.all(Object.entries(manifest.images ?? {}).map(async ([name, spec]) => {
        images[name] = await loadImage(spec.src);
    }));
    atlases.set(manifest.id, { manifest, image, tints: {}, images });
}

export const loadCommon = () => loadAtlas(commonManifest as unknown as SpriteManifest);

function tinted(atlas: Atlas, tint: Tint): HTMLCanvasElement {
    let c = atlas.tints[tint];
    if (!c) {
        c = silhouette(atlas.image, TINTS[tint]);
        atlas.tints[tint] = c;
    }
    return c;
}

export function artOf(id: string, name: string): HTMLImageElement | undefined {
    return atlases.get(id)?.images[name];
}

export function frameOf(id: string, anim: string, frame: number): ManifestFrame | undefined {
    const a = atlases.get(id)?.manifest.anims[anim];
    if (!a) return undefined;
    return a.frames[Math.min(frame, a.frames.length - 1)];
}

export function animLength(id: string, anim: string): number {
    return atlases.get(id)?.manifest.anims[anim]?.frames.length ?? 0;
}

/** Opacity declared by an effect animation in its manifest (1 when absent). */
export function animAlpha(id: string, anim: string): number {
    return atlases.get(id)?.manifest.anims[anim]?.alpha ?? 1;
}

/** Ticks per frame of an effect: its manifest `fps`, else `fallback`. */
export function animPer(id: string, anim: string, fallback = 3): number {
    const fps = atlases.get(id)?.manifest.anims[anim]?.fps;
    return fps ? Math.max(1, Math.round(60 / fps)) : fallback;
}

/** Effects declared `behind` play behind the fighters. */
export function animBehind(id: string, anim: string): boolean {
    return !!atlases.get(id)?.manifest.anims[anim]?.behind;
}

export function hasAnim(id: string, anim: string): boolean {
    return !!atlases.get(id)?.manifest.anims[anim];
}

export interface DrawOptions {
    tint?: Tint;
    /** 0..1: how much of the tint covers the sprite (drawn over it). */
    tintAmount?: number;
    alpha?: number;
    scale?: number;
    /** Additive blending, for glows and afterimages. */
    additive?: boolean;
}

/**
 * Draw a frame with its anchor at (x, y). Frames are baked facing right;
 * facing -1 mirrors around the anchor.
 */
export function drawFrame(
    ctx: CanvasRenderingContext2D, id: string, anim: string, frame: number,
    x: number, y: number, facing: 1 | -1, opts: DrawOptions = {}
): void {
    const atlas = atlases.get(id);
    const f = frameOf(id, anim, frame);
    if (!atlas || !f) return;
    const [sx, sy, w, h, ax, ay] = f;
    const s = opts.scale ?? 1;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (facing === -1 || s !== 1) ctx.scale(facing * s, s);
    if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    if (opts.additive) ctx.globalCompositeOperation = 'lighter';
    const onlyTint = opts.tint && (opts.tintAmount ?? 1) >= 1;
    if (!onlyTint) ctx.drawImage(atlas.image, sx, sy, w, h, -ax, -ay, w, h);
    if (opts.tint) {
        if (!onlyTint) ctx.globalAlpha = (opts.alpha ?? 1) * (opts.tintAmount ?? 1);
        ctx.drawImage(tinted(atlas, opts.tint), sx, sy, w, h, -ax, -ay, w, h);
    }
    ctx.restore();
}
