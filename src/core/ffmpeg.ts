import { spawn, type ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import type { MediaInfo } from './shared/types.js';

export const FFMPEG = process.env.KERFREEL_FFMPEG || 'ffmpeg';
export const FFPROBE = process.env.KERFREEL_FFPROBE || 'ffprobe';

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'FfmpegError';
  }
}

export interface RunOptions {
  onStdout?: (chunk: Buffer) => void;
  onStderrLine?: (line: string) => void;
  signal?: AbortSignal;
  /** Keep at most this many trailing stderr bytes for error messages. */
  stderrLimit?: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Spawns a binary without a shell, collecting output and surfacing a readable error. */
export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], signal: opts.signal });
    } catch (err) {
      reject(err);
      return;
    }
    const limit = opts.stderrLimit ?? 2_000_000;
    const out: Buffer[] = [];
    let stderr = '';
    let pending = '';
    child.stdout?.on('data', (c: Buffer) => {
      if (opts.onStdout) opts.onStdout(c);
      else out.push(c);
    });
    child.stderr?.on('data', (c: Buffer) => {
      const s = c.toString('utf8');
      stderr += s;
      if (stderr.length > limit) stderr = stderr.slice(-limit);
      if (opts.onStderrLine) {
        pending += s;
        const lines = pending.split(/\r?\n|\r/);
        pending = lines.pop() ?? '';
        lines.forEach((l) => opts.onStderrLine!(l));
      }
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') reject(new FfmpegError(`${bin} not found. Install ffmpeg and make sure it is on PATH.`, null, ''));
      else reject(err);
    });
    child.on('close', (code) => {
      if (opts.onStderrLine && pending) opts.onStderrLine(pending);
      if (code === 0) resolve({ stdout: Buffer.concat(out).toString('utf8'), stderr });
      else {
        const tail = stderr.trim().split('\n').slice(-8).join('\n');
        reject(new FfmpegError(`${bin} exited with code ${code}\n${tail}`, code, stderr));
      }
    });
  });
}

export async function ffmpegVersion(): Promise<string | null> {
  try {
    const { stdout } = await run(FFMPEG, ['-hide_banner', '-version']);
    return (
      stdout
        .split('\n')[0]
        ?.replace(/^ffmpeg version\s*/, '')
        .split(' ')[0] ?? 'unknown'
    );
  } catch {
    return null;
  }
}

export async function hasFilter(name: string): Promise<boolean> {
  try {
    const { stdout } = await run(FFMPEG, ['-hide_banner', '-filters']);
    return new RegExp(`\\s${name}\\s`).test(stdout);
  } catch {
    return false;
  }
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

function parseRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [a, b] = rate.split('/').map(Number);
  if (!a || !b) return Number(rate) || 0;
  return a / b;
}

export function parseProbe(json: string, path: string, sizeBytes = 0): MediaInfo {
  const data = JSON.parse(json) as { streams?: ProbeStream[]; format?: { duration?: string; size?: string } };
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  let width = v?.width ?? 0;
  let height = v?.height ?? 0;
  const rotation = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0));
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  const duration = Number(data.format?.duration ?? v?.duration ?? 0) || 0;
  return {
    path,
    duration,
    width,
    height,
    fps: Number((parseRate(v?.avg_frame_rate) || parseRate(v?.r_frame_rate) || 0).toFixed(3)),
    hasAudio: !!a,
    hasVideo: !!v,
    sizeBytes: sizeBytes || Number(data.format?.size ?? 0),
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name,
  };
}

export async function probe(path: string): Promise<MediaInfo> {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path]);
  const size = (await stat(path)).size;
  return parseProbe(stdout, path, size);
}

/** Parses `-progress pipe:1` key=value output into seconds processed. */
export function parseProgressChunk(chunk: string): { seconds?: number; done: boolean } {
  let seconds: number | undefined;
  let done = false;
  for (const line of chunk.split('\n')) {
    const [k, v] = line.trim().split('=');
    if ((k === 'out_time_us' || k === 'out_time_ms') && v && /^\d+$/.test(v)) seconds = Number(v) / 1_000_000;
    if (k === 'progress' && v === 'end') done = true;
  }
  return { seconds, done };
}

/** Escapes a value for use inside a single-quoted filtergraph option (e.g. a file path). */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
