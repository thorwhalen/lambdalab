import { getUndoOffers } from 'undo-toast';
import { beforeEach, describe, expect, it } from 'vitest';
import { useProgress } from './progress';
import { resetWithUndo } from './reset-undo';

/** The reset's toast stays until closed (no trash, no history), so progress can be made before Undo. */
describe('Undo of a reset never takes away progress made after it', () => {
  beforeEach(() => {
    getUndoOffers().close();
    useProgress.getState().restoreLessons({});
  });

  it('reset one lesson, solve in another lesson, then Undo: the other lesson keeps its solve', async () => {
    useProgress.getState().advanceTo('lists', 3);
    resetWithUndo(() => useProgress.getState().resetLesson('lists'), 'reset');
    useProgress.getState().recordSolve('venn', 'p1', 10);
    await getUndoOffers().undo();
    expect(useProgress.getState().lessons.lists.levelReached).toBe(3);
    expect(useProgress.getState().lessons.venn?.solved.p1?.best).toBe(10);
  });

  it('erase all, solve something, then Undo: the old progress is back and the new solve is kept', async () => {
    useProgress.getState().advanceTo('lists', 3);
    useProgress.getState().recordSolve('lists', 'old', 5);
    resetWithUndo(() => useProgress.getState().resetAll(), 'erased');
    useProgress.getState().recordSolve('venn', 'p1', 10);
    useProgress.getState().recordSolve('lists', 'new', 7);
    await getUndoOffers().undo();
    const { lessons } = useProgress.getState();
    expect(lessons.venn?.solved.p1?.best).toBe(10);
    expect(lessons.lists.solved.old?.best).toBe(5);
    expect(lessons.lists.solved.new?.best).toBe(7);
    expect(lessons.lists.levelReached).toBe(3);
  });
});
