import type { MotionTrack, Range } from './types.js';
import { clamp, type TimeMap } from './ranges.js';

export interface CropKeyframe {
  t: number;
  /** Centre of the crop window as a fraction of source width. */
  cx: number;
}

export interface CropPathOptions {
  step?: number;
  /** 0..1, higher = smoother, lazier camera. */
  smoothing?: number;
  /** Ignore target changes smaller than this fraction of the width. */
  deadzone?: number;
  minAmount?: number;
}

/**
 * Plans a virtual camera that follows motion inside `range` (source time).
 * Uses motion-weighted centroids, hysteresis and forward/backward smoothing so the crop glides.
 */
export function planCropPath(motion: MotionTrack | undefined, range: Range, opts: CropPathOptions = {}): CropKeyframe[] {
  const step = opts.step ?? 0.5;
  const smoothing = opts.smoothing ?? 0.8;
  const deadzone = opts.deadzone ?? 0.05;
  const minAmount = opts.minAmount ?? 0.004;
  const raw: CropKeyframe[] = [];
  let held = 0.5;
  for (let t = range.start; t <= range.end + 1e-6; t += step) {
    let wsum = 0;
    let csum = 0;
    let count = 0;
    if (motion && motion.hop > 0) {
      const i0 = Math.max(0, Math.floor((t - step) / motion.hop));
      const i1 = Math.min(motion.cx.length - 1, Math.ceil((t + step) / motion.hop));
      for (let i = i0; i <= i1; i++) {
        const a = motion.amount[i] ?? 0;
        const c = motion.cx[i] ?? 0.5;
        wsum += a;
        csum += a * c;
        count++;
      }
    }
    if (count > 0 && wsum / count > minAmount) {
      const target = csum / wsum;
      if (Math.abs(target - held) > deadzone) held = target;
    }
    raw.push({ t: Math.min(t, range.end), cx: held });
  }
  if (raw.length === 0) return [{ t: range.start, cx: 0.5 }];
  // Forward/backward exponential smoothing (zero-phase).
  const a = clamp(smoothing, 0, 0.98);
  const fwd = raw.map((k) => k.cx);
  for (let i = 1; i < fwd.length; i++) fwd[i] = a * fwd[i - 1]! + (1 - a) * fwd[i]!;
  for (let i = fwd.length - 2; i >= 0; i--) fwd[i] = a * fwd[i + 1]! + (1 - a) * fwd[i]!;
  return raw.map((k, i) => ({ t: k.t, cx: clamp(fwd[i]!, 0, 1) }));
}

/** Moves keyframes from source time onto the output timeline (cut instants are dropped). */
export function remapKeyframes(keys: CropKeyframe[], map: TimeMap): CropKeyframe[] {
  const out: CropKeyframe[] = [];
  for (const k of keys) {
    const o = map.toOutput(k.t);
    if (o === null) continue;
    const last = out[out.length - 1];
    if (last && o - last.t < 1e-3) continue;
    out.push({ t: o, cx: k.cx });
  }
  return out.length ? out : [{ t: 0, cx: keys[0]?.cx ?? 0.5 }];
}

function decimate(keys: CropKeyframe[], max: number): CropKeyframe[] {
  if (keys.length <= max) return keys;
  const out: CropKeyframe[] = [];
  const stride = (keys.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(keys[Math.round(i * stride)]!);
  return out;
}

const n = (v: number) => Number(v.toFixed(4)).toString();

/**
 * ffmpeg expression for the crop centre fraction as a piecewise-linear function of t.
 * Keyframes are in output time.
 */
export function centreExpression(keys: CropKeyframe[], maxKeys = 40): string {
  const k = decimate(keys, maxKeys);
  if (k.length === 1) return n(k[0]!.cx);
  let expr = n(k[k.length - 1]!.cx);
  for (let i = k.length - 2; i >= 0; i--) {
    const a = k[i]!;
    const b = k[i + 1]!;
    const seg = Math.abs(b.cx - a.cx) < 1e-4 ? n(a.cx) : `${n(a.cx)}+${n(b.cx - a.cx)}*(t-${n(a.t)})/${n(Math.max(1e-3, b.t - a.t))}`;
    expr = `if(lt(t,${n(b.t)}),${seg},${expr})`;
  }
  return `if(lt(t,${n(k[0]!.t)}),${n(k[0]!.cx)},${expr})`;
}

/** Full crop `x` expression clamped inside the frame. */
export function cropXExpression(keys: CropKeyframe[]): string {
  return `clip(iw*(${centreExpression(keys)})-ow/2,0,iw-ow)`;
}

/** Evaluates the piecewise-linear path in JS (used by the UI preview and tests). */
export function centreAt(keys: CropKeyframe[], t: number): number {
  if (keys.length === 0) return 0.5;
  const first = keys[0]!;
  if (t <= first.t) return first.cx;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t < b.t) return a.cx + ((b.cx - a.cx) * (t - a.t)) / Math.max(1e-3, b.t - a.t);
  }
  return keys[keys.length - 1]!.cx;
}
