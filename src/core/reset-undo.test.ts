import { getUndoOffers } from 'undo-toast';
import { beforeEach, describe, expect, it } from 'vitest';
import { useProgress } from './progress';
import { resetWithUndo } from './reset-undo';

describe('a reset acts at once and one Undo puts the progress back', () => {
  beforeEach(() => {
    getUndoOffers().close();
    useProgress.getState().restoreLessons({});
  });

  it('resetting one lesson, then Undo', async () => {
    useProgress.getState().advanceTo('lists', 3);
    const before = useProgress.getState().lessons;
    resetWithUndo(() => useProgress.getState().resetLesson('lists'), 'Progress in “Lists” reset');
    expect(useProgress.getState().lessons).not.toEqual(before);
    expect(getUndoOffers().current()?.message).toBe('Progress in “Lists” reset');
    await getUndoOffers().undo();
    expect(useProgress.getState().lessons).toEqual(before);
  });

  it('erasing everything, then Undo', async () => {
    useProgress.getState().restoreLessons({ a: { solved: {}, levelReached: 2, seen: ['x'] } } as never);
    resetWithUndo(() => useProgress.getState().resetAll(), 'All your progress erased');
    expect(useProgress.getState().lessons).toEqual({});
    await getUndoOffers().undo();
    expect(Object.keys(useProgress.getState().lessons)).toEqual(['a']);
  });
});
