import {
    DOUBLE_QCF, DOUBLE_QCF_WINDOW, DP, DP_WINDOW, QCB, QCF, QCF_WINDOW, currentDir, dirOf, doubleTap, heldRun, motion,
    motionAt, numpad, pack, pressed, pressedWithin, pushHistory
} from './input';
import { getChar } from './registry';
import {
    BTN, FPS, PX,
    type CharacterDef, type FighterMode, type FighterState, type GameEvent, type HitDef,
    type MatchState, type MoveDef, type Projectile, type Rect
} from './types';

// ——— Tuning shared by every character ———

export const STAGE_WIDTH = 560;
export const SCREEN_WIDTH = 320;
/** Fighters can never be further apart than the screen allows. */
const MAX_DISTANCE = (SCREEN_WIDTH - 40) * PX;
const WALL = 18 * PX;
const ROUND_TICKS = 99 * FPS;
export const METER_MAX = 200;
export const ULTIMATE_COST = 100;
/** The second ultimate spends both bars. */
export const ULTIMATE2_COST = 200;
export const GUARD_MAX = 100;
/** Meter gains are scaled by 1/3: a little over one bar per player per round. */
const METER_GAIN_NUM = 1;
const METER_GAIN_DEN = 3;
const PREJUMP = 4;
const LAND_LAG = 3;
const DASH_TICKS = 16;
const BACKDASH_TICKS = 20;
const DOWN_TICKS = 34;
const THROW_RANGE = 26;
const THROW_TECH_WINDOW = 9;
/** Ticks a press stays wanted while the fighter cannot act yet (recovery,
 *  stun, landing, hitstop does not count): pressed a little early, a move
 *  still comes out on the first tick it can. */
export const BUFFER = 8;
/** Ticks after a normal starts during which a second button still upgrades it. */
const KARA = 3;
const GROUND_FRICTION = 0.32 * PX;
const MAX_JUGGLE = 7;
const INTRO_TICKS = 100;
const KO_TICKS = 170;
const ROUND_END_TICKS = 150;

const px = (v: number) => Math.round(v * PX);

// ——— Creation ———

export interface MatchOptions {
    roundsToWin?: number;
    training?: boolean;
    /** Training only: meter always full (default) or earned as in a real fight. */
    fullMeter?: boolean;
}

function createFighter(side: 0 | 1, char: string, x: number): FighterState {
    const def = getChar(char);
    return {
        side, char, x, y: 0, vx: 0, vy: 0,
        facing: side === 0 ? 1 : -1,
        mode: 'intro', t: 0, timer: 0,
        anim: 'idle', frame: 0, frameT: 0,
        move: null, hitMask: 0, lastHitT: 0, connected: false, projectileOut: false,
        crouching: false,
        health: def.health, redHealth: def.health,
        meter: 0, guard: GUARD_MAX, guardRest: 0,
        combo: 0, comboDamage: 0, superFrom: 0, superRun: false, juggle: 0,
        hitstop: 0, invuln: 0, thrownBy: -1, airActions: 0, wins: 0,
        buffer: null, counterHit: false, history: []
    };
}

export function createMatch(p1: string, p2: string, options: MatchOptions = {}): MatchState {
    const mid = (STAGE_WIDTH / 2) * PX;
    const state: MatchState = {
        tick: 0, phase: 'intro', phaseT: 0, round: 1, clock: ROUND_TICKS,
        fighters: [createFighter(0, p1, mid - 70 * PX), createFighter(1, p2, mid + 70 * PX)],
        projectiles: [], nextId: 1, freeze: null, slowmo: 0, slowAcc: 0,
        stageWidth: STAGE_WIDTH * PX, winner: -1, roundWinner: -1,
        roundsToWin: options.roundsToWin ?? 2, training: options.training ?? false,
        timeOver: false, perfect: false
    };
    if (state.training) {
        state.fullMeter = options.fullMeter ?? true;
        if (state.fullMeter) for (const f of state.fighters) f.meter = METER_MAX;
    }
    return state;
}

function resetRound(state: MatchState): void {
    const mid = (STAGE_WIDTH / 2) * PX;
    state.fighters.forEach((f, i) => {
        const wins = f.wins;
        const meter = f.meter;
        Object.assign(f, createFighter(i as 0 | 1, f.char, i === 0 ? mid - 70 * PX : mid + 70 * PX));
        f.wins = wins;
        f.meter = meter;
    });
    state.projectiles = [];
    state.clock = ROUND_TICKS;
    state.phase = 'intro';
    state.phaseT = 0;
    state.freeze = null;
    state.slowmo = 0;
    state.roundWinner = -1;
    state.timeOver = false;
    state.perfect = false;
}

// ——— Animation helpers ———

const moveOf = (f: FighterState): MoveDef | null => (f.move ? getChar(f.char).moves[f.move as keyof CharacterDef['moves']] : null);

function setAnim(f: FighterState, anim: string, frame = 0): void {
    if (f.anim === anim && frame === 0 && f.frame !== 0 && anim !== 'hit' && anim !== 'hitHeavy') return;
    f.anim = anim;
    f.frame = frame;
    f.frameT = 0;
}

/** Plays a non-move animation at its manifest speed. */
function tickAnim(f: FighterState, def: CharacterDef): void {
    const anim = def.manifest.anims[f.anim];
    if (!anim) return;
    const per = Math.max(1, Math.round(FPS / (anim.fps ?? 10)));
    f.frameT++;
    if (f.frameT >= per) {
        f.frameT = 0;
        if (f.frame + 1 < anim.frames.length) f.frame++;
        else if (anim.loop) f.frame = 0;
    }
}

function setMode(f: FighterState, mode: FighterMode, timer = 0): void {
    f.mode = mode;
    f.t = 0;
    f.timer = timer;
    if (mode !== 'move') {
        f.move = null;
        f.connected = false;
    }
}

// ——— Moves ———

function applyMotion(f: FighterState, move: MoveDef): void {
    for (const [frame, vx, vy] of move.motion ?? []) {
        if (frame === f.frame) {
            f.vx = px(vx) * f.facing;
            if (vy !== 0 || f.y === 0) f.vy = px(vy);
        }
    }
}

function frameEvents(state: MatchState, f: FighterState, move: MoveDef, events: GameEvent[]): void {
    for (const [frame, anim, x, y, sfx] of move.fx ?? []) {
        if (frame === f.frame) {
            events.push({ type: 'fx', side: f.side, anim, x: f.x + px(x) * f.facing, y: f.y + px(y), facing: f.facing, ...(sfx ? { sfx } : {}) });
        }
    }
    const p = move.projectile;
    if (p && p.atFrame === f.frame && !f.projectileOut) {
        const proj: Projectile = {
            id: state.nextId++, owner: f.side, char: f.char, def: f.move!,
            x: f.x + px(p.offset[0]) * f.facing, y: f.y + px(p.offset[1]),
            vx: px(p.speed) * f.facing, vy: px(p.speedY ?? 0), facing: f.facing,
            t: 0, hitsLeft: p.hits ?? 1, lastHit: -99, dead: false
        };
        state.projectiles.push(proj);
        f.projectileOut = true;
    }
}

