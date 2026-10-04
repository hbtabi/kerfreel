import { useEffect, useRef, useState } from 'react';
import { api, type Job } from '../api';

/** Polls a background job until it finishes. */
export function useJob(onDone?: (job: Job) => void) {
  const [job, setJob] = useState<Job | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error') return;
    const t = setTimeout(async () => {
      try {
        const next = await api.job(job.id);
        setJob(next);
        if (next.status === 'done' || next.status === 'error') doneRef.current?.(next);
      } catch (err) {
        setJob({ ...job, status: 'error', error: (err as Error).message });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [job]);

  return [job, setJob] as const;
}
