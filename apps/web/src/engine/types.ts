/**
 * Everything the simulation reads and writes.
 *
 * The engine is a pure function of (state, inputs) → state. It never looks at
 * the clock, the DOM or the renderer, and it only does integer arithmetic on
 * positions, so the same inputs replay to the same match on any machine.
 * Positions are in subpixels: `PX` units per screen pixel.
 */

export const PX = 256;
export const FPS = 60;

/** Input bits, in screen terms. The engine converts them to forward/back. */
export const BTN = {
    up: 1 << 0,
    down: 1 << 1,
    left: 1 << 2,
    right: 1 << 3,
    light: 1 << 4,
    heavy: 1 << 5,
    special: 1 << 6,
    start: 1 << 7,
    /** The dedicated ultimate key (I, R1): the ultimate and nothing else. */
    ultimate: 1 << 8
} as const;

// ——— Sprite manifest, as written by tools/sprites/build_atlas.py ———

/** [atlasX, atlasY, w, h, anchorX, anchorY, reach]. `reach` is what the
 *  frame draws in front of the feet, [x0, y0, x1, y1] with y up, or 0. */
export type ManifestFrame = [number, number, number, number, number, number, [number, number, number, number] | 0];

export interface ManifestAnim {
    frames: ManifestFrame[];
    fps?: number;
    loop?: boolean;
    fx?: boolean;
    /** Opacity of a character effect (default 1), for see-through effects like Law's Room dome. */
    alpha?: number;
    /** Effect drawn behind the fighters (a giant spirit rising at the back). */
    behind?: boolean;
}

export interface SpriteManifest {
    id: string;
    image: string;
    anims: Record<string, ManifestAnim>;
    images: Record<string, { src: string; w: number; h: number }>;
}

// ——— Character data ———

export type Guard = 'mid' | 'low' | 'high' | 'unblockable';
/**
 * Hit spark kinds, drawn by render/vfx.ts. `cut` is a light blade nick,
 * `blade` a heavy sword crescent (Zoro), `room` Law's cyan Kikoku arc,
 * `thread` Doflamingo's crossing strings.
 */
export type Spark = 'light' | 'heavy' | 'big' | 'fire' | 'electric' | 'sand' | 'magma' | 'cut' | 'blade' | 'room' | 'thread'
    | 'ice' | 'laser' | 'quake' | 'petal' | 'magnet' | 'dark' | 'poison' | 'paw' | 'bluefire' | 'love';

/** Box relative to the fighter's feet, facing right: x forward, y up. */
export type Rect = [x: number, y: number, w: number, h: number];

export interface HitDef {
    /** Animation frames (inclusive) during which this hit is live. */
    frames: [number, number];
    /** A box, or 'auto' for what the sprite draws in front of the body. */
    box: Rect | 'auto';
    damage: number;
    guard: Guard;
    /** Ticks the victim cannot act after being hit / after blocking. */
    hitstun: number;
    blockstun: number;
    /** Pixels the victim slides away on hit (and 2/3 of that on block). */
    push: number;
    /** Hitstop, in ticks, applied to both fighters on contact. */
    hitstop?: number;
    /** Knocks the victim into the air: [vx, vy] in pixels per tick. */
    launch?: [number, number];
    /** The victim falls and lies down, even if hit on the ground. */
    knockdown?: boolean;
    /** Bounce off the wall behind the victim. */
    wallBounce?: boolean;
    /** Guarded, this blow breaks the guard outright (dizzy, no extra damage). */
    guardBreak?: boolean;
    /** Hits again every N ticks while active (rapid punches). */
    rehit?: number;
    spark?: Spark;
    /** Screen shake in pixels. */
    shake?: number;
    sfx?: string;
}

export interface ProjectileDef {
    /** Animation of the projectile, in the character manifest (fx). */
    anim: string;
    /** Spawned when the move reaches this animation frame. */
    atFrame: number;
    offset: [number, number];
    speed: number;
    /** Vertical speed in px/tick (0 for a straight shot). */
    speedY?: number;
    life: number;
    box: Rect;
    hit: Omit<HitDef, 'frames' | 'box'>;
    /** How many hits the projectile can deal before vanishing. */
    hits?: number;
    fps?: number;
    /** Drawing scale of the sprite (the box is set on its own). */
    scale?: number;
}

