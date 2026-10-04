import type { Analysis, AnalysisOptions, ClipRequest, ExportOptions, PresetId } from './lib/shared';

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  sourceFile: string;
  hasSubtitles: boolean;
  analyzed: boolean;
  duration?: number;
  sample?: boolean;
}

export interface ExportFile {
  file: string;
  size: number;
  createdAt: string;
}

export interface Job<R = unknown> {
  id: string;
  type: string;
  projectId: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  stage: string;
  error?: string;
  result?: R;
}

export interface Health {
  ok: boolean;
  version: string;
  ffmpeg: string | null;
  whisperLocal: boolean;
  openai: boolean;
  presets: PresetId[];
  demo: boolean;
}

export interface ProjectDetail {
  project: Project;
  analysis: Analysis | null;
  exports: ExportFile[];
}

export interface AnalyzeRequest {
  options?: Partial<AnalysisOptions>;
  transcribe?: 'auto' | 'openai' | 'local' | 'none';
  llm?: boolean;
}

export interface Api {
  demo: boolean;
  health(): Promise<Health>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<ProjectDetail>;
  upload(file: File, onProgress?: (p: number) => void): Promise<Project>;
  createSample(): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  uploadSubtitles(id: string, text: string): Promise<{ cues: number; analysis: Analysis | null }>;
  analyze(id: string, req: AnalyzeRequest): Promise<Job>;
  exportClips(id: string, clips: ClipRequest[], options: ExportOptions): Promise<Job>;
  job(id: string): Promise<Job>;
  mediaUrl(id: string): string;
  exportUrl(id: string, file: string, download?: boolean): string;
  deleteExport(id: string, file: string): Promise<void>;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const post = (url: string, body?: unknown) =>
  fetch(url, { method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });

export const httpApi: Api = {
  demo: false,
  health: () => fetch('/api/health').then(json<Health>),
  listProjects: () => fetch('/api/projects').then(json<Project[]>),
  getProject: (id) => fetch(`/api/projects/${id}`).then(json<ProjectDetail>),
  upload: (file, onProgress) =>
    new Promise<Project>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/projects/upload?name=${encodeURIComponent(file.name)}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText) as Project & { error?: string };
          if (xhr.status >= 300) reject(new Error(body.error ?? `upload failed (${xhr.status})`));
          else resolve(body);
        } catch {
          reject(new Error(`upload failed (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error('upload failed'));
      xhr.send(file);
    }),
  createSample: () => post('/api/projects/sample').then(json<Project>),
  deleteProject: (id) => fetch(`/api/projects/${id}`, { method: 'DELETE' }).then(json<void>),
  uploadSubtitles: (id, text) =>
    fetch(`/api/projects/${id}/subtitles`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text }).then(
      json<{ cues: number; analysis: Analysis | null }>,
    ),
  analyze: (id, req) => post(`/api/projects/${id}/analyze`, req).then(json<Job>),
  exportClips: (id, clips, options) => post(`/api/projects/${id}/export`, { clips, options }).then(json<Job>),
  job: (id) => fetch(`/api/jobs/${id}`).then(json<Job>),
  mediaUrl: (id) => `/api/projects/${id}/media`,
  exportUrl: (id, file, download) => `/api/projects/${id}/exports/${encodeURIComponent(file)}${download ? '?download' : ''}`,
  deleteExport: (id, file) => fetch(`/api/projects/${id}/exports/${encodeURIComponent(file)}`, { method: 'DELETE' }).then(json<void>),
};

/* ------------------------------------------------------------------ */
/* Demo mode: a static build (GitHub Pages) backed by pre-rendered assets */
/* ------------------------------------------------------------------ */

const BASE = import.meta.env.BASE_URL;
const DEMO_ID = 'demo-sample';

interface DemoManifest {
  exports: { file: string; size: number; preset: PresetId; highlight: number }[];
}

function fakeJob<R>(type: string, seconds: number, result: () => Promise<R>): Job<R> {
  const job: Job<R> = { id: `demo-${Math.random().toString(36).slice(2)}`, type, projectId: DEMO_ID, status: 'running', progress: 0, stage: 'starting' };
  demoJobs.set(job.id, job as Job);
  const started = performance.now();
  const stages = type === 'analyze' ? ['probe', 'signal', 'transcript', 'highlights'] : ['rendering'];
  const tick = () => {
    const p = Math.min(1, (performance.now() - started) / (seconds * 1000));
    job.progress = p;
    job.stage = stages[Math.min(stages.length - 1, Math.floor(p * stages.length))]!;
    if (p < 1) setTimeout(tick, 120);
    else
      void result().then((r) => {
        job.result = r;
        job.status = 'done';
        job.stage = 'done';
      });
  };
  tick();
  return job;
}

const demoJobs = new Map<string, Job>();
let demoAnalysis: Promise<Analysis> | null = null;
let demoManifest: Promise<DemoManifest> | null = null;
const loadAnalysis = () => (demoAnalysis ??= fetch(`${BASE}demo/analysis.json`).then(json<Analysis>));
const loadManifest = () =>
  (demoManifest ??= fetch(`${BASE}demo/manifest.json`)
    .then(json<DemoManifest>)
    .catch(() => ({ exports: [] })));
let demoExportsVisible = false;

const demoProject: Project = {
  id: DEMO_ID,
  name: 'kerfreel-sample.mp4',
  createdAt: new Date().toISOString(),
  sourceFile: 'source.mp4',
  hasSubtitles: true,
  analyzed: true,
  duration: 42,
  sample: true,
};

const readOnly = () => Promise.reject(new Error('The live demo is read-only. Run kerfreel locally to import your own videos.'));

export const demoApi: Api = {
  demo: true,
  health: async () => ({
    ok: true,
    version: 'demo',
    ffmpeg: 'static demo',
    whisperLocal: false,
    openai: false,
    presets: ['shorts', 'tiktok', 'reels', 'youtube', 'square', 'original'],
    demo: true,
  }),
  listProjects: async () => [demoProject],
  getProject: async () => {
    const [analysis, manifest] = await Promise.all([loadAnalysis(), loadManifest()]);
    return {
      project: { ...demoProject, duration: analysis.media.duration },
      analysis,
      exports: demoExportsVisible ? manifest.exports.map((e) => ({ file: e.file, size: e.size, createdAt: new Date().toISOString() })) : [],
    };
  },
  upload: readOnly,
  createSample: async () => demoProject,
  deleteProject: readOnly,
  uploadSubtitles: readOnly,
  analyze: async () => fakeJob('analyze', 2.2, async () => ({ highlights: (await loadAnalysis()).highlights.length })),
  exportClips: async () =>
    fakeJob('export', 3, async () => {
      demoExportsVisible = true;
      return (await loadManifest()).exports;
    }),
  job: async (id) => {
    const j = demoJobs.get(id);
    if (!j) throw new Error('job not found');
    return { ...j };
  },
  mediaUrl: () => `${BASE}demo/sample.mp4`,
  exportUrl: (_id, file) => `${BASE}demo/exports/${encodeURIComponent(file)}`,
  deleteExport: readOnly,
};

export const api: Api = import.meta.env.VITE_DEMO ? demoApi : httpApi;
