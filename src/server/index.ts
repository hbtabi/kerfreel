import express, { type NextFunction, type Request, type Response } from 'express';
import { createWriteStream, existsSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  analyzeMedia,
  cuesToTranscript,
  DEFAULT_EXPORT_OPTIONS,
  detectHighlights,
  exportBatch,
  ffmpegVersion,
  generateSample,
  localWhisperAvailable,
  parseSubtitles,
  PRESET_IDS,
  probe,
  type AnalysisOptions,
  type ClipRequest,
  type ExportOptions,
} from '../core/index.js';
import { VERSION } from '../version.js';
import { JobQueue } from './jobs.js';
import { isValidId, ProjectStore, safeFileName, VIDEO_EXTS } from './store.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  dataDir: string;
  webDir?: string;
}

const here = dirname(fileURLToPath(import.meta.url));

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApp(opts: ServerOptions) {
  const store = new ProjectStore(resolve(opts.dataDir));
  const jobs = new JobQueue();
  const app = express();
  app.disable('x-powered-by');

  const project = async (req: Request) => {
    const id = String(req.params.id);
    if (!isValidId(id)) throw new HttpError(400, 'invalid project id');
    const p = await store.get(id);
    if (!p) throw new HttpError(404, 'project not found');
    return p;
  };

  app.get(
    '/api/health',
    h(async (_req, res) => {
      res.json({
        ok: true,
        version: VERSION,
        ffmpeg: await ffmpegVersion(),
        whisperLocal: await localWhisperAvailable(),
        openai: !!process.env.OPENAI_API_KEY,
        presets: PRESET_IDS,
        demo: false,
      });
    }),
  );

  app.get(
    '/api/projects',
    h(async (_req, res) => res.json(await store.list())),
  );

  app.post(
    '/api/projects/upload',
    h(async (req, res) => {
      const name = safeFileName(String(req.query.name ?? 'video.mp4'));
      const ext = extname(name).toLowerCase();
      if (!VIDEO_EXTS.has(ext)) throw new HttpError(415, `unsupported file type ${ext || '(none)'}`);
      const p = await store.create(name, ext);
      const dest = store.sourcePath(p);
      try {
        await pipeline(req, createWriteStream(dest));
        const media = await probe(dest);
        p.duration = media.duration;
        await store.save(p);
      } catch (err) {
        await store.remove(p.id);
        throw new HttpError(400, `could not read that file: ${(err as Error).message.split('\n')[0]}`);
      }
      res.status(201).json(p);
    }),
  );

  app.post(
    '/api/projects/sample',
    h(async (req, res) => {
      const p = await store.create('kerfreel-sample.mp4', '.mp4', { sample: true });
      const dir = store.dir(p.id);
      const duration = Math.min(120, Math.max(10, Number(req.query.duration ?? 42)));
      const result = await generateSample(join(dir, 'sample.mp4'), { duration });
      await rename(result.video, store.sourcePath(p));
      await rename(result.srt, store.subtitlesPath(p.id));
      p.hasSubtitles = true;
      p.duration = duration;
      await store.save(p);
      res.status(201).json(p);
    }),
  );

  app.get(
    '/api/projects/:id',
    h(async (req, res) => {
      const p = await project(req);
      res.json({ project: p, analysis: await store.getAnalysis(p.id), exports: await store.listExports(p.id), jobs: jobs.list(p.id) });
    }),
  );

  app.delete(
    '/api/projects/:id',
    h(async (req, res) => {
      const p = await project(req);
      await store.remove(p.id);
      res.status(204).end();
    }),
  );

  app.get(
    '/api/projects/:id/media',
    h(async (req, res) => {
      const p = await project(req);
      res.sendFile(store.sourcePath(p), { acceptRanges: true, cacheControl: false });
    }),
  );

  app.post(
    '/api/projects/:id/subtitles',
    express.text({ type: '*/*', limit: '20mb' }),
    h(async (req, res) => {
      const p = await project(req);
      const cues = parseSubtitles(String(req.body ?? ''));
      if (cues.length === 0) throw new HttpError(400, 'no subtitle cues found (expected SRT or WebVTT)');
      await writeFile(store.subtitlesPath(p.id), String(req.body));
      p.hasSubtitles = true;
      await store.save(p);
      const analysis = await store.getAnalysis(p.id);
      if (analysis) {
        analysis.transcript = cuesToTranscript(cues);
        analysis.highlights = detectHighlights(
          { duration: analysis.media.duration, energy: analysis.energy, keep: analysis.keep, motion: analysis.motion, transcript: analysis.transcript },
          analysis.options,
        );
        await store.saveAnalysis(p.id, analysis);
      }
      res.json({ cues: cues.length, analysis });
    }),
  );

  app.post(
    '/api/projects/:id/analyze',
    express.json(),
    h(async (req, res) => {
      const p = await project(req);
      const body = (req.body ?? {}) as { options?: Partial<AnalysisOptions>; transcribe?: 'auto' | 'openai' | 'local' | 'none'; llm?: boolean };
      const srt = store.subtitlesPath(p.id);
      const job = jobs.enqueue('analyze', p.id, async (update) => {
        const analysis = await analyzeMedia(store.sourcePath(p), {
          options: body.options,
          transcribe: existsSync(srt) ? { provider: 'srt', srtPath: srt } : { provider: body.transcribe ?? 'auto' },
          llm: body.llm ? {} : false,
          onProgress: (stage, prog) => update(prog, stage),
        });
        await store.saveAnalysis(p.id, analysis);
        p.analyzed = true;
        p.duration = analysis.media.duration;
        await store.save(p);
        return { highlights: analysis.highlights.length };
      });
      res.status(202).json(job);
    }),
  );

  app.post(
    '/api/projects/:id/export',
    express.json(),
    h(async (req, res) => {
      const p = await project(req);
      const analysis = await store.getAnalysis(p.id);
      if (!analysis) throw new HttpError(409, 'analyse the project first');
      const body = (req.body ?? {}) as { clips?: ClipRequest[]; options?: Partial<ExportOptions> };
      const clips = (body.clips ?? []).filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start);
      if (clips.length === 0) throw new HttpError(400, 'no clips to export');
      const options: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...body.options };
      options.presets = options.presets.filter((x) => PRESET_IDS.includes(x));
      if (options.presets.length === 0) throw new HttpError(400, 'pick at least one format');
      options.scale = Math.min(1, Math.max(0.1, Number(options.scale) || 1));
      const job = jobs.enqueue('export', p.id, async (update) => {
        const results = await exportBatch(
          { input: store.sourcePath(p), media: analysis.media, keep: analysis.keep, motion: analysis.motion, transcript: analysis.transcript },
          clips,
          options,
          store.exportsDir(p.id),
          (prog) => update(prog.overall, `clip ${prog.clipIndex + 1}/${prog.clipCount} · ${prog.preset}`),
        );
        return results.map((r) => ({ ...r, file: r.file.split(/[\\/]/).pop() }));
      });
      res.status(202).json(job);
    }),
  );

  app.get(
    '/api/projects/:id/exports/:file',
    h(async (req, res) => {
      const p = await project(req);
      const file = String(req.params.file);
      if (!/^[\w.-]+\.mp4$/.test(file)) throw new HttpError(400, 'bad file name');
      const full = join(store.exportsDir(p.id), file);
      if (!existsSync(full)) throw new HttpError(404, 'export not found');
      if (req.query.download !== undefined) res.download(full, file);
      else res.sendFile(full, { acceptRanges: true });
    }),
  );

  app.delete(
    '/api/projects/:id/exports/:file',
    h(async (req, res) => {
      const p = await project(req);
      const file = String(req.params.file);
      if (!/^[\w.-]+\.mp4$/.test(file)) throw new HttpError(400, 'bad file name');
      await rm(join(store.exportsDir(p.id), file), { force: true });
      res.status(204).end();
    }),
  );

  app.get(
    '/api/jobs/:id',
    h(async (req, res) => {
      const job = jobs.get(String(req.params.id));
      if (!job) throw new HttpError(404, 'job not found');
      res.json(job);
    }),
  );

  const webDir = opts.webDir ?? resolve(here, '..', 'web');
  if (existsSync(join(webDir, 'index.html'))) {
    app.use(express.static(webDir, { index: false, maxAge: '1h' }));
    app.get(
      /^(?!\/api\/).*/,
      h(async (_req, res) => res.type('html').send(await readFile(join(webDir, 'index.html'), 'utf8'))),
    );
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err.message });
  });

  return { app, store, jobs };
}

export async function startServer(opts: ServerOptions): Promise<{ server: Server; url: string; jobs: JobQueue; store: ProjectStore }> {
  const { app, jobs, store } = createApp(opts);
  const server = await new Promise<Server>((resolveServer, reject) => {
    const s = app.listen(opts.port ?? 5175, opts.host ?? '127.0.0.1', () => resolveServer(s));
    s.on('error', reject);
  });
  const addr = server.address() as AddressInfo;
  const host = addr.address === '::' || addr.address === '0.0.0.0' ? 'localhost' : addr.address;
  return { server, url: `http://${host}:${addr.port}`, jobs, store };
}
