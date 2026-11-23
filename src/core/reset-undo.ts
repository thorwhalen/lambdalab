/**
 * A reset acts at once and offers one Undo that puts the progress back exactly as it was
 * (undo-toast decides how long the offer stays), instead of a "This cannot be undone" confirm:
 * it can be undone, so asking first only slows the person down.
 */
import { advise, offerUndo } from 'undo-toast';
import { useProgress } from './progress';

/** Run a reset with one Undo. `message` is what the toast says ("Progress in “Lists” reset"). */
export function resetWithUndo(reset: () => void, message: string, after?: () => void): void {
  const before = useProgress.getState().lessons;
  reset();
  after?.();
  offerUndo({
    message,
    advice: advise('delete-work'),
    undo: () => {
      useProgress.getState().restoreLessons(before);
      return true;
    },
  });
}
