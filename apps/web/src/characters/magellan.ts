import manifest from '../generated/sprites/magellan.json';
import type { CharacterDef, SpriteManifest } from '../engine/types';

/**
 * Magellan — directeur d'Impel Down, Doku Doku no Mi. The heavyweight of the
 * roster: slow on his feet, big health, and every special is poison. Hydra
 * sends a venom dragon across the screen, Doku Fugu swells him up like a
 * pufferfish and spits a lingering poison bomb, Doku Gumo raises a poison
 * cloud in front of him, the rising Hydra is his reversal, and the Venom
 * Demon (Jigoku no Shinpan) is the ultimate; the giant three-headed Doku
 * Hydra and its poison flood are the two-bar ultimate (O).
 *
 * Every animation and effect comes from the Gigant Battle sheet
 * (tools/sprites/chars/magellan.json): the blue swipes, the purple dragons,
 * the poison mound, splash and geyser are the sheet's own rows. Every
 * `durations` array has one entry per animation frame.
 */
export const magellan: CharacterDef = {
    id: 'magellan',
    name: 'Magellan',
    title: "Directeur d'Impel Down",
    health: 1150,
    walk: 1.1,
    back: 0.9,
    dash: 3.4,
    backdash: [2.8, 2.2],
    jump: [1.9, 6.7],
    gravity: 0.38,
    width: 17,
    height: 82,
    crouchHeight: 56,
    color: '#7a3cff',
    manifest: manifest as unknown as SpriteManifest,
    moves: {
        lightA: {
            name: 'Poing du geôlier', anim: 'lightA', kind: 'normal', stance: 'stand',
            durations: [4, 3, 4, 8],
            hits: [{ frames: [1, 2], box: [8, 34, 50, 18], damage: 34, guard: 'mid', hitstun: 15, blockstun: 9, push: 7, hitstop: 7, spark: 'light' }],
            chain: ['lightB', 'crouchLight', 'heavy', 'heavyFwd', 'heavyBack', 'crouchHeavy'], cancelable: true, sfx: 'swing'
        },
        lightB: {
            name: 'Paume de plomb', anim: 'lightB', kind: 'normal', stance: 'stand',
            durations: [4, 3, 4, 8],
            hits: [{ frames: [1, 2], box: [8, 38, 42, 22], damage: 38, guard: 'mid', hitstun: 17, blockstun: 10, push: 8, hitstop: 7, spark: 'light' }],
            chain: ['lightC', 'heavy', 'heavyFwd', 'crouchHeavy'], cancelable: true, sfx: 'swing'
        },
        lightC: {
            name: 'Charge du directeur', anim: 'lightC', kind: 'normal', stance: 'stand',
            durations: [3, 3, 3, 3, 3, 4, 5, 6, 8],
            motion: [[0, 2.6, 0], [4, 0, 0]],
            hits: [{ frames: [3, 6], box: [4, 26, 62, 36], damage: 56, guard: 'mid', hitstun: 20, blockstun: 12, push: 20, hitstop: 10, spark: 'heavy', shake: 2 }],
            cancelable: true, sfx: 'swingHeavy'
        },
        crouchLight: {
            name: 'Griffe basse', anim: 'crouchLight', kind: 'normal', stance: 'crouch',
            durations: [3, 4, 7],
            hits: [{ frames: [1, 1], box: [6, 0, 42, 26], damage: 28, guard: 'low', hitstun: 13, blockstun: 8, push: 8, hitstop: 6, spark: 'light' }],
            chain: ['crouchLight', 'lightB', 'crouchHeavy'], cancelable: true, sfx: 'swing'
        },
        crouchHeavy: {
            name: 'Fauchage venimeux', anim: 'crouchHeavy', kind: 'normal', stance: 'crouch',
            durations: [5, 4, 4, 6, 10],
            hits: [{ frames: [1, 2], box: [4, 0, 52, 34], damage: 72, guard: 'low', hitstun: 20, blockstun: 12, push: 14, knockdown: true, launch: [1.2, 2.6], hitstop: 10, spark: 'poison' }],
            cancelable: true, sfx: 'swingHeavy'
        },
        heavy: {
            name: 'Revers de la Bête', anim: 'heavy', kind: 'normal', stance: 'stand',
            durations: [3, 3, 3, 3, 3, 5, 7, 8],
            hits: [{ frames: [4, 5], box: [4, 8, 62, 66], damage: 82, guard: 'mid', hitstun: 21, blockstun: 14, push: 20, hitstop: 12, spark: 'heavy', shake: 3 }],
            cancelable: true, sfx: 'swingHeavy'
        },
        heavyFwd: {
            name: 'Couperet d\'Impel Down', anim: 'heavyFwd', kind: 'normal', stance: 'stand',
            durations: [4, 3, 3, 3, 3, 5, 9],
            hits: [{ frames: [4, 5], box: [4, 6, 64, 70], damage: 86, guard: 'high', hitstun: 22, blockstun: 14, push: 14, hitstop: 12, spark: 'heavy', shake: 4 }],
            cancelable: true, sfx: 'swingHeavy'
        },
        heavyBack: {
            name: 'Uppercut du geôlier', anim: 'heavyBack', kind: 'normal', stance: 'stand',
            durations: [2, 3, 3, 3, 5, 12],
            hits: [{ frames: [4, 5], box: [0, 30, 52, 72], damage: 66, guard: 'mid', hitstun: 22, blockstun: 12, push: 8, launch: [0.6, 6.2], hitstop: 10, spark: 'heavy' }],
            invuln: [2, 3],
            cancelable: true, sfx: 'swingHeavy'
        },
        airLight: {
            name: 'Paume aérienne', anim: 'airLight', kind: 'normal', stance: 'air',
            durations: [4, 5, 9],
            hits: [{ frames: [1, 2], box: [4, 30, 50, 30], damage: 36, guard: 'high', hitstun: 14, blockstun: 9, push: 8, hitstop: 7, spark: 'light' }],
            chain: ['airHeavy'], cancelable: true, sfx: 'swing'
        },
        airHeavy: {
            name: 'Croissant du directeur', anim: 'airHeavy', kind: 'normal', stance: 'air',
            durations: [3, 4, 3, 4, 6, 8],
            hits: [{ frames: [2, 3], box: [0, 8, 62, 72], damage: 70, guard: 'high', hitstun: 18, blockstun: 12, push: 12, hitstop: 10, spark: 'heavy' }],
            cancelable: true, landLag: 6, sfx: 'swingHeavy'
        },
        airSpecial: {
            name: 'Chute toxique', anim: 'airSpecial', kind: 'special', stance: 'air',
            durations: [4, 3, 3, 30, 5, 6, 10],
            motion: [[1, 1.8, -6.4]],
            noGravity: true, landFrame: 4,
            hits: [
                { frames: [1, 3], box: [-10, -10, 46, 60], damage: 70, guard: 'high', hitstun: 20, blockstun: 14, push: 14, hitstop: 11, spark: 'heavy', shake: 3 },
                { frames: [4, 4], box: [-34, 0, 100, 26], damage: 40, guard: 'low', hitstun: 22, blockstun: 12, push: 12, knockdown: true, launch: [1.6, 3.4], hitstop: 10, spark: 'poison', shake: 5, sfx: 'poison' }
            ],
            fx: [[4, 'fx_splash', 22, 0], [4, 'fx_splash', -22, 0]],
            sfx: 'swingHeavy'
        },
        specialN: {
            name: 'Hydra', anim: 'specialN', kind: 'special', stance: 'stand',
            durations: [3, 3, 3, 3, 3, 6, 6, 6, 6, 6, 8],
            hits: [],
            projectile: {
                anim: 'fx_hydra', atFrame: 5, offset: [60, 44], speed: 4.2, life: 90,
                box: [-44, -18, 96, 36], fps: 8, hits: 1,
                hit: { damage: 96, guard: 'mid', hitstun: 24, blockstun: 16, push: 18, knockdown: true, launch: [2.2, 3.2], hitstop: 12, spark: 'poison', shake: 3, sfx: 'poison' }
            },
            sfx: 'poison'
        },
        specialF: {
            name: 'Doku Fugu', anim: 'specialF', kind: 'special', stance: 'stand',
            durations: [2, 3, 2, 2, 2, 2, 4, 10, 22],
            hits: [],
            projectile: {
                anim: 'fx_fugu', atFrame: 6, offset: [44, 46], speed: 2.6, life: 70,
                box: [-18, -18, 35, 35], fps: 10, hits: 2, scale: 0.8,
                hit: { damage: 32, guard: 'mid', hitstun: 20, blockstun: 12, push: 6, hitstop: 7, spark: 'poison', sfx: 'poison' }
            },
            sfx: 'poison'
        },
        specialU: {
            name: 'Hydra ascendante', anim: 'specialU', kind: 'special', stance: 'stand',
            durations: [2, 2, 2, 3, 3, 3, 4, 4, 4, 6, 6, 6, 8],
            invuln: [0, 6],
            hits: [
                { frames: [3, 5], box: [-6, 20, 62, 90], damage: 42, guard: 'mid', hitstun: 24, blockstun: 14, push: 6, launch: [0.8, 5.6], hitstop: 9, spark: 'poison' },
                { frames: [6, 8], box: [-6, 30, 62, 110], damage: 64, guard: 'mid', hitstun: 26, blockstun: 16, push: 10, launch: [1.4, 7.4], hitstop: 12, spark: 'poison', shake: 4 }
            ],
            sfx: 'poison'
        },
        specialD: {
            name: 'Doku Gumo', anim: 'specialD', kind: 'special', stance: 'stand',
            durations: [4, 4, 4, 3, 10, 18, 14],
            hits: [
                { frames: [4, 5], box: [28, 0, 76, 50], damage: 20, guard: 'mid', hitstun: 24, blockstun: 12, push: 2, rehit: 7, hitstop: 4, spark: 'poison' },
                { frames: [6, 6], box: [28, 0, 76, 80], damage: 44, guard: 'mid', hitstun: 26, blockstun: 14, push: 12, knockdown: true, launch: [1.2, 5.0], hitstop: 11, spark: 'poison', shake: 3, sfx: 'poison' }
            ],
            fx: [[3, 'fx_cloud', 66, 0], [6, 'fx_pillar', 66, 0]],
            sfx: 'poison'
        },
        ultimate: {
            name: 'Venom Demon — Jigoku no Shinpan', anim: 'ultimate', kind: 'ultimate', stance: 'stand',
            durations: [4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 8, 10, 12],
            superFreeze: 55, cost: 100, invuln: [0, 12],
            hits: [
                { frames: [8, 17], box: [0, 0, 96, 100], damage: 44, guard: 'mid', hitstun: 60, blockstun: 20, push: 1, rehit: 12, hitstop: 4, spark: 'poison', shake: 2 },
                { frames: [18, 19], box: [0, 0, 100, 100], damage: 250, guard: 'mid', hitstun: 50, blockstun: 22, push: 30, launch: [5.4, 5.6], wallBounce: true, hitstop: 22, spark: 'big', shake: 10, sfx: 'poison' }
            ],
            fx: [[6, 'fx_venom', 40, 0], [18, 'fx_burst', 60, 50]],
            sfx: 'poison'
        },
        ultimate2: {
            // Doku Hydra: poison boils out of Magellan and a poison swamp
            // spreads under both fighters, the venom swells into a giant
            // three-headed hydra that bites again and again around him, then
            // the heads crash to the ground and a dragon-headed flood of
            // poison sweeps across the whole screen (sheet rows 25–31).
            name: 'Doku Hydra — la Hydre géante', anim: 'ultimate2', kind: 'ultimate', stance: 'stand',
            durations: [3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 8, 8, 8, 12],
            superFreeze: 70, cost: 200, invuln: [0, 8],
            hits: [
                { frames: [3, 7], box: [-20, 0, 64, 100], damage: 60, guard: 'mid', hitstun: 40, blockstun: 18, push: 1, hitstop: 8, spark: 'poison', shake: 4, sfx: 'poison' },
                { frames: [8, 16], box: [-40, 0, 104, 112], damage: 70, guard: 'mid', hitstun: 40, blockstun: 16, push: 1, rehit: 15, hitstop: 9, spark: 'poison', shake: 6, sfx: 'poison' },
                { frames: [17, 18], box: [0, 0, 280, 80], damage: 330, guard: 'mid', hitstun: 50, blockstun: 24, push: 30, knockdown: true, launch: [5.2, 6.0], wallBounce: true, hitstop: 24, spark: 'big', shake: 14, sfx: 'poison' }
            ],
            fx: [
                [3, 'fx_mire', 36, -8], [3, 'fx_mire', -30, -8],
                [8, 'fx_splash', 70, 0], [11, 'fx_splash', -50, 0], [14, 'fx_splash', 80, 0],
                [17, 'fx_flood', 16, 12], [17, 'fx_splash', 40, 0],
                [18, 'fx_flood', 130, 12], [18, 'fx_burst', 70, 40],
                [19, 'fx_pillar', 150, 0], [19, 'fx_pillar', 230, 0]
            ],
            sfx: 'poison'
        },
        throw: {
            name: 'Étreinte venimeuse', anim: 'throw', kind: 'throw', stance: 'stand',
            durations: [3, 4, 4, 3, 3, 6, 6, 6, 5, 5, 6, 8],
            hits: [{ frames: [0, 1], box: [4, 10, 32, 50], damage: 0, guard: 'unblockable', hitstun: 0, blockstun: 0, push: 0 }],
            throwRelease: { frame: 5, damage: 115, launch: [2.8, 4.6] },
            fx: [[5, 'fx_burst', 40, 50]],
            sfx: 'grab'
        }
    }
};
