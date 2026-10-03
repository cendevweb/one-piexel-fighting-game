import { describe, expect, it } from 'vitest';
import { hasSound } from '../audio/sound';
import { ROSTER } from '../characters';

/**
 * Character data and sprite manifests are written separately (one by hand,
 * one by tools/sprites/build_atlas.py). These checks bind them together, so
 * a re-extraction that drops a frame fails here instead of on screen.
 */
const REQUIRED_ANIMS = [
    'idle', 'walk', 'dash', 'backdash', 'crouch', 'jump', 'guard', 'guardLow', 'hit', 'hitHeavy',
    'launched', 'down', 'getup', 'dizzy', 'win'
];

describe.each(ROSTER.map((c) => [c.id, c] as const))('%s', (_id, def) => {
    it('has every animation the engine plays by name', () => {
        for (const anim of REQUIRED_ANIMS) expect(def.manifest.anims[anim], anim).toBeDefined();
        expect(def.manifest.anims.jump.frames.length).toBe(4);
        expect(def.manifest.anims.launched.frames.length).toBe(3);
    });

    it('gives one duration per animation frame for every move', () => {
        for (const [slot, move] of Object.entries(def.moves)) {
            const anim = def.manifest.anims[move.anim];
            expect(anim, `${slot} → ${move.anim}`).toBeDefined();
            expect(move.durations.length, `${slot} durations`).toBe(anim.frames.length);
            for (const hit of move.hits) {
                expect(hit.frames[0], `${slot} hit start`).toBeGreaterThanOrEqual(0);
                expect(hit.frames[1], `${slot} hit end`).toBeLessThan(anim.frames.length);
            }
            for (const [frame, fx] of move.fx ?? []) {
                expect(frame).toBeLessThan(anim.frames.length);
                expect(fx.length).toBeGreaterThan(0);
            }
            if (move.projectile) {
                expect(def.manifest.anims[move.projectile.anim], `${slot} projectile`).toBeDefined();
                expect(move.projectile.atFrame).toBeLessThan(anim.frames.length);
            }
            if (move.landFrame !== undefined) expect(move.landFrame).toBeLessThan(anim.frames.length);
            if (move.throwRelease) expect(move.throwRelease.frame).toBeLessThan(anim.frames.length);
        }
    });

    it('only names sounds and effects that exist', () => {
        for (const [slot, move] of Object.entries(def.moves)) {
            const sounds = [move.sfx, move.projectile?.hit.sfx, ...move.hits.map((h) => h.sfx)];
            for (const sfx of sounds) if (sfx) expect(hasSound(sfx), `${slot} sfx ${sfx}`).toBe(true);
            for (const [, fx, , , fxSfx] of move.fx ?? []) {
                expect(def.manifest.anims[fx], `${slot} fx ${fx}`).toBeDefined();
                if (fxSfx) expect(hasSound(fxSfx), `${slot} fx sfx ${fxSfx}`).toBe(true);
            }
        }
    });

    it('has a two-bar second ultimate, stronger than the first', () => {
        const [u1, u2] = [def.moves.ultimate, def.moves.ultimate2];
        expect(u2.kind).toBe('ultimate');
        expect(u2.cost).toBe(200);
        expect(u2.superFreeze ?? 0).toBeGreaterThan(0);
        const total = (m: typeof u1) => m.hits.reduce((n, h) => n + h.damage, 0) + (m.projectile ? m.projectile.hit.damage * (m.projectile.hits ?? 1) : 0);
        expect(total(u2)).toBeGreaterThan(total(u1));
        expect(u2.anim).not.toBe(u1.anim);
    });

    it('has portraits for the menus', () => {
        for (const img of ['portrait', 'face', 'art', 'cutin']) expect(def.manifest.images[img], img).toBeDefined();
    });
});