export type MoveKind = 'normal' | 'special' | 'ultimate' | 'throw';

export interface MoveDef {
    name: string;
    anim: string;
    /** Ticks per animation frame; one entry per frame of the animation. */
    durations: number[];
    kind: MoveKind;
    stance: 'stand' | 'crouch' | 'air';
    hits: HitDef[];
    /** Moves this one can chain into on hit or block (normals). */
    chain?: string[];
    /** Can be cancelled into a special / ultimate on hit or block. */
    cancelable?: boolean;
    /** Velocity set when entering an animation frame: [frame, vx, vy] in px/tick. */
    motion?: [number, number, number][];
    /** Animation frames (inclusive) during which the fighter cannot be hit. */
    invuln?: [number, number];
    /** Animation frames (inclusive) during which the fighter's body does not
     *  push the opponent: a dash that cuts through and ends behind. */
    passThrough?: [number, number];
    /** Air moves: gravity keeps applying unless this says otherwise. */
    noGravity?: boolean;
    /** Air moves end on landing and play this many ticks of landing lag. */
    landLag?: number;
    projectile?: ProjectileDef;
    /** Air moves that finish on the ground (a dive): on landing, jump to
     *  this animation frame and play the rest standing. */
    landFrame?: number;
    /** Throws: the grab is `hits[0]`; at this frame the victim is released. */
    throwRelease?: { frame: number; damage: number; launch: [number, number] };
    /** Meter spent (ultimate: 100 = one bar). */
    cost?: number;
    /** Freeze of the whole screen at the start, with the cut-in art. */
    superFreeze?: number;
    /** Sound on start. */
    sfx?: string;
    /** Visual effect played at a frame: [frame, fxAnim, x, y, sfx?] (fxAnim in
     *  common or character manifest; the sound, if any, plays with it). */
    fx?: ([number, string, number, number] | [number, string, number, number, string])[];
}

export interface CharacterDef {
    id: string;
    name: string;
    /** Short epithet shown on the select screen. */
    title: string;
    health: number;
    walk: number;
    back: number;
    dash: number;
    backdash: [number, number];
    jump: [number, number];
    gravity: number;
    /** Half the width of the body, for pushing and hurting. */
    width: number;
    height: number;
    crouchHeight: number;
    /** Main colour, for the UI and particles. */
    color: string;
    /** `specialB` (←S) is optional: without it, ←S plays `specialN`. */
    moves: Record<MoveSlot, MoveDef> & { specialB?: MoveDef };
    manifest: SpriteManifest;
}

/**
 * Every fighter has the same slots, bound to the same inputs:
 *
 *   L, L, L          lightA → lightB → lightC     ground chain
 *   ↓L / ↓H          crouchLight / crouchHeavy    low hits; ↓H sweeps
 *   H, →H, ←H        heavy / heavyFwd / heavyBack directional heavies
 *   air L / H / S    airLight / airHeavy / airSpecial
 *   S                specialN   (or ↓↘→ S)
 *   ←S               specialB   optional; specialN for those without one
 *   →S               specialF   (or →↓↘ S… see input.ts for the motions)
 *   ↓S               specialD
 *   ↑S               specialU   (or →↓↘ S) — the invincible reversal
 *   H + S, 1 bar     ultimate   (or ↓↘→↓↘→ S, or the ultimate key)
 *   L + H + S, 2 bars ultimate2 — the fighter's strongest technique
 *   L + H, close     throw
 */
export type MoveSlot =
    | 'lightA' | 'lightB' | 'lightC'
    | 'crouchLight' | 'crouchHeavy'
    | 'heavy' | 'heavyFwd' | 'heavyBack'
    | 'airLight' | 'airHeavy' | 'airSpecial'
    | 'specialN' | 'specialF' | 'specialU' | 'specialD'
    | 'ultimate' | 'ultimate2' | 'throw';

// ——— Runtime state ———

export type FighterMode =
    | 'intro' | 'idle' | 'walk' | 'crouch' | 'prejump' | 'air' | 'land'
    | 'dash' | 'backdash' | 'move' | 'hitstun' | 'blockstun' | 'juggle'
    | 'down' | 'getup' | 'thrown' | 'dizzy' | 'ko' | 'win' | 'lose';

