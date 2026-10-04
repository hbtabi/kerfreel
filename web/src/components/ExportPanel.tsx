import type { ExportFile, Job } from '../api';
import { CAPTION_STYLES, PRESETS, PRESET_IDS, REFRAME_MODES, type ExportOptions, type PresetId } from '../lib/shared';
import { Download, Trash } from './Icons';

interface Props {
  options: ExportOptions;
  onChange: (o: ExportOptions) => void;
  selectedCount: number;
  onExport: () => void;
  job: Job | null;
  exports: ExportFile[];
  exportUrl: (file: string, download?: boolean) => string;
  onDeleteExport: (file: string) => void;
  demo: boolean;
  hasTranscript: boolean;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function ExportPanel({ options, onChange, selectedCount, onExport, job, exports, exportUrl, onDeleteExport, demo, hasTranscript }: Props) {
  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) => onChange({ ...options, [k]: v });
  const togglePreset = (id: PresetId) => set('presets', options.presets.includes(id) ? options.presets.filter((p) => p !== id) : [...options.presets, id]);
  const running = job && (job.status === 'running' || job.status === 'queued');
  const total = selectedCount * options.presets.length;
  return (
    <div className="export">
      <h4>Formats</h4>
      <div className="preset-grid">
        {PRESET_IDS.filter((id) => id !== 'original').map((id) => {
          const p = PRESETS[id];
          return (
            <button key={id} className={`preset ${options.presets.includes(id) ? 'on' : ''}`} onClick={() => togglePreset(id)}>
              <i className={`shape a-${p.aspect.replace(':', '-')}`} />
              <span>{p.label}</span>
              <small>
                {p.width}×{p.height}
              </small>
            </button>
          );
        })}
      </div>

      <h4>Captions {!hasTranscript && <span className="warn">· add an SRT or transcribe to enable</span>}</h4>
      <div className="style-grid">
        {CAPTION_STYLES.map((s) => (
          <button
            key={s.id}
            className={`style-card ${options.captionStyle === s.id ? 'on' : ''}`}
            onClick={() => set('captionStyle', s.id)}
            title={s.description}
          >
            <span className={`sample style-${s.id}`}>
              {s.id === 'none' ? (
                '—'
              ) : (
                <>
                  <b className="cw past">Make</b> <b className="cw active">it</b> <b className="cw">pop</b>
                </>
              )}
            </span>
            <span className="label">{s.label}</span>
          </button>
        ))}
      </div>

      <h4>Reframe for vertical</h4>
      <div className="radio-list">
        {REFRAME_MODES.map((m) => (
          <label key={m.id} className={`radio ${options.reframe === m.id ? 'on' : ''}`}>
            <input type="radio" name="reframe" checked={options.reframe === m.id} onChange={() => set('reframe', m.id)} />
            <span>
              <strong>{m.label}</strong>
              <small>{m.description}</small>
            </span>
          </label>
        ))}
      </div>

      <h4>Polish</h4>
      <div className="toggles">
        <label className="toggle">
          <input type="checkbox" checked={options.removeSilence} onChange={(e) => set('removeSilence', e.target.checked)} />
          <span /> Remove pauses inside clips
        </label>
        <label className="toggle">
          <input type="checkbox" checked={options.normalizeAudio} onChange={(e) => set('normalizeAudio', e.target.checked)} />
          <span /> Normalise loudness (−14 LUFS)
        </label>
        <label className="toggle">
          <input type="checkbox" checked={options.uppercase} onChange={(e) => set('uppercase', e.target.checked)} />
          <span /> UPPERCASE captions
        </label>
        <label className="field-inline">
          Quality
          <select value={options.scale} onChange={(e) => set('scale', Number(e.target.value))}>
            <option value={1}>Full (1080p)</option>
            <option value={0.5}>Draft (½ size, fast)</option>
            <option value={0.25}>Preview (¼ size)</option>
          </select>
        </label>
      </div>

      <button className="btn primary wide big" disabled={!total || !!running} onClick={onExport}>
        {running
          ? `Rendering… ${Math.round((job?.progress ?? 0) * 100)}%`
          : `Export ${selectedCount} clip${selectedCount === 1 ? '' : 's'} × ${options.presets.length} format${options.presets.length === 1 ? '' : 's'}`}
      </button>
      {running && (
        <div className="progress">
          <i style={{ width: `${(job?.progress ?? 0) * 100}%` }} />
          <span>{job?.stage}</span>
        </div>
      )}
      {job?.status === 'error' && <p className="error">{job.error}</p>}
      {demo && <p className="muted small">Demo mode plays pre-rendered clips made by the real ffmpeg pipeline in CI.</p>}

      {exports.length > 0 && (
        <>
          <h4>Exports</h4>
          <ul className="exports">
            {exports.map((f) => (
              <li key={f.file}>
                <video
                  src={exportUrl(f.file)}
                  muted
                  preload="metadata"
                  onMouseEnter={(e) => void e.currentTarget.play()}
                  onMouseLeave={(e) => e.currentTarget.pause()}
                  onClick={() => window.open(exportUrl(f.file), '_blank')}
                  title="Hover to preview, click to open"
                />
                <div className="ex-meta">
                  <span className="ex-name">{f.file}</span>
                  <small>{mb(f.size)}</small>
                </div>
                <a className="icon-btn" href={exportUrl(f.file, true)} download={f.file} title="Download">
                  <Download width={15} height={15} />
                </a>
                {!demo && (
                  <button className="icon-btn subtle" onClick={() => onDeleteExport(f.file)} title="Delete">
                    <Trash width={14} height={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
