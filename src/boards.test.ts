import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILD_BOARD, CONVERT_BOARD, REGEX_BOARD } from './lessons/automata-regex/content';
import { TRANSLATE_BOARD, VENN_BOARD } from './lessons/set-logic/content';

/** The server accepts only the boards in its KNOWN_BOARDS; the app's board constants must all be in it. */
describe('server.py KNOWN_BOARDS', () => {
  it('lists exactly the boards the app posts to', () => {
    const src = readFileSync(new URL('../server.py', import.meta.url), 'utf8');
    const block = /KNOWN_BOARDS = frozenset\(\s*\{([^}]*)\}/.exec(src)?.[1] ?? '';
    const known = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    const app = [TRANSLATE_BOARD, VENN_BOARD, BUILD_BOARD, REGEX_BOARD, CONVERT_BOARD].sort();
    expect(known).toEqual(app);
  });
});