function startMove(state: MatchState, f: FighterState, slot: string, events: GameEvent[]): void {
    const def = getChar(f.char);
    const move = def.moves[slot as keyof CharacterDef['moves']];
    if (!move) return;
    if (move.cost) {
        if (f.meter < move.cost && !freeMeter(state)) return;
        f.meter = Math.max(0, f.meter - move.cost);
        if (freeMeter(state)) f.meter = METER_MAX;
    }
    setMode(f, 'move');
    f.move = slot;
    f.anim = move.anim;
    f.frame = 0;
    f.frameT = 0;
    f.hitMask = 0;
    f.lastHitT = -99;
    f.connected = false;
    f.buffer = null;
    if (move.stance !== 'air') {
        f.vx = 0;
        f.crouching = move.stance === 'crouch';
    }
    if (move.kind === 'special' || move.kind === 'ultimate') f.airActions++;
    applyMotion(f, move);
    frameEvents(state, f, move, events);
    events.push({ type: 'move', side: f.side, slot, sfx: move.sfx });
    if (move.superFreeze) {
        state.freeze = { by: f.side, t: move.superFreeze };
        events.push({ type: 'superFreeze', side: f.side, char: f.char, slot });
    }
}

/** First animation frame at which the move can hurt. */
const firstActive = (move: MoveDef) => (move.hits.length ? Math.min(...move.hits.map((h) => h.frames[0])) : 999);
const lastActive = (move: MoveDef) => (move.hits.length ? Math.max(...move.hits.map((h) => h.frames[1])) : -1);

// ——— Reading intent from inputs ———

/** Ultimates depend only on the meter: one bar, or two for the max one. */
export function ultimateUsable(state: MatchState, f: FighterState, slot: 'ultimate' | 'ultimate2'): boolean {
    if (freeMeter(state)) return true;
    return f.meter >= (slot === 'ultimate2' ? ULTIMATE2_COST : ULTIMATE_COST);
}

function wantsUltimate(f: FighterState, state: MatchState): boolean {
    if (!ultimateUsable(state, f, 'ultimate')) return false;
    const h = f.history;
    const hs = (pressedWithin(h, BTN.heavy, 3) && pressedWithin(h, BTN.special, 3) &&
        (pressed(h, BTN.heavy) || pressed(h, BTN.special)));
    return hs || (pressed(h, BTN.special) && motion(h, DOUBLE_QCF, DOUBLE_QCF_WINDOW));
}

/** L + H + S together (the O key): the second ultimate. */
function wantsUltimate2(f: FighterState): boolean {
    const h = f.history;
    return pressedWithin(h, BTN.light, 3) && pressedWithin(h, BTN.heavy, 3) && pressedWithin(h, BTN.special, 3) &&
        (pressed(h, BTN.light) || pressed(h, BTN.heavy) || pressed(h, BTN.special));
}

function specialSlot(f: FighterState): string | null {
    const h = f.history;
    if (!pressed(h, BTN.special)) return null;
    const dp = motionAt(h, DP, DP_WINDOW);
    const qcf = motion(h, QCF, QCF_WINDOW);
    // Walking forward into ↓↘→ also reads as →↓↘: a long walk before the
    // ↓ and a stick back on → mean the quarter circle was meant.
    if (dp >= 0 && !(qcf && currentDir(h) === 6 && heldRun(h, dp, 6) > 8)) return 'specialU';
    if (qcf) return 'specialN';
    if (motion(h, QCB, QCF_WINDOW)) return 'specialD';
    const d = currentDir(h);
    if (d === 7 || d === 8 || d === 9) return 'specialU';
    if (d === 6 || d === 3) return 'specialF';
    if (d === 1 || d === 2) return 'specialD';
    return 'specialN';
}

function normalSlot(f: FighterState, air: boolean): string | null {
    const h = f.history;
    const d = currentDir(h);
    const down = d === 1 || d === 2 || d === 3;
    if (air) {
        if (pressed(h, BTN.heavy)) return 'airHeavy';
        if (pressed(h, BTN.light)) return 'airLight';
        return null;
    }
    if (pressed(h, BTN.heavy)) {
        if (down) return 'crouchHeavy';
        if (d === 6) return 'heavyFwd';
        if (d === 4) return 'heavyBack';
        return 'heavy';
    }
    if (pressed(h, BTN.light)) return down ? 'crouchLight' : 'lightA';
    return null;
}

function wantsThrow(f: FighterState): boolean {
    const h = f.history;
    return pressedWithin(h, BTN.light, 3) && pressedWithin(h, BTN.heavy, 3) &&
        (pressed(h, BTN.light) || pressed(h, BTN.heavy));
}

function throwable(state: MatchState, a: FighterState, d: FighterState): boolean {
    if (d.y > 0 || d.invuln > 0) return false;
    if (!['idle', 'walk', 'crouch', 'land', 'dash', 'move'].includes(d.mode)) return false;
    if (d.mode === 'move') {
        const m = moveOf(d);
        if (m && (m.kind === 'ultimate' || m.stance === 'air')) return false;
    }
    const gap = Math.abs(d.x - a.x) - (getChar(a.char).width + getChar(d.char).width) * PX;
    return gap <= THROW_RANGE * PX && state.phase === 'fight';
}

const isAirSlot = (slot: string) => slot === 'airLight' || slot === 'airHeavy' || slot === 'airSpecial';
const isSpecialSlot = (slot: string) => slot.startsWith('special') || slot === 'airSpecial';
const isLightSlot = (slot: string) => slot === 'lightA' || slot === 'crouchLight' || slot === 'airLight' || slot === 'throw';

/**
 * What the buttons pressed this tick ask for, read with the stick and the
 * motions of that very tick. Stored in `f.buffer` and played on the first
 * tick the fighter is free to act, so a press never depends on landing on
 * the exact tick recovery ends — nor on hitstop, during which the fighter
 * is not updated at all.
 */
function intentOf(state: MatchState, f: FighterState): string | null {
    const h = f.history;
    if (!pressed(h, BTN.light) && !pressed(h, BTN.heavy) && !pressed(h, BTN.special) && !pressed(h, BTN.ultimate)) return null;
    const def = getChar(f.char);
    const has = (slot: string) => !!def.moves[slot as keyof CharacterDef['moves']];
    // The ultimate key only ever asks for the ultimate: when it cannot be
    // used (meter, one per round) it does nothing, never a special.
    if (pressed(h, BTN.ultimate)) return ultimateUsable(state, f, 'ultimate') && has('ultimate') ? 'ultimate' : null;
    // Three buttons ask for the second ultimate only: short of two bars
    // they do nothing, rather than spend one bar on the first.
    if (wantsUltimate2(f)) return ultimateUsable(state, f, 'ultimate2') && has('ultimate2') ? 'ultimate2' : null;
    if (wantsUltimate(f, state)) return 'ultimate';
    if (f.y > 0 || f.mode === 'air' || f.mode === 'prejump') {
        if (pressed(h, BTN.special)) return f.mode === 'prejump' ? 'specialU' : has('airSpecial') ? 'airSpecial' : null;
        return normalSlot(f, true);
    }
    if (wantsThrow(f)) return 'throw';
    const sp = specialSlot(f);
    if (sp && has(sp)) return sp;
    return normalSlot(f, false);
}

