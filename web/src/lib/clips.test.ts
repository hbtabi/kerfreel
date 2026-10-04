import { describe, expect, it } from 'vitest';
import { mergeClips, skipTarget } from './clips';
import type { Highlight } from './shared';

const h = (id: string, start: number, end: number): Highlight => ({
  id,
  start,
  end,
  score: 50,
  title: id,
  breakdown: { loudness: 0, dynamics: 0, speech: 0, keywords: 0, motion: 0, hook: 0 },
});

describe('web clip helpers', () => {
  it('applies trims to highlights and keeps custom clips last', () => {
    const items = mergeClips([h('a', 0, 10), h('b', 20, 30)], { b: { start: 22, end: 28 } }, [{ id: 'c1', start: 40, end: 50, title: 'mine', custom: true }]);
    expect(items.map((i) => [i.id, i.start, i.end])).toEqual([
      ['a', 0, 10],
      ['b', 22, 28],
      ['c1', 40, 50],
    ]);
  });

  it('finds the next kept instant when inside a pause', () => {
    const keep = [
      { start: 0, end: 2 },
      { start: 5, end: 8 },
    ];
    expect(skipTarget(keep, 1)).toBeNull();
    expect(skipTarget(keep, 3)).toBe(5);
    expect(skipTarget(keep, 9)).toBeNull();
  });
});
