import type { MediaInfo, Range, ReframeMode } from './shared/types.js';
import { outputSize, type Preset } from './shared/presets.js';
import { cropXExpression, type CropKeyframe } from './shared/crop.js';
import { escapeFilterPath } from './ffmpeg.js';

export interface RenderSpec {
  input: string;
  output: string;
  media: MediaInfo;
  /** Source window to export. */
  range: Range;
  /** Source ranges inside `range` to keep (pause removal). Defaults to the whole range. */
  keep?: Range[];
  preset: Preset;
  reframe: ReframeMode;
  /** Crop centre keyframes on the output timeline (motion reframing). */
  crop?: CropKeyframe[];
  assPath?: string;
  fontsDir?: string;
  scale?: number;
  normalizeAudio?: boolean;
  crf?: number;
  x264Preset?: string;
  fps?: number;
}

const n = (v: number) => Number(v.toFixed(3)).toString();

/** The video filter chain that turns the cut footage into the target frame. */
export function reframeFilter(spec: Pick<RenderSpec, 'media' | 'preset' | 'reframe' | 'crop' | 'scale'>, inLabel: string, outLabel: string): string {
  const { width: W, height: H } = outputSize(spec.preset, spec.media, spec.scale ?? 1);
  const srcAspect = spec.media.width && spec.media.height ? spec.media.width / spec.media.height : 16 / 9;
  const dstAspect = W / H;
  const sameShape = spec.preset.aspect === 'source' || Math.abs(srcAspect - dstAspect) < 0.01;
  if (sameShape) return `[${inLabel}]scale=${W}:${H}:flags=lanczos,setsar=1[${outLabel}]`;

  switch (spec.reframe) {
    case 'fit':
      return `[${inLabel}]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x1a1714,setsar=1[${outLabel}]`;
    case 'blur-pad': {
      const r = Math.max(2, Math.round(Math.min(W, H) / 40));
      return (
        `[${inLabel}]split=2[kbg][kfg];` +
        `[kbg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=${r}:2,eq=brightness=-0.12:saturation=1.1[kbgb];` +
        `[kfg]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos[kfgs];` +
        `[kbgb][kfgs]overlay=(W-w)/2:(H-h)/2,setsar=1[${outLabel}]`
      );
    }
    case 'motion':
    case 'center':
    default: {
      const widerSource = srcAspect > dstAspect;
      const cw = widerSource ? `trunc(ih*${n(dstAspect)}/2)*2` : 'iw';
      const ch = widerSource ? 'ih' : `trunc(iw/${n(dstAspect)}/2)*2`;
      const x = widerSource && spec.reframe === 'motion' && spec.crop?.length ? `'${cropXExpression(spec.crop)}'` : '(iw-ow)/2';
      return `[${inLabel}]crop=w=${cw}:h=${ch}:x=${x}:y=(ih-oh)/2,scale=${W}:${H}:flags=lanczos,setsar=1[${outLabel}]`;
    }
  }
}

/** Builds the complete ffmpeg argument list for one clip. Pure, so it is unit-tested. */
export function buildRenderArgs(spec: RenderSpec): string[] {
  const { media, range } = spec;
  const fps = spec.fps ?? Math.min(60, Math.round(media.fps || 30) || 30);
  const span = range.end - range.start;
  const pieces = (spec.keep && spec.keep.length ? spec.keep : [range])
    .map((r) => ({ start: Math.max(0, r.start - range.start), end: Math.min(span, r.end - range.start) }))
    .filter((r) => r.end - r.start > 0.02);
  const parts = pieces.length ? pieces : [{ start: 0, end: span }];
  const audio = media.hasAudio;
  const k = parts.length;
  const g: string[] = [];

  if (k === 1) {
    const p = parts[0]!;
    g.push(`[0:v]trim=start=${n(p.start)}:end=${n(p.end)},setpts=PTS-STARTPTS[vc]`);
    if (audio) g.push(`[0:a]atrim=start=${n(p.start)}:end=${n(p.end)},asetpts=PTS-STARTPTS[ac]`);
  } else {
    g.push(`[0:v]split=${k}${parts.map((_, i) => `[vs${i}]`).join('')}`);
    if (audio) g.push(`[0:a]asplit=${k}${parts.map((_, i) => `[as${i}]`).join('')}`);
    parts.forEach((p, i) => {
      g.push(`[vs${i}]trim=start=${n(p.start)}:end=${n(p.end)},setpts=PTS-STARTPTS[vt${i}]`);
      if (audio) {
        const len = p.end - p.start;
        const fade = Math.min(0.012, len / 4);
        g.push(
          `[as${i}]atrim=start=${n(p.start)}:end=${n(p.end)},asetpts=PTS-STARTPTS,afade=t=in:d=${n(fade)},afade=t=out:st=${n(Math.max(0, len - fade))}:d=${n(fade)}[at${i}]`,
        );
      }
    });
    const inputs = parts.map((_, i) => (audio ? `[vt${i}][at${i}]` : `[vt${i}]`)).join('');
    g.push(`${inputs}concat=n=${k}:v=1:a=${audio ? 1 : 0}${audio ? '[vc][ac]' : '[vc]'}`);
  }

  g.push(`[vc]fps=${fps}[vf]`);
  g.push(reframeFilter(spec, 'vf', 'vr'));
  let post = 'format=yuv420p';
  if (spec.assPath) {
    const fonts = spec.fontsDir ? `:fontsdir='${escapeFilterPath(spec.fontsDir)}'` : '';
    post = `ass=filename='${escapeFilterPath(spec.assPath)}'${fonts},${post}`;
  }
  g.push(`[vr]${post}[vout]`);
  if (audio) {
    g.push(spec.normalizeAudio === false ? `[ac]aresample=48000[aout]` : `[ac]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`);
  }

  return [
    '-hide_banner',
    '-nostats',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    n(range.start),
    '-t',
    n(span + 0.05),
    '-i',
    spec.input,
    '-filter_complex',
    g.join(';'),
    '-map',
    '[vout]',
    ...(audio ? ['-map', '[aout]'] : []),
    '-c:v',
    'libx264',
    '-preset',
    spec.x264Preset ?? 'veryfast',
    '-crf',
    String(spec.crf ?? 20),
    '-r',
    String(fps),
    '-pix_fmt',
    'yuv420p',
    ...(audio ? ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000'] : []),
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    spec.output,
  ];
}