function canStart(state: MatchState, f: FighterState, slot: string): boolean {
    const move = getChar(f.char).moves[slot as keyof CharacterDef['moves']];
    if (!move) return false;
    if (slot === 'ultimate' || slot === 'ultimate2') return ultimateUsable(state, f, slot);
    return !move.cost || freeMeter(state) || f.meter >= move.cost;
}

/** Starts the buffered move if `ok` accepts it. */
function useBuffer(state: MatchState, f: FighterState, events: GameEvent[], ok: (slot: string) => boolean): boolean {
    const slot = f.buffer?.slot;
    if (!slot || state.phase !== 'fight' || !ok(slot) || !canStart(state, f, slot)) return false;
    startMove(state, f, slot, events);
    return true;
}

/** Try every action a free fighter on the ground can take. Out of range the
 *  grab still comes out and whiffs, so the button always answers with the
 *  throw and never with a stray jab. */
function groundActions(state: MatchState, f: FighterState, _o: FighterState, events: GameEvent[]): boolean {
    return useBuffer(state, f, events, (slot) => !isAirSlot(slot));
}

/** The move a buffered press cancels the current one into, if any. */
function cancelInto(f: FighterState, move: MoveDef, want: string): string | null {
    const def = getChar(f.char);
    const has = (slot: string) => !!def.moves[slot as keyof CharacterDef['moves']];
    if (want === 'ultimate' || want === 'ultimate2') {
        return move.kind !== 'ultimate' && (move.cancelable || move.kind === 'special') && has(want) ? want : null;
    }
    if (isSpecialSlot(want)) {
        if (!move.cancelable || f.airActions >= 2) return null;
        const slot = f.y > 0 ? 'airSpecial' : want === 'airSpecial' ? 'specialN' : want;
        return has(slot) ? slot : null;
    }
    if (!move.chain) return null;
    if (move.chain.includes(want)) return want;
    // Pressing L again during the L chain means "next link", whatever the
    // stick says: lightA → lightB → lightC.
    if (isLightSlot(want)) return move.chain.find((c) => c.startsWith('light')) ?? null;
    return null;
}

// ——— Blocking ———

/** Holding away from the attacker, and how. */
function guardDir(f: FighterState, attackerX: number): 'stand' | 'crouch' | null {
    const d = currentDir(f.history);
    // The history is relative to the fighter's facing; blocking is relative
    // to the attacker, which differs only on a cross-up.
    const towards = attackerX > f.x ? 1 : -1;
    const backIsLeft = towards === 1;
    const raw = f.history.length ? f.history[f.history.length - 1] >> 4 : 0;
    const holdingBack = backIsLeft ? (raw & BTN.left) !== 0 && (raw & BTN.right) === 0
        : (raw & BTN.right) !== 0 && (raw & BTN.left) === 0;
    if (!holdingBack) return null;
    return d === 1 || d === 2 || d === 3 || (raw & BTN.down) !== 0 ? 'crouch' : 'stand';
}

function canBlock(f: FighterState, hit: { guard: string }, attackerX: number): boolean {
    if (f.y > 0) return false;
    if (!['idle', 'walk', 'crouch', 'blockstun', 'land'].includes(f.mode)) return false;
    if (hit.guard === 'unblockable') return false;
    const g = guardDir(f, attackerX);
    if (!g) return false;
    if (hit.guard === 'low') return g === 'crouch';
    if (hit.guard === 'high') return g === 'stand';
    return true;
}

/** An attack or projectile is coming: the fighter holding back stops and guards. */
function threatened(state: MatchState, f: FighterState, o: FighterState): boolean {
    const dist = Math.abs(o.x - f.x);
    if (o.mode === 'move' && dist < 150 * PX) {
        const m = moveOf(o);
        if (m && m.hits.length && o.frame <= lastActive(m)) return true;
    }
    return state.projectiles.some((p) => p.owner !== f.side && !p.dead && Math.abs(p.x - f.x) < 110 * PX);
}

// ——— Boxes ———

interface WorldBox { x0: number; y0: number; x1: number; y1: number }

function worldBox(f: FighterState, r: Rect): WorldBox {
    const [bx, by, bw, bh] = r;
    const xa = f.x + px(bx) * f.facing;
    const xb = f.x + px(bx + bw) * f.facing;
    return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: f.y + px(by), y1: f.y + px(by + bh) };
}

const overlap = (a: WorldBox, b: WorldBox) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function reachOf(def: CharacterDef, f: FighterState): Rect | null {
    const frame = def.manifest.anims[f.anim]?.frames[f.frame];
    const r = frame?.[6];
    if (!r) return null;
    return [r[0], r[1], r[2] - r[0], r[3] - r[1]];
}

function hitRect(def: CharacterDef, f: FighterState, hit: HitDef): Rect | null {
    if (hit.box !== 'auto') return hit.box;
    const r = reachOf(def, f);
    if (!r) return [def.width, 16, 20, 30];
    // The body itself does not hit: start the box at the front of the body.
    const x0 = Math.max(r[0], def.width - 4);
    return [x0, r[1], Math.max(8, r[0] + r[2] - x0), Math.max(8, r[3])];
}

export function hurtBoxes(f: FighterState): Rect[] {
    const def = getChar(f.char);
    if (f.mode === 'down' || f.mode === 'getup' || f.mode === 'ko' || f.mode === 'intro' || f.mode === 'win' || f.mode === 'lose') return [];
    if (f.mode === 'juggle' && f.juggle >= MAX_JUGGLE) return [];
    const w = def.width;
    let h = def.height;
    if (f.crouching || f.mode === 'crouch') h = def.crouchHeight;
    if (f.mode === 'juggle') return [[-w - 4, 4, w * 2 + 8, Math.round(def.height * 0.6)]];
    if (f.mode === 'air' || (f.mode === 'move' && f.y > 0)) h = Math.round(def.height * 0.85);
    const boxes: Rect[] = [[-w, 0, w * 2, h]];
    const move = moveOf(f);
    if (move && f.frame >= firstActive(move)) {
        const r = reachOf(def, f);
        if (r) boxes.push([r[0] + 4, r[1] + 2, Math.max(4, r[2] - 8), Math.max(4, r[3] - 4)]);
    }
    return boxes;
}

export function activeHitBoxes(f: FighterState): Rect[] {
    const move = moveOf(f);
    if (!move || f.mode !== 'move') return [];
    const def = getChar(f.char);
    const out: Rect[] = [];
    for (const hit of move.hits) {
        if (f.frame >= hit.frames[0] && f.frame <= hit.frames[1]) {
            const r = hitRect(def, f, hit);
            if (r) out.push(r);
        }
    }
    return out;
}

// ——— Hitting ———

