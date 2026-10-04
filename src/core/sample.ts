import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { FFMPEG, run } from './ffmpeg.js';
import { toSrt, type Cue } from './shared/subtitles.js';

/**
 * A fully synthetic demo "talk": tone bursts with a syllable-like wobble stand in for speech,
 * separated by pauses, over brand-coloured frames with a moving subject. Nothing copyrighted.
 */
export interface SampleLine {
  start: number;
  end: number;
  text: string;
  freq: number;
  amp: number;
  /** Where the moving subject sits while this line plays (0..1 of width). */
  subject: number;
}

export const SAMPLE_LINES: SampleLine[] = [
  { start: 0.6, end: 4.4, text: 'Welcome to kerfreel, a local-first clip studio.', freq: 196, amp: 0.22, subject: 0.25 },
  { start: 5.8, end: 9.6, text: 'It listens for pauses and cuts the dead air out.', freq: 220, amp: 0.2, subject: 0.3 },
  { start: 11.4, end: 15.2, text: 'Here is the secret: loud, dense moments make great shorts!', freq: 262, amp: 0.55, subject: 0.75 },
  { start: 15.6, end: 19.8, text: 'Every clip gets animated captions, word by word.', freq: 247, amp: 0.45, subject: 0.72 },
  { start: 22.0, end: 25.6, text: 'Quiet asides score lower, so they rarely get picked.', freq: 175, amp: 0.08, subject: 0.5 },
  { start: 27.2, end: 31.4, text: 'Vertical crops follow the motion across the frame.', freq: 233, amp: 0.3, subject: 0.2 },
  { start: 31.8, end: 35.8, text: 'Then export Shorts, TikTok, Reels and widescreen in one go.', freq: 294, amp: 0.5, subject: 0.78 },
  { start: 37.6, end: 40.8, text: 'Thanks for watching. Now go make something!', freq: 208, amp: 0.35, subject: 0.5 },
];

export const SAMPLE_DURATION = 42;

export interface SampleOptions {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  text?: boolean;
}

function scaleLines(duration: number): SampleLine[] {
  const k = duration / SAMPLE_DURATION;
  return SAMPLE_LINES.map((l) => ({ ...l, start: l.start * k, end: l.end * k })).filter((l) => l.end <= duration);
}

const f = (n: number) => Number(n.toFixed(3)).toString();
const drawSafe = (s: string) =>
  s
    .replace(/[\\':,%;[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function sampleCues(duration = SAMPLE_DURATION): Cue[] {
  return scaleLines(duration).map((l) => ({ start: l.start, end: l.end, text: l.text }));
}

export function buildSampleArgs(out: string, opts: SampleOptions = {}): string[] {
  const duration = opts.duration ?? SAMPLE_DURATION;
  const W = opts.width ?? 1280;
  const H = opts.height ?? 720;
  const fps = opts.fps ?? 30;
  const lines = scaleLines(duration);

  const voice = lines
    .map((l) => `between(t,${f(l.start)},${f(l.end)})*${f(l.amp)}*(sin(2*PI*${l.freq}*t)+0.35*sin(2*PI*${l.freq * 2}*t))*(0.5+0.5*abs(sin(2*PI*2.6*t)))`)
    .join('+');
  const audio = `aevalsrc=exprs='${voice || '0'}':s=48000:d=${f(duration)}`;

  // Subject x position: glide to each line's target.
  let subjectX = `${f(0.5 * W)}`;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    subjectX = `if(lt(t,${f(l.end + 0.8)}),${f(l.subject * W)}+${f(W * 0.06)}*sin(t*2.1),${subjectX})`;
  }
  const ball = Math.round(H * 0.2);
  const bar = Math.max(2, Math.round(H * 0.0125) * 2);
  const filters: string[] = [
    `color=c=0x1a1714:s=${W}x${H}:r=${fps}:d=${f(duration)}[bg]`,
    `color=c=0xc8ff3d:s=${ball}x${ball}:r=${fps}:d=${f(duration)},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-${ball / 2},Y-${ball / 2}),${ball / 2 - 1}),255,0)'[ball]`,
    `[bg][ball]overlay=x='${subjectX}-${ball / 2}':y='${f(H * 0.42)}-${ball / 2}+${f(H * 0.05)}*sin(t*3.3)':shortest=1[vb]`,
    `color=c=0x7b5cff:s=${W}x${bar}:r=${fps}:d=${f(duration)}[bar]`,
    `[vb][bar]overlay=x='-w+w*t/${f(duration)}':y=${H - bar}:shortest=1[v0]`,
  ];
  let last = 'v0';
  const draw: string[] = ['null'];
  if (opts.text !== false) {
    draw.push(
      `drawtext=text='kerfreel  synthetic sample':x=${Math.round(W * 0.04)}:y=${Math.round(H * 0.06)}:fontsize=${Math.round(H * 0.04)}:fontcolor=0xfdf9f3@0.7`,
    );
    draw.push(`drawtext=text='%{pts\\:hms}':x=w-tw-${Math.round(W * 0.04)}:y=${Math.round(H * 0.06)}:fontsize=${Math.round(H * 0.04)}:fontcolor=0xc8ff3d`);
    lines.forEach((l, i) => {
      draw.push(
        `drawtext=text='${String(i + 1).padStart(2, '0')}  ${drawSafe(l.text)}':x=(w-tw)/2:y=${Math.round(H * 0.16)}:fontsize=${Math.round(H * 0.038)}:fontcolor=0xfdf9f3:enable='between(t,${f(l.start)},${f(l.end)})'`,
      );
    });
  }
  filters.push(`[${last}]${draw.join(',')}[vout]`);
  last = 'vout';

  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    audio,
    '-filter_complex',
    filters.join(';'),
    '-map',
    `[${last}]`,
    '-map',
    '0:a',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '28',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-t',
    f(duration),
    '-movflags',
    '+faststart',
    out,
  ];
}

export interface SampleResult {
  video: string;
  srt: string;
  withText: boolean;
}

/** Renders the sample video (and a matching SRT next to it). Falls back to no on-screen text if drawtext is unavailable. */
export async function generateSample(out: string, opts: SampleOptions = {}): Promise<SampleResult> {
  let withText = opts.text !== false;
  await mkdir(dirname(out), { recursive: true });
  try {
    await run(FFMPEG, buildSampleArgs(out, { ...opts, text: withText }));
  } catch (err) {
    if (!withText) throw err;
    withText = false;
    await run(FFMPEG, buildSampleArgs(out, { ...opts, text: false }));
  }
  const srt = out.replace(/\.[^./]+$/, '') + '.srt';
  await writeFile(srt, toSrt(sampleCues(opts.duration ?? SAMPLE_DURATION)), 'utf8');
  return { video: out, srt, withText };
}
