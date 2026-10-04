import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Analysis } from '../core/shared/types.js';

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

const ID_RE = /^[a-z0-9-]{6,40}$/;
export const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi', '.mp3', '.wav', '.m4a', '.flac', '.ogg']);

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

export function safeFileName(name: string): string {
  const ext = extname(name).toLowerCase();
  const base =
    name
      .slice(0, name.length - ext.length)
      .replace(/[^\w.-]+/g, '_')
      .slice(0, 60) || 'video';
  return `${base}${ext}`;
}

/** Flat-file project storage: one folder per project, JSON metadata, no database. */
export class ProjectStore {
  constructor(readonly root: string) {}

  dir(id: string): string {
    if (!isValidId(id)) throw new Error('invalid project id');
    return join(this.root, 'projects', id);
  }

  async create(name: string, ext: string, extra: Partial<Project> = {}): Promise<Project> {
    const id = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    await mkdir(join(this.dir(id), 'exports'), { recursive: true });
    const project: Project = {
      id,
      name,
      createdAt: new Date().toISOString(),
      sourceFile: `source${ext}`,
      hasSubtitles: false,
      analyzed: false,
      ...extra,
    };
    await this.save(project);
    return project;
  }

  async save(p: Project): Promise<void> {
    await writeFile(join(this.dir(p.id), 'project.json'), JSON.stringify(p, null, 2));
  }

  async get(id: string): Promise<Project | null> {
    try {
      return JSON.parse(await readFile(join(this.dir(id), 'project.json'), 'utf8')) as Project;
    } catch {
      return null;
    }
  }

  async list(): Promise<Project[]> {
    const base = join(this.root, 'projects');
    if (!existsSync(base)) return [];
    const ids = (await readdir(base)).filter(isValidId);
    const projects = await Promise.all(ids.map((id) => this.get(id)));
    return projects.filter((p): p is Project => !!p).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async remove(id: string): Promise<void> {
    await rm(this.dir(id), { recursive: true, force: true });
  }

  sourcePath(p: Project): string {
    return join(this.dir(p.id), p.sourceFile);
  }

  subtitlesPath(id: string): string {
    return join(this.dir(id), 'captions.srt');
  }

  exportsDir(id: string): string {
    return join(this.dir(id), 'exports');
  }

  async getAnalysis(id: string): Promise<Analysis | null> {
    try {
      return JSON.parse(await readFile(join(this.dir(id), 'analysis.json'), 'utf8')) as Analysis;
    } catch {
      return null;
    }
  }

  async saveAnalysis(id: string, a: Analysis): Promise<void> {
    await writeFile(join(this.dir(id), 'analysis.json'), JSON.stringify(a));
  }

  async listExports(id: string): Promise<{ file: string; size: number; createdAt: string }[]> {
    const dir = this.exportsDir(id);
    if (!existsSync(dir)) return [];
    const files = (await readdir(dir)).filter((f) => f.endsWith('.mp4'));
    const out = await Promise.all(
      files.map(async (file) => {
        const s = await stat(join(dir, file));
        return { file, size: s.size, createdAt: s.mtime.toISOString() };
      }),
    );
    return out.sort((a, b) => a.file.localeCompare(b.file));
  }
}
