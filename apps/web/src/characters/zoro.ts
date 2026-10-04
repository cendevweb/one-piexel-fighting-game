import manifest from '../generated/sprites/zoro.json';
import type { CharacterDef, SpriteManifest } from '../engine/types';

/**
 * Roronoa Zoro — the three-sword swordsman, rebuilt from the Gigant Battle
 * sheet "Roronoa Zoro 3" (tools/sprites/chars/zoro.json).
 *
 * Normals are his Nitōryū and Santōryū cuts; the specials are his anime
 * techniques: the Sanjūroku Pound Hō flying slash, the Oni Giri dash, the
 * rising Nobori Ryū, the Tatsumaki tornado, the Tora Gari dive and the
 * Gazami Dori crab-claw throw. The ultimate is Santōryū Ōgi Sanzen Sekai:
 * the swords spin, Zoro cuts through and the blow lands after he has passed,
 * leaving his blue afterimage and the ゴゴゴゴ. The two-bar ultimate is
 * Kyūtōryū Ashura: the three-faced cut-in over the red background, the red
 * Asura rising behind him, nine swords, then Ichibugin through the opponent.
 * The sheet's own lettering (ドン!!, ドゴォン!!!, ズバッ!!…) plays with the
 * blows it belongs to. Every `durations` array has one entry per frame.
 */
