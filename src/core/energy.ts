import { FFMPEG, run } from './ffmpeg.js';
import type { EnergyTrack } from './shared/types.js';

export const ENERGY_SAMPLE_RATE = 16000;

/** Streaming RMS loudness meter over 16-bit little-endian mono PCM. */
export class EnergyMeter {
  private readonly window: number;
  private sumSq = 0;
  private count = 0;
  private carry: Buffer | null = null;
  readonly db: number[] = [];

  constructor(
    readonly sampleRate = ENERGY_SAMPLE_RATE,
    readonly hop = 0.25,
  ) {
    this.window = Math.max(1, Math.round(sampleRate * hop));
  }

  push(chunk: Buffer): void {
    let buf = chunk;
    if (this.carry) {
      buf = Buffer.concat([this.carry, chunk]);
      this.carry = null;
    }
    const usable = buf.length - (buf.length % 2);
    for (let i = 0; i < usable; i += 2) {
      const s = buf.readInt16LE(i) / 32768;
      this.sumSq += s * s;
      if (++this.count === this.window) this.flushWindow();
    }
    if (usable < buf.length) this.carry = buf.subarray(usable);
  }

  private flushWindow(): void {
    const rms = Math.sqrt(this.sumSq / Math.max(1, this.count));
    this.db.push(Number(Math.max(-90, 20 * Math.log10(rms + 1e-9)).toFixed(2)));
    this.sumSq = 0;
    this.count = 0;
  }

  finish(): EnergyTrack {
    if (this.count > this.window * 0.25) this.flushWindow();
    return { hop: this.hop, db: this.db };
  }
}

export async function measureEnergy(file: string, opts: { hop?: number; signal?: AbortSignal } = {}): Promise<EnergyTrack> {
  const meter = new EnergyMeter(ENERGY_SAMPLE_RATE, opts.hop ?? 0.25);
  await run(
    FFMPEG,
    ['-hide_banner', '-nostats', '-loglevel', 'error', '-i', file, '-vn', '-sn', '-dn', '-ac', '1', '-ar', String(ENERGY_SAMPLE_RATE), '-f', 's16le', 'pipe:1'],
    { onStdout: (c) => meter.push(c), signal: opts.signal },
  );
  return meter.finish();
}