/**
 * Combo scaling: each hit after the second deals 12% less, down to 30%.
 * An ultimate only counts its own hits, not the ones that led into it, so a
 * combo ending in a full ultimate always deals the ultimate's full damage on
 * top of the rest instead of less than the ultimate on its own.
 */
function scaledDamage(d: FighterState, base: number, counter: boolean): number {
    const taken = d.superRun ? d.combo - d.superFrom : d.combo;
    const scale = Math.max(30, 100 - 12 * Math.max(0, taken - 1));
    let dmg = Math.floor((base * scale) / 100);
    if (counter) dmg = Math.floor((dmg * 120) / 100);
    return Math.max(1, dmg);
}

function pushVelocity(pushPx: number): number {
    // Distance covered while decelerating at GROUND_FRICTION: v² / 2a.
    return Math.floor(Math.sqrt(2 * GROUND_FRICTION * pushPx * PX));
}

function atWall(state: MatchState, f: FighterState, dir: number): boolean {
    return dir > 0 ? f.x >= state.stageWidth - WALL - PX : f.x <= WALL + PX;
}

function applyPush(state: MatchState, a: FighterState, d: FighterState, pushPx: number): void {
    const dir = d.x >= a.x ? 1 : -1;
    const v = pushVelocity(pushPx);
    if (atWall(state, d, dir) && a.y === 0) {
        // Cornered: the attacker bounces off instead, as in every Street Fighter.
        // Not during a rushing move: its motion has no friction, so the bounce
        // would carry the attacker backwards until the move ends and the
        // following hits would whiff. It keeps pressing against the body.
        if (a.mode === 'move' && moveOf(a)?.motion?.length) return;
        a.vx = -dir * v;
    } else {
        d.vx = dir * v;
    }
}

function koCheck(state: MatchState, d: FighterState, events: GameEvent[]): void {
    if (d.health > 0) return;
    if (state.training) {
        d.health = 1;
        return;
    }
    d.health = 0;
    setMode(d, 'ko');
    setAnim(d, 'launched');
    d.vx = (d.x > state.fighters[1 - d.side].x ? 1 : -1) * px(2.6);
    d.vy = px(6.2);
    d.invuln = 9999;
    state.phase = 'ko';
    state.phaseT = 0;
    state.slowmo = 70;
    state.projectiles = [];
    events.push({ type: 'ko', side: d.side });
}

interface HitSource { x: number; facing: 1 | -1; side: number; kind: string }

function connect(
    state: MatchState, attacker: FighterState, src: HitSource, d: FighterState, hit: Omit<HitDef, 'frames' | 'box'>,
    at: { x: number; y: number }, events: GameEvent[], fromProjectile: boolean
): 'hit' | 'block' {
    const heavy = hit.damage >= 60;
    const stop = hit.hitstop ?? (heavy ? 11 : 7);
    if (canBlock(d, hit, src.x)) {
        const chip = src.kind === 'special' || src.kind === 'ultimate' ? Math.floor(hit.damage / 6) : 0;
        d.health -= chip;
        d.redHealth = Math.min(d.redHealth, d.health + chip);
        const g = guardDir(d, src.x);
        d.crouching = g === 'crouch';
        setMode(d, 'blockstun', hit.blockstun);
        setAnim(d, d.crouching ? 'guardLow' : 'guard');
        d.guard -= Math.floor(hit.damage / 3) + 4;
        d.guardRest = 0;
        gainMeter(d, 3);
        gainMeter(attacker, 2);
        applyPush(state, fromProjectile ? d : attacker, d, Math.floor((hit.push * 2) / 3) + 4);
        if (fromProjectile) d.vx = (d.x >= src.x ? 1 : -1) * pushVelocity(Math.floor((hit.push * 2) / 3) + 4);
        d.hitstop = stop - 2;
        if (!fromProjectile) attacker.hitstop = stop - 2;
        events.push({ type: 'block', x: at.x, y: at.y, attacker: attacker.side });
        if (d.guard <= 0) {
            d.guard = GUARD_MAX;
            setMode(d, 'dizzy', 90);
            setAnim(d, 'dizzy');
            events.push({ type: 'guardCrush', side: d.side });
        }
        koCheck(state, d, events);
        return 'block';
    }

    const wasFree = d.mode !== 'hitstun' && d.mode !== 'juggle' && d.mode !== 'dizzy';
    if (wasFree) {
        d.combo = 0;
        d.comboDamage = 0;
        d.juggle = 0;
        d.superRun = false;
    }
    // A run of ultimate hits restarts the scaling count where it began.
    const ultimate = src.kind === 'ultimate';
    if (ultimate && !d.superRun) d.superFrom = d.combo;
    d.superRun = ultimate;
    const counter = d.mode === 'move' && (() => {
        const m = moveOf(d);
        return !!m && d.frame <= lastActive(m);
    })();
    const dmg = scaledDamage(d, hit.damage, counter);
    d.health = Math.max(0, d.health - dmg);
    d.combo++;
    d.comboDamage += dmg;
    d.counterHit = counter;
    d.guardRest = 0;
    gainMeter(attacker, Math.ceil(dmg / 4) + (src.kind === 'ultimate' ? 0 : 2));
    gainMeter(d, Math.ceil(dmg / 6));
    d.crouching = d.crouching && d.y === 0 && !hit.launch;
    d.projectileOut = d.projectileOut && fromProjectile;

    const dir = d.x >= src.x ? 1 : -1;
    const airborne = d.y > 0 || d.mode === 'juggle';
    if (hit.launch || airborne || hit.knockdown) {
        const [lx, ly] = hit.launch ?? (airborne ? [1.6, 3.6] : [1.4, 3.2]);
        setMode(d, 'juggle');
        setAnim(d, 'launched');
        d.vx = dir * px(lx);
        d.vy = px(ly);
        if (d.y === 0) d.y = PX;
        d.juggle++;
        d.timer = hit.wallBounce ? 1 : 0;
    } else {
        setMode(d, 'hitstun', hit.hitstun + (counter ? 4 : 0));
        setAnim(d, heavy ? 'hitHeavy' : 'hit');
        applyPush(state, fromProjectile ? d : attacker, d, hit.push);
        if (fromProjectile) d.vx = dir * pushVelocity(hit.push);
    }
    d.hitstop = stop;
    if (!fromProjectile) attacker.hitstop = stop;
    events.push({
        type: 'hit', x: at.x, y: at.y, attacker: attacker.side, spark: hit.spark ?? (heavy ? 'heavy' : 'light'),
        damage: dmg, counter, heavy, shake: hit.shake ?? (heavy ? 3 : 0), sfx: hit.sfx
    });
    if (d.combo >= 2) events.push({ type: 'combo', side: attacker.side, hits: d.combo, damage: d.comboDamage });
    koCheck(state, d, events);
    return 'hit';
}

function centre(a: WorldBox, b: WorldBox): { x: number; y: number } {
    return {
        x: (Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) >> 1,
        y: (Math.max(a.y0, b.y0) + Math.min(a.y1, b.y1)) >> 1
    };
}

