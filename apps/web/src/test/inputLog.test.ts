import { describe, expect, it } from 'vitest';
import { BTN } from '../engine/types';
import { INPUT_LOG_MAX, INPUT_LOG_FRAMES_MAX, InputLog, entryLabel } from '../game/inputLog';

/** Feeds `bits` for `n` frames, facing right unless told otherwise. */
function feed(log: InputLog, bits: number, n = 1, facing: 1 | -1 = 1): void {
    for (let i = 0; i < n; i++) log.push(bits, facing);
}

describe('training input log', () => {
    it('starts empty, then logs the first frame as a neutral line', () => {
        const log = new InputLog();
        expect(log.entries).toEqual([]);
        feed(log, 0);
        expect(log.entries).toEqual([{ dir: 5, buttons: 0, frames: 1 }]);
    });

    it('counts how long a direction is held, and opens a line when it changes', () => {
        const log = new InputLog();
        feed(log, 0, 3);
        feed(log, BTN.down, 4);
        feed(log, BTN.down | BTN.right, 2);
        feed(log, BTN.right, 1);
        expect(log.entries).toEqual([
            { dir: 6, buttons: 0, frames: 1 },
            { dir: 3, buttons: 0, frames: 2 },
            { dir: 2, buttons: 0, frames: 4 },
            { dir: 5, buttons: 0, frames: 3 }
        ]);
    });

    it('reads directions in the fighter\'s own frame: forward is 6 on either side', () => {
        const log = new InputLog();
        feed(log, BTN.left, 1, -1);
        expect(log.entries[0].dir).toBe(6);
        feed(log, BTN.left | BTN.down, 1, 1);
        expect(log.entries[0].dir).toBe(1);
    });

    it('opens a line on each button press, even with the direction unchanged, and not on a release', () => {
        const log = new InputLog();
        feed(log, 0, 2);
        feed(log, BTN.light, 3);
        feed(log, 0, 2);
        feed(log, BTN.light | BTN.heavy, 1);
        expect(log.entries).toEqual([
            { dir: 5, buttons: BTN.light | BTN.heavy, frames: 1 },
            { dir: 5, buttons: BTN.light, frames: 5 },
            { dir: 5, buttons: 0, frames: 2 }
        ]);
    });

    it('shows only the buttons just pressed, not those still held', () => {
        const log = new InputLog();
        feed(log, BTN.light, 2);
        feed(log, BTN.light | BTN.special, 1);
        expect(log.entries[0].buttons).toBe(BTN.special);
    });

    it('logs the dedicated ultimate key, and ignores start', () => {
        const log = new InputLog();
        feed(log, BTN.ultimate);
        feed(log, BTN.ultimate | BTN.start);
        expect(log.entries).toEqual([{ dir: 5, buttons: BTN.ultimate, frames: 2 }]);
    });

    it('caps the frame count and keeps only the most recent lines', () => {
        const log = new InputLog();
        feed(log, 0, 500);
        expect(log.entries[0].frames).toBe(INPUT_LOG_FRAMES_MAX);
        for (let i = 0; i < INPUT_LOG_MAX + 5; i++) feed(log, i % 2 ? BTN.down : BTN.up);
        expect(log.entries).toHaveLength(INPUT_LOG_MAX);
        expect(log.entries[0].dir).toBe(INPUT_LOG_MAX % 2 ? 2 : 8);
    });

    it('clears', () => {
        const log = new InputLog();
        feed(log, BTN.light, 3);
        log.clear();
        expect(log.entries).toEqual([]);
        // A button still held after a clear is not a new press.
        feed(log, BTN.light);
        expect(log.entries).toEqual([{ dir: 5, buttons: 0, frames: 1 }]);
    });

    it('writes each line in the move list\'s notation', () => {
        expect(entryLabel({ dir: 5, buttons: 0, frames: 1 })).toBe('•');
        expect(entryLabel({ dir: 5, buttons: BTN.light, frames: 1 })).toBe('[A]');
        expect(entryLabel({ dir: 3, buttons: 0, frames: 1 })).toBe('↘');
        expect(entryLabel({ dir: 6, buttons: BTN.special, frames: 1 })).toBe('→ [C]');
        expect(entryLabel({ dir: 2, buttons: BTN.light | BTN.heavy | BTN.special, frames: 1 })).toBe('↓ [A][B][C]');
        expect(entryLabel({ dir: 7, buttons: BTN.ultimate, frames: 1 })).toBe('↖ [U]');
        const arrows = [1, 2, 3, 4, 6, 7, 8, 9].map((dir) => entryLabel({ dir, buttons: 0, frames: 1 }));
        expect(arrows).toEqual(['↙', '↓', '↘', '←', '→', '↖', '↑', '↗']);
    });
});
