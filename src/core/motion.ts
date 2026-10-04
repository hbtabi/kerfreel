import { FFMPEG, run } from './ffmpeg.js';
import type { MotionTrack } from './shared/types.js';

export const MOTION_W = 64;
export const MOTION_H = 36;

/**
 * Frame-difference motion analyser over tiny greyscale frames.
 * For each frame it records where (horizontally) pixels changed and how much.
 */
export class MotionMeter {
  private prev: Uint8Array | null = null;
  private pending: Buffer = Buffer.alloc(0);
  readonly cx: number[] = [];
  readonly amount: number[] = [];

  constructor(
    readonly width = MOTION_W,
    readonly height = MOTION_H,
    readonly hop = 0.25,
  ) {}

  push(chunk: Buffer): void {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const size = this.width * this.height;
    while (this.pending.length >= size) {
      const frame = new Uint8Array(this.pending.subarray(0, size));
      this.pending = this.pending.subarray(size);
      this.analyse(frame);
    }
  }

  analyse(frame: Uint8Array): void {
    if (!this.prev) {
      this.prev = frame;
      this.cx.push(0.5);
      this.amount.push(0);
      return;
    }
    let total = 0;
    let weighted = 0;
    for (let x = 0; x < this.width; x++) {
      let col = 0;
      for (let y = 0; y < this.height; y++) {
        const i = y * this.width + x;
        const d = Math.abs(frame[i]! - this.prev[i]!);
        if (d > 12) col += d;
      }
      total += col;
      weighted += col * ((x + 0.5) / this.width);
    }
    this.prev = frame;
    const amount = total / (this.width * this.height * 255);
    this.amount.push(Number(amount.toFixed(5)));
    this.cx.push(Number((total > 0 ? weighted / total : (this.cx[this.cx.length - 1] ?? 0.5)).toFixed(4)));
  }

  finish(): MotionTrack {
    return { hop: this.hop, cx: this.cx, amount: this.amount };
  }
}

export async function measureMotion(file: string, opts: { hop?: number; signal?: AbortSignal } = {}): Promise<MotionTrack> {
  const hop = opts.hop ?? 0.25;
  const meter = new MotionMeter(MOTION_W, MOTION_H, hop);
  await run(
    FFMPEG,
    [
      '-hide_banner',
      '-nostats',
      '-loglevel',
      'error',
      '-i',
      file,
      '-an',
      '-sn',
      '-dn',
      '-vf',
      `fps=${(1 / hop).toFixed(3)},scale=${MOTION_W}:${MOTION_H}:flags=area,format=gray`,
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { onStdout: (c) => meter.push(c), signal: opts.signal },
  );
  return meter.finish();
}