function resolveAttacks(state: MatchState, a: FighterState, d: FighterState, events: GameEvent[]): void {
    const move = moveOf(a);
    if (!move || a.mode !== 'move' || a.hitstop > 0) return;
    if (d.invuln > 0 || d.mode === 'thrown') return;
    const def = getChar(a.char);
    const hurts = hurtBoxes(d).map((r) => worldBox(d, r));
    if (!hurts.length) return;
    move.hits.forEach((hit, i) => {
        if (a.frame < hit.frames[0] || a.frame > hit.frames[1]) return;
        const bit = 1 << i;
        if (a.hitMask & bit) {
            if (!hit.rehit || a.t - a.lastHitT < hit.rehit) return;
        }
        const r = hitRect(def, a, hit);
        if (!r) return;
        const box = worldBox(a, r);
        const hurt = hurts.find((h) => overlap(box, h));
        if (!hurt) return;
        if (move.kind === 'throw') {
            if (i !== 0 || (a.hitMask & 1) || !throwable(state, a, d)) return;
            a.hitMask |= 1;
            a.connected = true;
            setMode(d, 'thrown', THROW_TECH_WINDOW);
            d.thrownBy = a.side;
            setAnim(d, 'hitHeavy');
            d.vx = d.vy = 0;
            return;
        }
        a.hitMask |= bit;
        a.lastHitT = a.t;
        a.connected = true;
        connect(state, a, { x: a.x, facing: a.facing, side: a.side, kind: move.kind }, d, hit, centre(box, hurt), events, false);
    });
}

// ——— Projectiles ———

function stepProjectiles(state: MatchState, events: GameEvent[]): void {
    for (const p of state.projectiles) {
        const def = getChar(p.char).moves[p.def as keyof CharacterDef['moves']]?.projectile;
        if (!def) { p.dead = true; continue; }
        p.x += p.vx;
        p.y += p.vy;
        p.t++;
        if (p.t > def.life || p.x < 0 || p.x > state.stageWidth || p.y < -20 * PX) p.dead = true;
    }
    // Two projectiles meeting cancel each other out, one hit for one hit.
    for (const a of state.projectiles) {
        for (const b of state.projectiles) {
            if (a.owner >= b.owner || a.dead || b.dead) continue;
            const da = getChar(a.char).moves[a.def as keyof CharacterDef['moves']]!.projectile!;
            const db = getChar(b.char).moves[b.def as keyof CharacterDef['moves']]!.projectile!;
            const ba = { ...worldBoxAt(a.x, a.y, a.facing, da.box) };
            const bb = { ...worldBoxAt(b.x, b.y, b.facing, db.box) };
            if (overlap(ba, bb)) {
                a.hitsLeft--; b.hitsLeft--;
                if (a.hitsLeft <= 0) a.dead = true;
                if (b.hitsLeft <= 0) b.dead = true;
                const c = centre(ba, bb);
                events.push({ type: 'hit', x: c.x, y: c.y, attacker: a.owner, spark: 'big', damage: 0, counter: false, heavy: true, shake: 2 });
            }
        }
    }
    for (const p of state.projectiles) {
        if (p.dead) continue;
        const d = state.fighters[1 - p.owner];
        const def = getChar(p.char).moves[p.def as keyof CharacterDef['moves']]!.projectile!;
        if (d.invuln > 0 || d.mode === 'thrown' || p.t - p.lastHit < 8) continue;
        const box = worldBoxAt(p.x, p.y, p.facing, def.box);
        const hurt = hurtBoxes(d).map((r) => worldBox(d, r)).find((h) => overlap(box, h));
        if (!hurt) continue;
        p.lastHit = p.t;
        p.hitsLeft--;
        if (p.hitsLeft <= 0) p.dead = true;
        const owner = state.fighters[p.owner];
        const kind = getChar(p.char).moves[p.def as keyof CharacterDef['moves']]!.kind === 'ultimate' ? 'ultimate' : 'special';
        // The projectile comes from behind its direction of travel: guarding
        // means holding away from that side, wherever its centre has got to
        // (point-blank, a wide projectile spawns past the target's centre).
        connect(state, owner, { x: d.x - p.facing * PX, facing: p.facing, side: p.owner, kind }, d, def.hit, centre(box, hurt), events, true);
    }
    const alive = state.projectiles.filter((p) => !p.dead);
    for (const f of state.fighters) {
        f.projectileOut = alive.some((p) => p.owner === f.side);
    }
    state.projectiles = alive;
}

function worldBoxAt(x: number, y: number, facing: 1 | -1, r: Rect): WorldBox {
    const xa = x + px(r[0]) * facing;
    const xb = x + px(r[0] + r[2]) * facing;
    return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: y + px(r[1]), y1: y + px(r[1] + r[3]) };
}

// ——— Per-fighter update ———

function faceOpponent(f: FighterState, o: FighterState): void {
    if (o.x !== f.x) f.facing = o.x > f.x ? 1 : -1;
}

function land(state: MatchState, f: FighterState, events: GameEvent[]): void {
    f.y = 0;
    f.vy = 0;
    f.airActions = 0;
    events.push({ type: 'land', side: f.side, heavy: false });
    const o = state.fighters[1 - f.side];
    faceOpponent(f, o);
    setMode(f, 'land', LAND_LAG);
    setAnim(f, 'jump', 3);
    f.vx = 0;
}

function freeGround(state: MatchState, f: FighterState, o: FighterState, events: GameEvent[]): void {
    const def = getChar(f.char);
    const h = f.history;
    if (state.phase !== 'fight') {
        if (f.mode !== 'idle') { setMode(f, 'idle'); setAnim(f, 'idle'); }
        f.vx = 0;
        tickAnim(f, def);
        return;
    }
    faceOpponent(f, o);
    if (groundActions(state, f, o, events)) return;
    const d = currentDir(h);
    if (d >= 7) {
        setMode(f, 'prejump', PREJUMP);
        setAnim(f, 'jump', 0);
        f.vx = 0;
        return;
    }
    if (doubleTap(h, 6)) {
        setMode(f, 'dash', DASH_TICKS);
        setAnim(f, 'dash');
        events.push({ type: 'dust', x: f.x, y: 0, big: false });
        return;
    }
    if (doubleTap(h, 4)) {
        setMode(f, 'backdash', BACKDASH_TICKS);
        setAnim(f, 'backdash');
        f.vx = -px(def.backdash[0]) * f.facing;
        f.vy = px(def.backdash[1]);
        f.y = 1;
        f.invuln = 8;
        events.push({ type: 'dust', x: f.x, y: 0, big: false });
        return;
    }
    if (d <= 3) {
        if (f.mode !== 'crouch') { setMode(f, 'crouch'); setAnim(f, 'crouch'); }
        f.crouching = true;
        f.vx = 0;
        if (threatened(state, f, o) && d === 1) setAnim(f, 'guardLow');
        else if (f.anim !== 'crouch') setAnim(f, 'crouch');
        tickAnim(f, def);
        return;
    }
    f.crouching = false;
    if (d === 6 || d === 4) {
        if (d === 4 && threatened(state, f, o)) {
            if (f.mode !== 'walk') setMode(f, 'walk');
            setAnim(f, 'guard');
            f.vx = 0;
            return;
        }
        if (f.mode !== 'walk') setMode(f, 'walk');
        if (f.anim !== 'walk') setAnim(f, 'walk');
        f.vx = (d === 6 ? px(def.walk) : -px(def.back)) * f.facing;
        tickAnim(f, def);
        return;
    }
    if (f.mode !== 'idle') { setMode(f, 'idle'); }
    if (f.anim !== 'idle') setAnim(f, 'idle');
    f.vx = 0;
    tickAnim(f, def);
}

