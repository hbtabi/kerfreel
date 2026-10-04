import { useState } from 'react';
import type { AnalyzeRequest, Health, Job } from '../api';
import { DEFAULT_ANALYSIS_OPTIONS, type AnalysisOptions } from '../lib/shared';

interface Props {
  initial?: AnalysisOptions;
  health: Health | null;
  job: Job | null;
  hasSubtitles: boolean;
  onAnalyze: (req: AnalyzeRequest) => void;
  onSubtitles: (text: string) => void;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span className="row between">
        <span>{label}</span>
        <b>
          {value}
          {unit}
        </b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function AnalysePanel({ initial, health, job, hasSubtitles, onAnalyze, onSubtitles }: Props) {
  const [o, setO] = useState<AnalysisOptions>(initial ?? DEFAULT_ANALYSIS_OPTIONS);
  const [keywords, setKeywords] = useState((initial?.keywords ?? []).join(', '));
  const [transcribe, setTranscribe] = useState<AnalyzeRequest['transcribe']>('auto');
  const [llm, setLlm] = useState(false);
  const set = (k: keyof AnalysisOptions, v: number) => setO({ ...o, [k]: v });
  const running = job && (job.status === 'running' || job.status === 'queued');

  return (
    <div className="analyse">
      <h4>Pause detection</h4>
      <Slider label="Silence threshold" value={o.noiseDb} min={-60} max={-15} step={1} unit=" dB" onChange={(v) => set('noiseDb', v)} />
      <Slider label="Shortest pause to cut" value={o.minSilence} min={0.2} max={3} step={0.1} unit=" s" onChange={(v) => set('minSilence', v)} />
      <Slider label="Breathing room" value={o.padding} min={0} max={0.5} step={0.02} unit=" s" onChange={(v) => set('padding', v)} />

      <h4>Highlights</h4>
      <Slider label="Clips to find" value={o.count} min={1} max={20} step={1} unit="" onChange={(v) => set('count', v)} />
      <Slider label="Shortest clip" value={o.minClip} min={3} max={60} step={1} unit=" s" onChange={(v) => set('minClip', Math.min(v, o.maxClip))} />
      <Slider label="Target length" value={o.targetClip} min={3} max={90} step={1} unit=" s" onChange={(v) => set('targetClip', v)} />
      <Slider label="Longest clip" value={o.maxClip} min={5} max={180} step={1} unit=" s" onChange={(v) => set('maxClip', Math.max(v, o.minClip))} />
      <label className="field">
        <span>Boost keywords</span>
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="secret, giveaway, clutch" />
      </label>

      <h4>Captions & ranking</h4>
      <label className="field">
        <span>Subtitles (SRT / VTT){hasSubtitles ? ' · loaded ✓' : ''}</span>
        <input
          type="file"
          accept=".srt,.vtt,text/vtt"
          disabled={health?.demo}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) onSubtitles(await f.text());
            e.target.value = '';
          }}
        />
      </label>
      <label className="field">
        <span>Transcription when there is no SRT</span>
        <select value={transcribe} onChange={(e) => setTranscribe(e.target.value as AnalyzeRequest['transcribe'])}>
          <option value="auto">Auto (API → local whisper → none)</option>
          <option value="openai" disabled={!health?.openai}>
            OpenAI-compatible API{health?.openai ? '' : ' (set OPENAI_API_KEY)'}
          </option>
          <option value="local" disabled={!health?.whisperLocal}>
            Local whisper{health?.whisperLocal ? '' : ' (pip install faster-whisper)'}
          </option>
          <option value="none">None</option>
        </select>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={llm} disabled={!health?.openai} onChange={(e) => setLlm(e.target.checked)} />
        <span /> Rerank with an LLM {health?.openai ? '' : '(needs OPENAI_API_KEY)'}
      </label>

      <button
        className="btn primary wide big"
        disabled={!!running}
        onClick={() =>
          onAnalyze({
            options: {
              ...o,
              keywords: keywords
                .split(',')
                .map((k) => k.trim())
                .filter(Boolean),
            },
            transcribe,
            llm,
          })
        }
      >
        {running ? `Analysing… ${job?.stage}` : 'Analyse video'}
      </button>
      {running && (
        <div className="progress">
          <i style={{ width: `${(job?.progress ?? 0) * 100}%` }} />
        </div>
      )}
      {job?.status === 'error' && <p className="error">{job.error}</p>}
    </div>
  );
}