export interface FighterState {
    side: 0 | 1;
    char: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** 1 facing right, -1 facing left. */
    facing: 1 | -1;
    mode: FighterMode;
    /** Ticks spent in the current mode. */
    t: number;
    /** Remaining ticks of stun, lying down, landing lag… per mode. */
    timer: number;
    anim: string;
    frame: number;
    frameT: number;
    /** Current move slot while in 'move'. */
    move: string | null;
    /** Hits of the current move that already connected (by index), with
     *  the tick they last hit for rehits. */
    hitMask: number;
    lastHitT: number;
    /** The move connected (hit or block): cancels open. */
    connected: boolean;
    projectileOut: boolean;
    crouching: boolean;
    health: number;
    /** Red part of the bar: health lost in the current combo, drained later. */
    redHealth: number;
    meter: number;
    guard: number;
    /** Ticks since the guard gauge was last hit, for regeneration. */
    guardRest: number;
    combo: number;
    comboDamage: number;
    /** `combo` when the current run of ultimate hits began: an ultimate's
     *  scaling only counts its own hits. */
    superFrom: number;
    /** The last hit taken in this combo came from an ultimate. */
    superRun: boolean;
    /** Scaling applied to the next hit of the combo this fighter is taking. */
    juggle: number;
    hitstop: number;
    invuln: number;
    /** Opponent index holding this fighter in a throw. */
    thrownBy: number;
    airActions: number;
    wins: number;
    /** Chain inputs pressed during a move, replayed when a cancel opens. */
    buffer: { slot: string; t: number } | null;
    counterHit: boolean;
    /** Frames of input history for motions: one numpad direction + buttons each. */
    history: number[];
}

export interface Projectile {
    id: number;
    owner: 0 | 1;
    char: string;
    def: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    facing: 1 | -1;
    t: number;
    hitsLeft: number;
    lastHit: number;
    dead: boolean;
}

export type MatchPhase = 'intro' | 'fight' | 'ko' | 'roundEnd' | 'matchEnd';

export interface MatchState {
    tick: number;
    phase: MatchPhase;
    phaseT: number;
    round: number;
    /** Ticks left on the clock. */
    clock: number;
    fighters: [FighterState, FighterState];
    projectiles: Projectile[];
    nextId: number;
    /** Screen-wide freeze from an ultimate: who froze it and for how long. */
    freeze: { by: number; t: number } | null;
    /** Slow motion after the KO: remaining ticks. */
    slowmo: number;
    stageWidth: number;
    winner: -1 | 0 | 1 | 2;
    roundWinner: -1 | 0 | 1 | 2;
    roundsToWin: number;
    training: boolean;
    /**
     * Training only (absent otherwise, so the online fingerprint is
     * untouched): false when the meter charges as in a real fight.
     */
    fullMeter?: boolean;
    /** Frames skipped by slow motion: sub-tick counter. */
    slowAcc: number;
    timeOver: boolean;
    perfect: boolean;
}

/** Things the renderer and the sound should know happened this tick. */
export type GameEvent =
    | { type: 'hit'; x: number; y: number; attacker: number; spark: Spark; damage: number; counter: boolean; heavy: boolean; shake: number; sfx?: string }
    | { type: 'block'; x: number; y: number; attacker: number }
    | { type: 'whiff'; side: number; heavy: boolean }
    | { type: 'move'; side: number; slot: string; sfx?: string }
    | { type: 'fx'; side: number; anim: string; x: number; y: number; facing: 1 | -1; sfx?: string }
    | { type: 'dust'; x: number; y: number; big: boolean }
    | { type: 'jump'; side: number }
    | { type: 'land'; side: number; heavy: boolean }
    | { type: 'superFreeze'; side: number; char: string; slot: string }
    | { type: 'guardCrush'; side: number }
    | { type: 'throwTech'; x: number; y: number }
    | { type: 'ko'; side: number }
    | { type: 'round'; round: number }
    | { type: 'fight' }
    | { type: 'roundEnd'; winner: number; timeOver: boolean; perfect: boolean }
    | { type: 'matchEnd'; winner: number }
    | { type: 'combo'; side: number; hits: number; damage: number };