function stepMove(state: MatchState, f: FighterState, o: FighterState, events: GameEvent[]): void {
    const move = moveOf(f)!;
    // Two fingers never land on the same tick: a second button pressed just
    // after a grounded normal upgrades it to the throw, the ultimate or a
    // special, as if both had been pressed together.
    if (move.kind === 'normal' && move.stance !== 'air' && f.t <= KARA && !f.connected &&
        useBuffer(state, f, events, (slot) => slot === 'ultimate' || slot === 'ultimate2' || slot === 'throw' || (isSpecialSlot(slot) && !isAirSlot(slot)))) return;
    // Cancels: chains and specials open once the move has touched the
    // opponent. A press made any time since the move started (hitstop
    // included) is kept in the buffer and comes out here.
    if (f.connected && f.buffer && f.frame >= firstActive(move) && state.phase === 'fight') {
        const next = cancelInto(f, move, f.buffer.slot);
        if (next && canStart(state, f, next)) {
            startMove(state, f, next, events);
            return;
        }
    }

    // Throw release.
    if (move.kind === 'throw' && move.throwRelease && f.connected && f.frame === move.throwRelease.frame && f.frameT === 0) {
        if (o.mode === 'thrown' && o.thrownBy === f.side) {
            const r = move.throwRelease;
            o.combo = 0;
            o.juggle = 0;
            connect(state, f, { x: f.x, facing: f.facing, side: f.side, kind: 'throw' },
                o, { damage: r.damage, guard: 'unblockable', hitstun: 0, blockstun: 0, push: 0, launch: r.launch, knockdown: true, spark: 'heavy', shake: 4, hitstop: 10 },
                { x: o.x, y: o.y + px(30) }, events, false);
        }
    }

    // Advance the animation.
    f.frameT++;
    if (f.frameT >= (move.durations[f.frame] ?? 1)) {
        f.frameT = 0;
        f.frame++;
        if (f.frame >= move.durations.length) {
            endMove(state, f, o, events);
            return;
        }
        applyMotion(f, move);
        frameEvents(state, f, move, events);
    }
    if (move.invuln) f.invuln = f.frame >= move.invuln[0] && f.frame <= move.invuln[1] ? 1 : 0;
}

function endMove(state: MatchState, f: FighterState, o: FighterState, events: GameEvent[]): void {
    const move = moveOf(f);
    if (f.y > 0) {
        setMode(f, 'air');
        setAnim(f, 'jump', 2);
        return;
    }
    const holdingDown = currentDir(f.history) <= 3;
    setMode(f, holdingDown ? 'crouch' : 'idle');
    setAnim(f, holdingDown ? 'crouch' : 'idle');
    f.crouching = holdingDown;
    if (!move || move.stance !== 'air') f.vx = 0;
    faceOpponent(f, o);
    // A move buffered during recovery starts on the very next animation tick.
    if (state.phase === 'fight') groundActions(state, f, o, events);
}

/** Back to neutral after stun: act on this same tick, so a buffered
 *  reversal or a guard held back does not lose a frame. */
function recover(state: MatchState, f: FighterState, o: FighterState, events: GameEvent[]): void {
    setMode(f, 'idle');
    setAnim(f, 'idle');
    freeGround(state, f, o, events);
}

function updateFighter(state: MatchState, f: FighterState, o: FighterState, events: GameEvent[]): void {
    const def = getChar(f.char);
    f.t++;
    if (f.invuln > 0 && f.mode !== 'move') f.invuln--;
    const grounded = f.y === 0;

    switch (f.mode) {
        case 'intro':
            tickAnim(f, def);
            if (state.phase === 'fight') { setMode(f, 'idle'); setAnim(f, 'idle'); freeGround(state, f, o, events); }
            break;
        case 'idle':
        case 'walk':
        case 'crouch':
            freeGround(state, f, o, events);
            break;
        case 'land':
            if (--f.timer <= 0) { setMode(f, 'idle'); setAnim(f, 'idle'); freeGround(state, f, o, events); }
            else if (state.phase === 'fight' && groundActions(state, f, o, events)) { /* landing cancel */ }
            break;
        case 'prejump': {
            if (useBuffer(state, f, events, (slot) => slot === 'specialU')) break;
            if (--f.timer <= 0) {
                // The latest upward direction held during the startup: letting
                // go of → a tick early still jumps forward.
                const h = f.history;
                let d = 8;
                for (let i = h.length - 1; i >= Math.max(0, h.length - 1 - PREJUMP); i--) {
                    if (dirOf(h[i]) >= 7) { d = dirOf(h[i]); break; }
                }
                const dir = d === 9 ? 1 : d === 7 ? -1 : 0;
                setMode(f, 'air');
                f.vx = px(def.jump[0]) * dir * f.facing;
                f.vy = px(def.jump[1]);
                f.y = 1;
                setAnim(f, 'jump', 1);
                events.push({ type: 'jump', side: f.side });
                events.push({ type: 'dust', x: f.x, y: 0, big: false });
            }
            break;
        }
        case 'air': {
            if (useBuffer(state, f, events, (slot) => (slot === 'airSpecial' && f.airActions < 1) || slot === 'airLight' || slot === 'airHeavy')) break;
            setAnim(f, 'jump', f.vy > px(1.5) ? 1 : 2);
            break;
        }
        case 'dash': {
            const t = DASH_TICKS - f.timer;
            f.vx = px(def.dash) * f.facing * (f.timer > 4 ? 1 : f.timer / 5);
            f.vx = Math.trunc(f.vx);
            tickAnim(f, def);
            if (t > 3 && groundActions(state, f, o, events)) break;
            if (--f.timer <= 0) { setMode(f, 'idle'); setAnim(f, 'idle'); f.vx = 0; }
            break;
        }
        case 'backdash':
            tickAnim(f, def);
            if (grounded && f.t > 2) { setMode(f, 'land', 6); setAnim(f, 'jump', 3); f.vx = 0; }
            break;
        case 'move':
            stepMove(state, f, o, events);
            break;
        case 'hitstun':
        case 'blockstun':
            tickAnim(f, def);
            if (--f.timer <= 0) {
                f.combo = 0;
                recover(state, f, o, events);
            }
            break;
        case 'dizzy':
            tickAnim(f, def);
            if (--f.timer <= 0) recover(state, f, o, events);
            break;
        case 'juggle':
            // Tumble frames follow the arc: rising, peak, falling.
            setAnim(f, 'launched', f.vy > px(1) ? 0 : f.vy > -px(1) ? 1 : 2);
            break;
        case 'thrown': {
            const holder = state.fighters[f.thrownBy];
            if (f.t <= THROW_TECH_WINDOW && (wantsThrow(f) || f.buffer?.slot === 'throw')) {
                // Throw tech: both fighters spring apart, nobody takes damage.
                const dir = f.x >= holder.x ? 1 : -1;
                setMode(f, 'blockstun', 14); setAnim(f, 'guard');
                setMode(holder, 'blockstun', 14); setAnim(holder, 'guard');
                f.vx = dir * pushVelocity(34);
                holder.vx = -dir * pushVelocity(34);
                f.thrownBy = -1;
                events.push({ type: 'throwTech', x: (f.x + holder.x) >> 1, y: px(34) });
                break;
            }
            if (holder.mode !== 'move') { setMode(f, 'idle'); setAnim(f, 'idle'); f.thrownBy = -1; break; }
            f.x = holder.x + holder.facing * px(getChar(holder.char).width + def.width + 4);
            f.facing = (-holder.facing) as 1 | -1;
            break;
        }
        case 'down':
            if (state.phase === 'ko' || state.phase === 'roundEnd' || state.phase === 'matchEnd') break;
            if (--f.timer <= 0) {
                setMode(f, 'getup');
                setAnim(f, 'getup');
                f.invuln = 30;
            }
            break;
        case 'getup': {
            tickAnim(f, def);
            const n = def.manifest.anims.getup?.frames.length ?? 1;
            if (f.t > n * 7) {
                f.invuln = 4;
                f.combo = 0;
                faceOpponent(f, o);
                recover(state, f, o, events);
            }
            break;
        }
        case 'ko':
            if (f.y === 0 && f.t > 4) { setAnim(f, 'down', 0); }
            else setAnim(f, 'launched', f.vy > 0 ? 0 : 2);
            break;
        case 'win':
            tickAnim(f, def);
            break;
        case 'lose':
            break;
    }
}

