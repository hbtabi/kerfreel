import { describe, expect, it } from 'vitest';
import { centreAt, centreExpression, cropXExpression, planCropPath, remapKeyframes } from '../src/core/shared/crop.js';
import { TimeMap } from '../src/core/shared/ranges.js';

describe('motion-aware crop path', () => {
  it('centres when there is no motion data', () => {
    const keys = planCropPath(undefined, { start: 0, end: 4 });
    expect(keys.every((k) => k.cx === 0.5)).toBe(true);
  });

  it('drifts towards where motion happens', () => {
    const n = 40;
    const motion = { hop: 0.25, cx: Array.from({ length: n }, () => 0.85), amount: Array.from({ length: n }, () => 0.05) };
    const keys = planCropPath(motion, { start: 0, end: 10 }, { smoothing: 0.5 });
    expect(keys[keys.length - 1]!.cx).toBeGreaterThan(0.75);
  });

  it('builds a piecewise-linear ffmpeg expression that matches the JS evaluator', () => {
    const keys = [
      { t: 0, cx: 0.2 },
      { t: 2, cx: 0.6 },
      { t: 4, cx: 0.6 },
    ];
    const expr = centreExpression(keys);
    expect(expr).toContain('if(lt(t,2)');
    expect(centreAt(keys, 1)).toBeCloseTo(0.4);
    expect(centreAt(keys, 3)).toBeCloseTo(0.6);
    expect(cropXExpression(keys)).toMatch(/^clip\(iw\*\(.+\)-ow\/2,0,iw-ow\)$/);
    // Evaluate the generated expression with a tiny interpreter to be sure it is well formed.
    const js = expr.replace(/if\(/g, 'iff(').replace(/lt\(/g, 'lt(');
    const fn = new Function('t', 'iff', 'lt', `return ${js};`) as (
      t: number,
      iff: (c: boolean, a: number, b: number) => number,
      lt: (a: number, b: number) => boolean,
    ) => number;
    const val = fn(
      1,
      (c, a, b) => (c ? a : b),
      (a, b) => a < b,
    );
    expect(val).toBeCloseTo(0.4);
  });

  it('remaps keyframes onto the cut timeline', () => {
    const map = new TimeMap([
      { start: 0, end: 1 },
      { start: 3, end: 4 },
    ]);
    const out = remapKeyframes(
      [
        { t: 0.5, cx: 0.1 },
        { t: 2, cx: 0.5 },
        { t: 3.5, cx: 0.9 },
      ],
      map,
    );
    expect(out).toEqual([
      { t: 0.5, cx: 0.1 },
      { t: 1.5, cx: 0.9 },
    ]);
  });
});
