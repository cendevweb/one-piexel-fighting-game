import manifest from '../generated/sprites/crocodile.json';
import type { CharacterDef, SpriteManifest } from '../engine/types';

/**
 * Sir Crocodile — the sand zoner, after his One Piece Gigant Battle 2 sprite
 * sheet (assets/sheets/crocodile-gb2.png). Slow on his feet, but the golden
 * hook reaches far and the desert does the rest: Desert Spada splits the
 * ground towards the foe (a low projectile), Barchan throws a crescent of
 * sand, the poisoned hook lunges across the screen in a cloud of sand, and
 * Crescent Cutlass answers jumps with a spiked crescent. His body turns to
 * sand under a blow (←H) and reforms in a burst.
 *
 * Ultimate (1 bar): Sables, a sand tornado that crawls forward and lifts
 * whoever it swallows. Ultimate max (O, 2 bars): Sables Pesado & Rasparda —
 * a compressed sandstorm sphere crushed onto the foe, then the giant sand
 * blades (Rasparda) that burst out of the ground, staged with the cut-in
 * panels of the sheet.
 *
 * Every `durations` array has exactly one entry per frame of the animation
 * it plays (see tools/sprites/chars/crocodile.json); a test checks it.
 */
export const crocodile: CharacterDef = {
    id: 'crocodile',
    name: 'Crocodile',
    title: 'Ancien Grand Corsaire',
    health: 1050,
    walk: 1.4,
    back: 1.1,
    dash: 3.8,
    backdash: [3.2, 2.4],
    jump: [2.0, 6.9],
    gravity: 0.36,
    width: 13,
    height: 70,
    crouchHeight: 48,
    color: '#d4a64a',
    manifest: manifest as unknown as SpriteManifest,
    moves: {
        lightA: {
            name: 'Paume de sable', anim: 'lightA', kind: 'normal', stance: 'stand',
            durations: [3, 3, 4, 6],
            hits: [{ frames: [1, 2], box: [8, 34, 32, 18], damage: 30, guard: 'mid', hitstun: 13, blockstun: 9, push: 10, hitstop: 6, spark: 'sand' }],
            chain: ['lightB', 'crouchLight', 'heavy', 'heavyFwd', 'heavyBack', 'crouchHeavy'], cancelable: true, sfx: 'swing'
        },
        lightB: {
            name: 'Coup de pied', anim: 'lightB', kind: 'normal', stance: 'stand',
            durations: [4, 3, 4, 7],
            hits: [{ frames: [1, 2], box: [10, 18, 38, 22], damage: 38, guard: 'mid', hitstun: 16, blockstun: 10, push: 10, hitstop: 7 }],
            chain: ['lightC', 'heavy', 'heavyFwd', 'crouchHeavy'], cancelable: true, sfx: 'swing'
        },
        lightC: {
            name: 'Crochet d\'or', anim: 'lightC', kind: 'normal', stance: 'stand',
            durations: [3, 3, 2, 3, 3, 9],
            hits: [{ frames: [2, 4], box: [14, 36, 42, 18], damage: 52, guard: 'mid', hitstun: 18, blockstun: 12, push: 18, hitstop: 9, spark: 'cut' }],
            cancelable: true, sfx: 'slash'
        },
        crouchLight: {
            name: 'Crochet bas', anim: 'crouchLight', kind: 'normal', stance: 'crouch',
            durations: [3, 4, 7],
            hits: [{ frames: [1, 1], box: [8, 2, 34, 22], damage: 26, guard: 'low', hitstun: 12, blockstun: 8, push: 8, hitstop: 6, spark: 'cut' }],
            chain: ['crouchLight', 'lightB', 'crouchHeavy'], cancelable: true, sfx: 'slash'
        },
        crouchHeavy: {
            // Ground Secco: the palm on the ground dries it, and a geyser of
            // sand bursts out right in front of him.
            name: 'Ground Secco', anim: 'crouchHeavy', kind: 'normal', stance: 'crouch',
            durations: [4, 4, 3, 3, 4, 6, 9],
            fx: [[2, 'fx_geyser', 40, 0, 'sand']],
            hits: [{ frames: [2, 4], box: [18, 0, 44, 64], damage: 68, guard: 'low', hitstun: 20, blockstun: 12, push: 12, knockdown: true, launch: [1.2, 5.2], hitstop: 10, spark: 'sand' }],
            cancelable: true
        },
        heavy: {
            name: 'Crochet d\'or — Croissant', anim: 'heavy', kind: 'normal', stance: 'stand',
            durations: [5, 4, 3, 3, 6, 9],
            hits: [{ frames: [2, 3], box: [6, 8, 58, 72], damage: 78, guard: 'mid', hitstun: 21, blockstun: 14, push: 22, hitstop: 11, spark: 'cut', shake: 2 }],
            cancelable: true, sfx: 'slashHeavy'
        },
        heavyFwd: {
            // The hook flies off on a stream of sand, rises and falls on the
            // foe from above: an overhead with reach.
            name: 'Crochet volant', anim: 'heavyFwd', kind: 'normal', stance: 'stand',
            durations: [2, 2, 2, 2, 2, 2, 2, 3, 4, 4, 5, 4, 4, 5],
            hits: [{ frames: [7, 9], box: [36, 0, 52, 64], damage: 80, guard: 'high', hitstun: 22, blockstun: 14, push: 14, hitstop: 12, spark: 'cut', shake: 3 }],
            cancelable: true, sfx: 'slash'
        },
        heavyBack: {
            // The blow goes through a body of sand, which reforms in a burst.
            name: 'Corps de sable', anim: 'heavyBack', kind: 'normal', stance: 'stand',
            durations: [3, 4, 5, 6, 6, 3, 5, 9],
            invuln: [1, 4],
            fx: [[5, 'fx_dust', 0, 0, 'sand']],
            hits: [{ frames: [5, 6], box: [-24, 0, 66, 84], damage: 64, guard: 'mid', hitstun: 22, blockstun: 12, push: 8, launch: [0.8, 6.4], hitstop: 10, spark: 'sand' }],
            cancelable: true
        },
        airLight: {
            name: 'Paume aérienne', anim: 'airLight', kind: 'normal', stance: 'air',
            durations: [3, 3, 4, 9],
            hits: [{ frames: [1, 2], box: [8, 30, 46, 26], damage: 34, guard: 'high', hitstun: 14, blockstun: 9, push: 8, hitstop: 7, spark: 'sand' }],
            chain: ['airHeavy'], cancelable: true, sfx: 'swing'
        },
        airHeavy: {
            name: 'Croissant d\'or aérien', anim: 'airHeavy', kind: 'normal', stance: 'air',
            durations: [4, 4, 3, 4, 5, 6, 8],
            hits: [{ frames: [2, 3], box: [-2, 16, 54, 76], damage: 70, guard: 'high', hitstun: 18, blockstun: 12, push: 12, hitstop: 10, spark: 'cut', shake: 2 }],
            cancelable: true, landLag: 6, sfx: 'slashHeavy'
        },
        airSpecial: {
            name: 'Croissant plongeant', anim: 'airSpecial', kind: 'special', stance: 'air',
            durations: [4, 3, 3, 3, 3, 3, 20, 5, 7, 8],
            motion: [[1, 2.6, -5.8]],
            noGravity: true, landFrame: 7,
            hits: [{ frames: [1, 7], box: [-10, -4, 36, 46], damage: 84, guard: 'high', hitstun: 20, blockstun: 14, push: 16, knockdown: true, launch: [1.6, 3.2], hitstop: 12, spark: 'cut', shake: 4 }],
            sfx: 'slash'
        },
        specialN: {
            // Desert Spada: the hand cuts down into the ground and a line of
            // sand blades runs along it towards the foe.
            name: 'Desert Spada', anim: 'specialN', kind: 'special', stance: 'stand',
            durations: [3, 3, 4, 3, 3, 4, 5, 6, 8],
            hits: [],
            projectile: {
                anim: 'fx_spada', atFrame: 4, offset: [34, 0], speed: 3.6, life: 80,
                box: [-26, 0, 42, 48], fps: 12, hits: 1,
                hit: { damage: 72, guard: 'low', hitstun: 22, blockstun: 14, push: 16, knockdown: true, launch: [1.4, 3.4], hitstop: 10, spark: 'sand', shake: 2, sfx: 'sand' }
            },
            sfx: 'sand'
        },
        specialF: {
            // The body goes to sand, slides across the ground, and the
            // poisoned hook stabs out of it.
            name: 'Crochet empoisonné', anim: 'specialF', kind: 'special', stance: 'stand',
            durations: [3, 3, 3, 3, 3, 3, 4, 7, 10],
            motion: [[0, 4.0, 0], [4, 0.8, 0], [5, 0, 0]],
            hits: [{ frames: [5, 6], box: [16, 28, 66, 24], damage: 96, guard: 'mid', hitstun: 26, blockstun: 16, push: 26, launch: [3.6, 3.0], wallBounce: true, hitstop: 14, spark: 'poison', shake: 4, sfx: 'poison' }],
            sfx: 'sand'
        },
        specialU: {
            // Crescent Cutlass: he springs up and a spiked crescent of sand
            // sweeps the air above him.
            name: 'Crescent Cutlass', anim: 'specialU', kind: 'special', stance: 'stand',
            durations: [2, 3, 3, 3, 4, 6, 10],
            motion: [[3, 1.2, 6.4]],
            invuln: [0, 3],
            fx: [[3, 'fx_crescent', 30, 70, 'sand']],
            hits: [{ frames: [3, 5], box: [-8, 30, 60, 74], damage: 100, guard: 'mid', hitstun: 24, blockstun: 16, push: 10, launch: [1.2, 7.0], hitstop: 12, spark: 'sand', shake: 4 }],
            sfx: 'slashHeavy'
        },
        specialD: {
            // Barchan: a crescent dune of sand thrown from the palm.
            name: 'Barchan', anim: 'specialD', kind: 'special', stance: 'stand',
            durations: [4, 4, 4, 3, 4, 5, 6, 8],
            hits: [],
            projectile: {
                anim: 'fx_barchan', atFrame: 3, offset: [44, 34], speed: 5.0, life: 70,
                box: [-22, -18, 40, 36], fps: 10, hits: 1,
                hit: { damage: 80, guard: 'mid', hitstun: 22, blockstun: 14, push: 22, launch: [2.4, 3.6], hitstop: 10, spark: 'sand', shake: 3, sfx: 'sand' }
            },
            sfx: 'sand'
        },
        ultimate: {
            // Sables: the cape swirls and a sand tornado crawls forward,
            // lifting the foe and hitting again and again.
            name: 'Sables', anim: 'ultimate', kind: 'ultimate', stance: 'stand',
            durations: [8, 6, 6, 8, 10, 24],
            superFreeze: 55, cost: 100, invuln: [0, 4],
            fx: [[2, 'fx_tornadoSmall', 40, 0, 'sand']],
            hits: [],
            projectile: {
                anim: 'fx_sables', atFrame: 3, offset: [24, 0], speed: 1.2, life: 150,
                box: [-40, 0, 80, 112], fps: 15, hits: 6,
                hit: { damage: 64, guard: 'mid', hitstun: 30, blockstun: 14, push: 1, launch: [0.2, 3.4], hitstop: 5, spark: 'sand', shake: 4, sfx: 'sand' }
            },
            sfx: 'sand'
        },
        ultimate2: {
            // Sables Pesado & Rasparda: a somersault slash of the golden
            // hook, the sandstorm packed into a sphere and crushed onto the
            // foe, then the giant sand blades bursting out of the ground.
            name: 'Sables Pesado & Rasparda', anim: 'ultimate2', kind: 'ultimate', stance: 'stand',
            durations: [4, 4, 4, 3, 3, 4, 3, 3, 5, 6, 6, 6, 4, 6, 4, 4, 4, 4, 4, 4, 4, 6, 10, 8, 12],
            superFreeze: 120, cost: 200, invuln: [0, 8],
            fx: [
                [12, 'fx_pesado', 60, 46, 'quake'],
                [15, 'fx_pesadoBreak', 60, 0, 'sand'],
                [15, 'fx_rocks', 60, 0],
                [21, 'fx_rasparda', 60, 0, 'sand'],
                [21, 'fx_column', 124, 0],
                [22, 'fx_column', 176, 0],
                [22, 'fx_rocks', 60, 0]
            ],
            hits: [
                { frames: [4, 5], box: [-4, 0, 66, 76], damage: 70, guard: 'mid', hitstun: 70, blockstun: 22, push: 4, hitstop: 10, spark: 'cut', shake: 4, sfx: 'slashHeavy' },
                { frames: [13, 16], box: [40, 0, 130, 120], damage: 60, guard: 'mid', hitstun: 70, blockstun: 18, push: 1, rehit: 12, hitstop: 8, spark: 'sand', shake: 8, sfx: 'quake' },
                { frames: [21, 22], box: [30, 0, 150, 140], damage: 350, guard: 'mid', hitstun: 60, blockstun: 24, push: 30, knockdown: true, launch: [4.6, 7.0], wallBounce: true, hitstop: 24, spark: 'big', shake: 14, sfx: 'sand' }
            ],
            sfx: 'sand'
        },
        throw: {
            // Ground Death: the hand that dries everything it grips.
            name: 'Ground Death — Momification', anim: 'throw', kind: 'throw', stance: 'stand',
            durations: [3, 4, 4, 5, 6, 6, 6, 6, 8, 10],
            hits: [{ frames: [1, 2], box: [6, 10, 34, 48], damage: 0, guard: 'unblockable', hitstun: 0, blockstun: 0, push: 0 }],
            fx: [[4, 'fx_dust', 30, 0, 'sand']],
            throwRelease: { frame: 7, damage: 125, launch: [1.8, 6.2] },
            sfx: 'grab'
        }
    }
};