// ——— Physics ———

function physics(state: MatchState, f: FighterState, events: GameEvent[]): void {
    const def = getChar(f.char);
    const move = moveOf(f);
    const airborne = f.y > 0 || f.vy > 0;
    if (f.mode === 'thrown') return;
    f.x += f.vx;
    if (airborne) {
        f.y += f.vy;
        const noGravity = f.mode === 'move' && move?.noGravity;
        if (!noGravity) f.vy -= px(def.gravity);
    }
    // Ground friction for sliding states.
    if (f.y === 0 && (f.mode === 'hitstun' || f.mode === 'blockstun' || f.mode === 'land' || f.mode === 'getup' ||
        f.mode === 'down' || f.mode === 'dizzy' || (f.mode === 'move' && !(move?.motion?.length)) || f.mode === 'win' || f.mode === 'lose')) {
        if (f.vx > 0) f.vx = Math.max(0, f.vx - GROUND_FRICTION);
        else if (f.vx < 0) f.vx = Math.min(0, f.vx + GROUND_FRICTION);
    }
    if (f.y <= 0 && airborne && f.vy <= 0) {
        f.y = 0;
        if (f.mode === 'air' || f.mode === 'backdash') land(state, f, events);
        else if (f.mode === 'move') {
            if (move?.landFrame !== undefined && f.frame < move.landFrame) {
                f.frame = move.landFrame;
                f.frameT = 0;
                f.vx = 0;
                f.vy = 0;
                events.push({ type: 'land', side: f.side, heavy: true });
                events.push({ type: 'dust', x: f.x, y: 0, big: true });
            } else if (move?.stance === 'air') {
                setMode(f, 'land', move.landLag ?? LAND_LAG);
                setAnim(f, 'jump', 3);
                f.vx = 0;
                f.vy = 0;
                events.push({ type: 'land', side: f.side, heavy: false });
            } else {
                f.vy = 0;
            }
        } else if (f.mode === 'juggle' || f.mode === 'ko') {
            if (f.timer === 1 && f.mode === 'juggle') {
                // Ground bounce once for wall-bounce moves, then lie down.
                f.timer = 0;
            }
            events.push({ type: 'dust', x: f.x, y: 0, big: true });
            events.push({ type: 'land', side: f.side, heavy: true });
            if (f.mode === 'ko') {
                if (f.vy < -px(3)) {
                    f.vy = px(2.2);
                    f.y = 1;
                    f.vx = Math.trunc(f.vx / 2);
                } else {
                    f.vy = 0;
                    f.vx = 0;
                    setAnim(f, 'down', 0);
                }
            } else {
                setMode(f, 'down', DOWN_TICKS);
                setAnim(f, 'down', 0);
                f.vy = 0;
                f.vx = Math.trunc(f.vx / 3);
                f.juggle = 0;
            }
        } else {
            f.vy = 0;
        }
    }
    // Walls.
    const min = WALL;
    const max = state.stageWidth - WALL;
    if (f.x < min || f.x > max) {
        if (f.mode === 'juggle' && f.timer === 1) {
            // Wall bounce: the victim comes back towards the attacker.
            f.vx = -Math.trunc(f.vx * 0.6);
            f.vy = Math.max(f.vy, px(3.2));
            f.timer = 0;
            events.push({ type: 'hit', x: f.x < min ? min : max, y: f.y + px(30), attacker: 1 - f.side, spark: 'big', damage: 0, counter: false, heavy: true, shake: 5 });
        }
        f.x = Math.min(max, Math.max(min, f.x));
    }
}

function separate(state: MatchState): void {
    const [a, b] = state.fighters;
    const da = getChar(a.char);
    const db = getChar(b.char);
    // Throws hold the victim in place.
    if (a.mode === 'thrown' || b.mode === 'thrown') return;
    if (a.mode === 'down' || b.mode === 'down' || a.mode === 'ko' || b.mode === 'ko') return;
    const minGap = (da.width + db.width) * PX;
    const dx = b.x - a.x;
    const verticalOverlap = Math.abs(a.y - b.y) < Math.min(da.height, db.height) * PX * 0.75;
    if (Math.abs(dx) < minGap && verticalOverlap) {
        const push = minGap - Math.abs(dx);
        let dir = dx === 0 ? (a.facing === 1 ? 1 : -1) : Math.sign(dx);
        // Landing on top of someone: slide off towards the side you came from.
        if (dx === 0 && a.y !== b.y) dir = a.y > b.y ? -a.facing : a.facing;
        let pa = Math.floor(push / 2);
        let pb = push - pa;
        const min = WALL;
        const max = state.stageWidth - WALL;
        // Against a wall the other fighter takes the whole push.
        if ((dir > 0 && a.x - pa < min) || (dir < 0 && a.x + pa > max)) { pb += pa; pa = 0; }
        if ((dir > 0 && b.x + pb > max) || (dir < 0 && b.x - pb < min)) { pa += pb; pb = 0; }
        a.x -= dir * pa;
        b.x += dir * pb;
        a.x = Math.min(max, Math.max(min, a.x));
        b.x = Math.min(max, Math.max(min, b.x));
    }
    // The camera cannot hold fighters further apart than the screen.
    const dist = b.x - a.x;
    if (Math.abs(dist) > MAX_DISTANCE) {
        const over = Math.abs(dist) - MAX_DISTANCE;
        const s = Math.sign(dist);
        // Whoever is moving away gets held back.
        const aAway = a.vx * -s > 0;
        const bAway = b.vx * s > 0;
        if (aAway && !bAway) a.x += s * over;
        else if (bAway && !aAway) b.x -= s * over;
        else { a.x += s * (over >> 1); b.x -= s * (over - (over >> 1)); }
    }
}

