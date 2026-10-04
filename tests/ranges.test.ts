import { describe, expect, it } from 'vitest';
import { intersectRanges, invertRanges, keepRanges, mergeRanges, TimeMap, totalLength } from '../src/core/shared/ranges.js';

describe('ranges', () => {
  it('merges overlapping and near ranges', () => {
    expect(
      mergeRanges([
        { start: 5, end: 6 },
        { start: 0, end: 2 },
        { start: 1.5, end: 3 },
      ]),
    ).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 6 },
    ]);
    expect(
      mergeRanges(
        [
          { start: 0, end: 1 },
          { start: 1.1, end: 2 },
        ],
        0.2,
      ),
    ).toEqual([{ start: 0, end: 2 }]);
  });

  it('inverts silences into speech', () => {
    expect(
      invertRanges(
        [
          { start: 2, end: 3 },
          { start: 5, end: 10 },
        ],
        10,
      ),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
  });

  it('pads speech into silences and drops tiny islands', () => {
    const keep = keepRanges(
      [
        { start: 0, end: 1 },
        { start: 4, end: 6 },
        { start: 6.1, end: 9 },
      ],
      10,
      { padding: 0.2, minKeep: 0.5, mergeGap: 0 },
    );
    // 1-4 padded to 0.8-4.2; 6-6.1 (a click) becomes 5.8-6.3 = 0.5s and survives; 9-10 padded.
    expect(keep[0]).toEqual({ start: 0.8, end: 4.2 });
    expect(keep[keep.length - 1]).toEqual({ start: 8.8, end: 10 });
    expect(keepRanges([{ start: 1, end: 1.2 }], 1.5, { padding: 0, minKeep: 0.4 })).toEqual([{ start: 0, end: 1 }]);
  });

  it('intersects ranges with a window', () => {
    expect(
      intersectRanges(
        [
          { start: 0, end: 5 },
          { start: 8, end: 12 },
        ],
        { start: 3, end: 10 },
      ),
    ).toEqual([
      { start: 3, end: 5 },
      { start: 8, end: 10 },
    ]);
  });

  it('maps source time to the cut timeline and back', () => {
    const map = new TimeMap([
      { start: 10, end: 12 },
      { start: 15, end: 20 },
    ]);
    expect(map.duration).toBe(7);
    expect(map.toOutput(11)).toBe(1);
    expect(map.toOutput(13)).toBeNull();
    expect(map.toOutputSnapped(13)).toBe(2);
    expect(map.toOutput(16)).toBe(3);
    expect(map.toSource(3)).toBe(16);
    expect(
      totalLength([
        { start: 0, end: 1.5 },
        { start: 3, end: 4 },
      ]),
    ).toBe(2.5);
  });
});