export const zoro: CharacterDef = {
    id: 'zoro',
    name: 'Zoro',
    title: 'Chasseur de pirates',
    health: 1020,
    walk: 1.6,
    back: 1.3,
    dash: 4.8,
    backdash: [3.8, 2.6],
    jump: [2.3, 7.2],
    gravity: 0.37,
    width: 12,
    height: 62,
    crouchHeight: 42,
    color: '#3f9a4a',
    manifest: manifest as unknown as SpriteManifest,
    moves: {
        lightA: {
            name: 'Coup de garde', anim: 'lightA', kind: 'normal', stance: 'stand',
            durations: [3, 2, 3, 7],
            hits: [{ frames: [1, 2], box: [4, 34, 34, 14], damage: 28, guard: 'mid', hitstun: 14, blockstun: 9, push: 6, hitstop: 6, spark: 'light' }],
            chain: ['lightB', 'crouchLight', 'heavy', 'heavyFwd', 'heavyBack', 'crouchHeavy'], cancelable: true, sfx: 'slash'
        },
        lightB: {
            name: 'Nitōryū — taille croisée', anim: 'lightB', kind: 'normal', stance: 'stand',
            durations: [3, 2, 3, 3, 5, 5],
            hits: [{ frames: [1, 2], box: [2, 12, 46, 46], damage: 36, guard: 'mid', hitstun: 16, blockstun: 10, push: 7, hitstop: 7, spark: 'cut' }],
            chain: ['lightC', 'heavy', 'heavyFwd', 'crouchHeavy'], cancelable: true, sfx: 'slash'
        },
        lightC: {
            name: 'Nitōryū — balayage', anim: 'lightC', kind: 'normal', stance: 'stand',
            durations: [4, 3, 3, 3, 3, 4, 6, 6],
            hits: [{ frames: [3, 4], box: [0, 4, 58, 40], damage: 54, guard: 'mid', hitstun: 20, blockstun: 12, push: 20, hitstop: 9, spark: 'blade', shake: 2 }],
            cancelable: true, sfx: 'slashHeavy'
        },
        crouchLight: {
            name: 'Estoc bas', anim: 'crouchLight', kind: 'normal', stance: 'crouch',
            durations: [3, 3, 6],
            hits: [{ frames: [1, 1], box: [6, 2, 40, 16], damage: 24, guard: 'low', hitstun: 12, blockstun: 8, push: 8, hitstop: 6, spark: 'cut' }],
            chain: ['crouchLight', 'lightB', 'crouchHeavy'], cancelable: true, sfx: 'slash'
        },
        crouchHeavy: {
            name: 'Fauchage rasant', anim: 'crouchHeavy', kind: 'normal', stance: 'crouch',
            durations: [5, 3, 4, 4, 10],
            hits: [{ frames: [1, 3], box: [4, 0, 54, 20], damage: 66, guard: 'low', hitstun: 20, blockstun: 12, push: 14, knockdown: true, launch: [1.2, 2.6], hitstop: 10, spark: 'blade' }],
            cancelable: true, sfx: 'slash'
        },
        heavy: {
            name: 'Santōryū — taille des trois sabres', anim: 'heavy', kind: 'normal', stance: 'stand',
            durations: [4, 5, 3, 3, 4, 5, 6, 8],
            hits: [{ frames: [2, 4], box: [0, 4, 58, 64], damage: 74, guard: 'mid', hitstun: 21, blockstun: 14, push: 20, hitstop: 11, spark: 'blade', shake: 2 }],
            cancelable: true, sfx: 'slashHeavy'
        },
        // An overhead: the step-in vertical chop of the sheet's second row.
        heavyFwd: {
            name: 'Ushi Bari', anim: 'heavyFwd', kind: 'normal', stance: 'stand',
            durations: [5, 4, 3, 3, 3, 4, 6, 6, 6],
            motion: [[2, 3.2, 0], [4, 0, 0]],
            hits: [{ frames: [3, 5], box: [0, 0, 50, 72], damage: 80, guard: 'high', hitstun: 22, blockstun: 14, push: 14, hitstop: 12, spark: 'blade', shake: 4 }],
            cancelable: true, sfx: 'slashHeavy'
        },
        // The spinning cut: lifts the opponent, then the crescent at the end.
        heavyBack: {
            name: 'Taka Nami', anim: 'heavyBack', kind: 'normal', stance: 'stand',
            durations: [4, 3, 3, 3, 3, 3, 3, 3, 3, 4, 9],
            hits: [
                { frames: [2, 4], box: [-6, 20, 46, 60], damage: 40, guard: 'mid', hitstun: 30, blockstun: 12, push: 4, launch: [0.4, 5.8], hitstop: 8, spark: 'cut' },
                { frames: [9, 9], box: [-4, 0, 60, 60], damage: 36, guard: 'mid', hitstun: 22, blockstun: 12, push: 10, launch: [1.6, 4.4], hitstop: 10, spark: 'blade' }
            ],
            invuln: [1, 2],
            cancelable: true, sfx: 'slash'
        },
        airLight: {
            name: 'Taille aérienne', anim: 'airLight', kind: 'normal', stance: 'air',
            durations: [3, 3, 10],
            hits: [{ frames: [1, 2], box: [-2, 0, 46, 44], damage: 34, guard: 'high', hitstun: 14, blockstun: 9, push: 8, hitstop: 7, spark: 'cut' }],
            chain: ['airHeavy'], cancelable: true, sfx: 'slash'
        },
        airHeavy: {
            name: 'Croissant aérien', anim: 'airHeavy', kind: 'normal', stance: 'air',
            durations: [4, 4, 4, 5, 8],
            hits: [{ frames: [1, 3], box: [-4, -8, 54, 56], damage: 66, guard: 'high', hitstun: 18, blockstun: 12, push: 12, hitstop: 10, spark: 'blade' }],
            cancelable: true, landLag: 5, sfx: 'slashHeavy'
        },
        // Upside down, the three swords first, into the ground: ズバッ!!
        airSpecial: {
            name: 'Santōryū — Tora Gari', anim: 'airSpecial', kind: 'special', stance: 'air',
            durations: [4, 3, 3, 3, 30, 5, 5, 6, 8, 8],
            motion: [[2, 2.4, -6.0]],
            noGravity: true, landFrame: 5,
            hits: [{ frames: [2, 5], box: [-8, -10, 44, 52], damage: 84, guard: 'high', hitstun: 20, blockstun: 14, push: 16, knockdown: true, launch: [1.6, 3.6], hitstop: 12, spark: 'blade', shake: 4 }],
            fx: [[5, 'fx_spark', 18, 10], [5, 'fx_zuba', 4, 66]],
            sfx: 'slashHeavy'
        },
        specialN: {
            name: 'Sanjūroku Pound Hō', anim: 'specialN', kind: 'special', stance: 'stand',
            durations: [3, 3, 3, 3, 3, 4, 5, 6, 6, 6, 6],
            hits: [],
            projectile: {
                anim: 'fx_pound', atFrame: 5, offset: [40, 34], speed: 4.6, life: 80,
                box: [-30, -12, 60, 24], fps: 12, hits: 1,
                hit: { damage: 80, guard: 'mid', hitstun: 22, blockstun: 16, push: 18, hitstop: 11, spark: 'blade', shake: 2 }
            },
            fx: [[5, 'fx_thrust', 44, 34], [6, 'fx_vo', 20, 70]],
            sfx: 'slashHeavy'
        },
        // The swords crossed in front, the one in his mouth, then the dash.
        specialF: {
            name: 'Oni Giri', anim: 'specialF', kind: 'special', stance: 'stand',
            durations: [3, 3, 3, 4, 3, 3, 3, 3, 4, 6, 8],
            motion: [[4, 9.6, 0], [6, 0, 0]],
            hits: [{ frames: [4, 6], box: [-8, 4, 56, 50], damage: 96, guard: 'mid', hitstun: 24, blockstun: 14, push: 22, launch: [3.0, 3.6], hitstop: 14, spark: 'blade', shake: 4 }],
            fx: [[6, 'fx_don', 0, 72]],
            sfx: 'slashHeavy'
        },
        // Rising flare of the swords: the reversal. ドヒュッ!!!
        specialU: {
            name: 'Nitōryū — Nobori Ryū', anim: 'specialU', kind: 'special', stance: 'stand',
            durations: [3, 3, 4, 5, 5, 6, 8, 8],
            motion: [[2, 1.0, 6.6]],
            invuln: [0, 2],
            hits: [
                { frames: [2, 3], box: [-10, 10, 50, 70], damage: 62, guard: 'mid', hitstun: 24, blockstun: 16, push: 8, launch: [0.8, 6.8], hitstop: 10, spark: 'blade', shake: 3 },
                { frames: [4, 4], box: [-10, 20, 50, 60], damage: 44, guard: 'mid', hitstun: 24, blockstun: 16, push: 10, launch: [1.2, 7.2], hitstop: 10, spark: 'big', shake: 4 }
            ],
            fx: [[2, 'fx_pillar', 6, 0]],
            sfx: 'slashHeavy'
        },
        specialD: {
            name: 'Tatsumaki', anim: 'specialD', kind: 'special', stance: 'stand',
            durations: [5, 5, 6, 6, 6, 6, 8, 8, 8],
            hits: [
                { frames: [2, 3], box: [-18, 0, 62, 80], damage: 22, guard: 'mid', hitstun: 22, blockstun: 10, push: 2, rehit: 4, hitstop: 4, spark: 'blade' },
                { frames: [4, 4], box: [-12, 0, 58, 72], damage: 56, guard: 'mid', hitstun: 26, blockstun: 16, push: 12, launch: [1.4, 6.6], hitstop: 12, spark: 'big', shake: 4 }
            ],
            fx: [[2, 'fx_wind', 4, 40]],
            sfx: 'slashHeavy'
        },
        ultimate: {
            name: 'Santōryū Ōgi — Sanzen Sekai', anim: 'ultimate', kind: 'ultimate', stance: 'stand',
            durations: [3, 3, 3, 3, 3, 4, 4, 4, 4, 3, 3, 6, 6, 6, 24, 8, 8, 8, 8],
            superFreeze: 55, cost: 100, invuln: [0, 13],
            motion: [[11, 15, 0], [13, 0, 0]],
            passThrough: [11, 13],
            hits: [
                { frames: [6, 8], box: [0, 0, 46, 64], damage: 30, guard: 'mid', hitstun: 60, blockstun: 20, push: 0, rehit: 4, hitstop: 3, spark: 'cut', shake: 2 },
                { frames: [11, 12], box: [-30, 0, 76, 70], damage: 50, guard: 'mid', hitstun: 70, blockstun: 20, push: 0, rehit: 4, hitstop: 4, spark: 'blade', shake: 3 },
                { frames: [14, 14], box: [-200, 0, 250, 100], damage: 260, guard: 'mid', hitstun: 50, blockstun: 22, push: 26, launch: [2.6, 6.2], wallBounce: true, knockdown: true, guardBreak: true, hitstop: 26, spark: 'big', shake: 10 }
            ],
            fx: [[5, 'fx_thrust', 20, 36], [13, 'fx_aura', -70, 24], [14, 'fx_gogo', -40, 76, 'menace'], [14, 'fx_burst', -44, 34]],
            sfx: 'slashHeavy'
        },
        // Two bars: the nine swords and the red Asura behind him, the rings
        // of blades, then Ichibugin cutting through.
        ultimate2: {
            name: 'Kyūtōryū Ashura — Ichibugin', anim: 'ultimate2', kind: 'ultimate', stance: 'stand',
            durations: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 6, 9, 5, 5, 4, 8, 10, 8, 8, 10],
            superFreeze: 70, cost: 200, invuln: [0, 17],
            motion: [[17, 9.5, 0], [18, 0, 0]],
            passThrough: [17, 18],
            hits: [
                { frames: [13, 13], box: [-10, 0, 74, 84], damage: 60, guard: 'mid', hitstun: 80, blockstun: 20, push: 0, rehit: 3, hitstop: 4, spark: 'blade', shake: 3 },
                { frames: [14, 15], box: [-14, 0, 84, 84], damage: 60, guard: 'mid', hitstun: 80, blockstun: 20, push: 0, rehit: 5, hitstop: 5, spark: 'blade', shake: 4 },
                { frames: [17, 17], box: [-34, 0, 96, 84], damage: 100, guard: 'mid', hitstun: 70, blockstun: 22, push: 0, hitstop: 8, spark: 'big', shake: 6 },
                { frames: [18, 18], box: [-140, 0, 150, 110], damage: 330, guard: 'mid', hitstun: 60, blockstun: 24, push: 30, launch: [3.0, 6.6], wallBounce: true, knockdown: true, hitstop: 30, spark: 'big', shake: 12 }
            ],
            fx: [
                [6, 'fx_kanon', -6, 46, 'menace'], [13, 'fx_crescent', 30, 40], [15, 'fx_burst', 36, 40],
                [17, 'fx_dust', 0, 0], [18, 'fx_crescent', -50, 40], [18, 'fx_zubaban', -50, 40], [19, 'fx_dogon', -40, 86, 'ashura']
            ],
            sfx: 'ashura'
        },
        // Gazami Dori: the two swords close like crab claws, then the cuts.
        throw: {
            name: 'Gazami Dori', anim: 'throw', kind: 'throw', stance: 'stand',
            durations: [3, 3, 4, 5, 3, 3, 3, 3, 3, 3, 4, 4, 5, 8],
            hits: [{ frames: [0, 1], box: [4, 10, 30, 40], damage: 0, guard: 'unblockable', hitstun: 0, blockstun: 0, push: 0 }],
            throwRelease: { frame: 9, damage: 110, launch: [2.6, 5.0] },
            fx: [[7, 'fx_spark', 26, 34]],
            sfx: 'grab'
        }
    }
};