// ——— Rounds ———

function decideRound(state: MatchState, events: GameEvent[]): void {
    const [a, b] = state.fighters;
    let winner: number;
    if (a.health <= 0 && b.health <= 0) winner = 2;
    else if (a.health <= 0) winner = 1;
    else if (b.health <= 0) winner = 0;
    else {
        const ra = a.health / getChar(a.char).health;
        const rb = b.health / getChar(b.char).health;
        winner = ra === rb ? 2 : ra > rb ? 0 : 1;
    }
    state.roundWinner = winner as 0 | 1 | 2;
    if (winner === 2) { a.wins++; b.wins++; }
    else state.fighters[winner].wins++;
    const w = winner < 2 ? state.fighters[winner] : null;
    state.perfect = !!w && w.health === getChar(w.char).health;
    events.push({ type: 'roundEnd', winner, timeOver: state.timeOver, perfect: state.perfect });
    state.phase = 'roundEnd';
    state.phaseT = 0;
}

function stepPhase(state: MatchState, events: GameEvent[]): void {
    state.phaseT++;
    const [a, b] = state.fighters;
    switch (state.phase) {
        case 'intro':
            if (state.phaseT === 1) events.push({ type: 'round', round: state.round });
            if (state.phaseT >= INTRO_TICKS || state.training) {
                state.phase = 'fight';
                state.phaseT = 0;
                events.push({ type: 'fight' });
            }
            break;
        case 'fight':
            if (!state.training && state.freeze === null) {
                state.clock--;
                if (state.clock <= 0) {
                    state.clock = 0;
                    state.timeOver = true;
                    decideRound(state, events);
                }
            }
            break;
        case 'ko': {
            const loser = a.mode === 'ko' ? a : b;
            if (state.phaseT >= KO_TICKS || (state.phaseT > 90 && loser.y === 0 && loser.vy === 0)) decideRound(state, events);
            break;
        }
        case 'roundEnd':
            if (state.phaseT === 30) {
                for (const f of state.fighters) {
                    if (f.mode === 'ko') continue;
                    const won = state.roundWinner === f.side;
                    if (won) { setMode(f, 'win'); setAnim(f, 'win'); f.vx = 0; }
                }
            }
            if (state.phaseT >= ROUND_END_TICKS) {
                const done = state.fighters.some((f) => f.wins >= state.roundsToWin);
                if (done) {
                    const [wa, wb] = [a.wins >= state.roundsToWin, b.wins >= state.roundsToWin];
                    state.winner = wa && wb ? 2 : wa ? 0 : 1;
                    state.phase = 'matchEnd';
                    state.phaseT = 0;
                    events.push({ type: 'matchEnd', winner: state.winner });
                } else {
                    state.round++;
                    resetRound(state);
                }
            }
            break;
        case 'matchEnd':
            break;
    }
}

// ——— Training niceties ———

/** Training with the always-full meter: every cost is free. */
export const freeMeter = (state: MatchState) => state.training && state.fullMeter !== false;

function trainingRefill(state: MatchState): void {
    if (!state.training) return;
    for (const f of state.fighters) {
        const def = getChar(f.char);
        if (state.fullMeter !== false) f.meter = METER_MAX;
        const idle = f.mode === 'idle' || f.mode === 'walk' || f.mode === 'crouch';
        if (idle && f.t > 50 && f.health < def.health) {
            f.health = def.health;
            f.redHealth = def.health;
        }
    }
}

// ——— The step ———

/**
 * Advance the match by one tick. `inputs` are the raw button bits of each
 * side for this tick. Returns what happened, for the renderer and sound.
 */
export function stepMatch(state: MatchState, inputs: [number, number]): GameEvent[] {
    const events: GameEvent[] = [];
    state.tick++;
    const [a, b] = state.fighters;
    // Inputs are always recorded, even during freezes, so a special pressed
    // in hitstop still comes out.
    pushHistory(a.history, pack(numpad(inputs[0], a.facing), inputs[0]));
    pushHistory(b.history, pack(numpad(inputs[1], b.facing), inputs[1]));
    if (state.phase === 'fight') {
        for (const f of state.fighters) {
            const want = intentOf(state, f);
            if (want) f.buffer = { slot: want, t: BUFFER };
        }
    }

    if (state.freeze) {
        state.freeze.t--;
        if (state.freeze.t <= 0) state.freeze = null;
        return events;
    }
    if (state.slowmo > 0) {
        state.slowmo--;
        state.slowAcc++;
        if (state.slowAcc % 3 !== 0) {
            stepPhase(state, events);
            return events;
        }
    }

    for (const [f, o] of [[a, b], [b, a]] as const) {
        if (f.hitstop > 0) { f.hitstop--; continue; }
        updateFighter(state, f, o, events);
        // The buffer only ages on ticks the fighter actually plays.
        if (f.buffer && --f.buffer.t <= 0) f.buffer = null;
    }
    for (const f of state.fighters) {
        if (f.hitstop > 0) continue;
        physics(state, f, events);
    }
    separate(state);
    if (state.phase === 'fight') {
        // Both attacks resolve against the state before either lands, so
        // two moves that meet on the same tick trade.
        resolveAttacks(state, a, b, events);
        resolveAttacks(state, b, a, events);
    }
    stepProjectiles(state, events);

    for (const f of state.fighters) {
        // The red part of the health bar drains once the combo is over.
        const idle = f.mode !== 'hitstun' && f.mode !== 'juggle' && f.mode !== 'thrown';
        if (f.redHealth > f.health && idle) f.redHealth = Math.max(f.health, f.redHealth - 6);
        if (f.redHealth < f.health) f.redHealth = f.health;
        f.guardRest++;
        if (f.guardRest > 60 && f.guard < GUARD_MAX) f.guard = Math.min(GUARD_MAX, f.guard + 1);
    }
    trainingRefill(state);
    stepPhase(state, events);
    return events;
}

export function isMatchOver(state: MatchState): boolean {
    return state.phase === 'matchEnd';
}

/** Adds `raw` meter scaled by METER_GAIN_NUM/DEN, rounded to nearest, in integers. */
function gainMeter(f: FighterState, raw: number): void {
    const gain = Math.floor((raw * METER_GAIN_NUM * 2 + METER_GAIN_DEN) / (METER_GAIN_DEN * 2));
    f.meter = Math.min(METER_MAX, f.meter + gain);
}
