import { useRef, useState } from 'react';
import type { Project } from '../api';
import { formatDuration } from '../lib/shared';
import { Film, Sparkles, Trash, Upload } from './Icons';

interface Props {
  projects: Project[];
  currentId: string | null;
  demo: boolean;
  busy: string | null;
  onOpen: (id: string) => void;
  onUpload: (file: File) => void;
  onSample: () => void;
  onDelete: (id: string) => void;
}

export function Library({ projects, currentId, demo, busy, onOpen, onUpload, onSample, onDelete }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <aside className="library panel">
      <div
        className={`dropzone ${over ? 'over' : ''} ${demo ? 'disabled' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f && !demo) onUpload(f);
        }}
        onClick={() => !demo && input.current?.click()}
      >
        <Upload width={22} height={22} />
        <strong>{busy ?? 'Import a long video'}</strong>
        <span>{demo ? 'Run locally to import your own files' : 'Drop a file or click · MP4, MOV, MKV, WebM, audio'}</span>
        <input
          ref={input}
          type="file"
          accept="video/*,audio/*,.mkv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = '';
          }}
        />
      </div>
      <button className="btn ghost wide" onClick={onSample} disabled={!!busy}>
        <Sparkles width={16} height={16} /> Generate synthetic sample
      </button>
      <h3 className="section-title">Projects</h3>
      <ul className="project-list">
        {projects.length === 0 && <li className="empty">No projects yet.</li>}
        {projects.map((p) => (
          <li key={p.id} className={p.id === currentId ? 'active' : ''}>
            <button className="project" onClick={() => onOpen(p.id)}>
              <Film width={16} height={16} />
              <span className="pname">{p.name}</span>
              <span className="pmeta">
                {p.duration ? formatDuration(p.duration) : '—'} · {p.analyzed ? 'analysed' : 'new'}
                {p.hasSubtitles ? ' · captions' : ''}
              </span>
            </button>
            {!demo && (
              <button className="icon-btn subtle" title="Delete project" onClick={() => confirm(`Delete ${p.name}?`) && onDelete(p.id)}>
                <Trash width={14} height={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
