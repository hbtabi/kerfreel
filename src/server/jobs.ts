import { randomBytes } from 'node:crypto';

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface Job<R = unknown> {
  id: string;
  type: string;
  projectId: string;
  status: JobStatus;
  progress: number;
  stage: string;
  error?: string;
  result?: R;
  createdAt: string;
}

type Task<R> = (update: (progress: number, stage?: string) => void) => Promise<R>;

/** Tiny in-memory job runner. Heavy ffmpeg work runs one job at a time. */
export class JobQueue {
  private readonly jobs = new Map<string, Job>();
  private chain: Promise<unknown> = Promise.resolve();

  enqueue<R>(type: string, projectId: string, task: Task<R>): Job<R> {
    const job: Job<R> = {
      id: randomBytes(6).toString('hex'),
      type,
      projectId,
      status: 'queued',
      progress: 0,
      stage: 'queued',
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job as Job);
    this.chain = this.chain.then(async () => {
      job.status = 'running';
      job.stage = 'starting';
      try {
        job.result = await task((p, stage) => {
          job.progress = Math.max(job.progress, Math.min(1, p));
          if (stage) job.stage = stage;
        });
        job.progress = 1;
        job.stage = 'done';
        job.status = 'done';
      } catch (err) {
        job.status = 'error';
        job.error = (err as Error).message;
      }
    });
    this.prune();
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  list(projectId?: string): Job[] {
    return [...this.jobs.values()].filter((j) => !projectId || j.projectId === projectId);
  }

  /** Waits for every queued job (used by tests). */
  idle(): Promise<unknown> {
    return this.chain;
  }

  private prune(): void {
    if (this.jobs.size < 200) return;
    for (const [id, j] of this.jobs) {
      if (j.status === 'done' || j.status === 'error') this.jobs.delete(id);
      if (this.jobs.size < 150) break;
    }
  }
}
