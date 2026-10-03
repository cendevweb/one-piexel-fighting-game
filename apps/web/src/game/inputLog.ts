import { numpad } from '../engine/input';
import { BTN } from '../engine/types';

/**
 * Training input display: J1's inputs as a scrolling list, newest first,
 * the way fighting games show them. Display only: it reads the bits the
 * fight already gets and never touches the match state.
 *
 * A line opens when the direction changes or a button goes down; it shows
 * the direction (in the fighter's own frame, → is forward) and the buttons
 * just pressed, and counts the frames it stayed current.
 */

export interface InputEntry {
    /** Numpad direction, 5 neutral, 6 forward. */
    dir: number;
    /** Buttons pressed on the frame the line opened. */
    buttons: number;
    frames: number;
}

export const INPUT_LOG_MAX = 12;
export const INPUT_LOG_FRAMES_MAX = 99;

const BUTTONS = BTN.light | BTN.heavy | BTN.special | BTN.ultimate;

export class InputLog {
    /** Newest first. */
    entries: InputEntry[] = [];
    private prev = 0;

    push(bits: number, facing: 1 | -1): void {
        const dir = numpad(bits, facing);
        const down = bits & ~this.prev & BUTTONS;
        this.prev = bits;
        const last = this.entries[0];
        if (last && last.dir === dir && !down) {
            last.frames = Math.min(INPUT_LOG_FRAMES_MAX, last.frames + 1);
            return;
        }
        this.entries.unshift({ dir, buttons: down, frames: 1 });
        if (this.entries.length > INPUT_LOG_MAX) this.entries.length = INPUT_LOG_MAX;
    }

    /** Empties the list; buttons still held do not count as new presses. */
    clear(): void {
        this.entries = [];
    }
}

const ARROWS: Record<number, string> = { 1: '↙', 2: '↓', 3: '↘', 4: '←', 6: '→', 7: '↖', 8: '↑', 9: '↗' };
const LETTERS: [number, string][] = [[BTN.light, 'A'], [BTN.heavy, 'B'], [BTN.special, 'C'], [BTN.ultimate, 'U']];

/** One line in the move list's notation: '↘', '→ [C]', '[A][B]', '•' for nothing. */
export function entryLabel(e: InputEntry): string {
    const buttons = LETTERS.filter(([bit]) => e.buttons & bit).map(([, l]) => `[${l}]`).join('');
    const arrow = ARROWS[e.dir] ?? '';
    if (!arrow) return buttons || '•';
    return buttons ? `${arrow} ${buttons}` : arrow;
}
