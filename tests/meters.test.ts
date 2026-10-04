import { describe, expect, it } from 'vitest';
import { EnergyMeter } from '../src/core/energy.js';
import { MotionMeter } from '../src/core/motion.js';

describe('energy meter', () => {
  it('measures RMS per hop across chunk boundaries', () => {
    const meter = new EnergyMeter(100, 0.1); // 10 samples per window
    const buf = Buffer.alloc(40); // 20 samples
    for (let i = 0; i < 10; i++) buf.writeInt16LE(16384, i * 2); // first window: 0.5 amplitude
    meter.push(buf.subarray(0, 7)); // odd split mid-sample
    meter.push(buf.subarray(7));
    const track = meter.finish();
    expect(track.db).toHaveLength(2);
    expect(track.db[0]).toBeCloseTo(-6.02, 1);
    expect(track.db[1]).toBe(-90);
  });
});

describe('motion meter', () => {
  it('locates horizontal motion', () => {
    const m = new MotionMeter(8, 2, 0.25);
    const a = new Uint8Array(16);
    const b = new Uint8Array(16);
    b[6] = 255;
    b[14] = 255; // column 6 changes in both rows
    m.push(Buffer.from(a));
    m.push(Buffer.from(b));
    const track = m.finish();
    expect(track.cx).toHaveLength(2);
    expect(track.cx[1]).toBeCloseTo(6.5 / 8);
    expect(track.amount[1]).toBeGreaterThan(0);
  });
});
