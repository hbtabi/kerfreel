import type { Highlight, Transcript } from './shared/types.js';
import { transcriptText } from './shared/subtitles.js';
import { formatTime } from './shared/format.js';
import { clamp } from './shared/ranges.js';

export interface LlmOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** 0..1 share of the final score that comes from the model. */
  blend?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

interface LlmRanking {
  ranking?: { id: string; score: number; title?: string; reason?: string }[];
}

export function buildRankingPrompt(highlights: Highlight[], transcript: Transcript | undefined): string {
  const items = highlights.map((h) => {
    const text = transcriptText(transcript, h).slice(0, 700) || '(no transcript)';
    return `- id: ${h.id}\n  time: ${formatTime(h.start)}-${formatTime(h.end)}\n  heuristic: ${h.score}\n  text: ${text}`;
  });
  return [
    'You are a short-form video editor. Rate each candidate clip 0-10 for how well it would perform',
    'as a standalone YouTube Short / TikTok / Reel: a strong hook in the first seconds, a complete thought,',
    'emotion or surprise, and clear value. Also write a punchy title (max 8 words) and a one-line reason.',
    'Reply with JSON only: {"ranking":[{"id":"...","score":0-10,"title":"...","reason":"..."}]}',
    '',
    'Candidates:',
    ...items,
  ].join('\n');
}

/** Merges a model's ratings into heuristic highlights and re-sorts them. */
export function applyRanking(highlights: Highlight[], ranking: LlmRanking, blend = 0.4): Highlight[] {
  const byId = new Map((ranking.ranking ?? []).map((r) => [r.id, r]));
  return highlights
    .map((h) => {
      const r = byId.get(h.id);
      if (!r || typeof r.score !== 'number') return h;
      const llm = clamp(r.score / 10, 0, 1);
      return {
        ...h,
        score: Number(((1 - blend) * h.score + blend * llm * 100).toFixed(1)),
        breakdown: { ...h.breakdown, llm },
        title: r.title?.trim() || h.title,
        reason: r.reason?.trim() || h.reason,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export async function rankWithLlm(highlights: Highlight[], transcript: Transcript | undefined, opts: LlmOptions = {}): Promise<Highlight[]> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey || highlights.length === 0) return highlights;
  const baseUrl = (opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = opts.model ?? process.env.KERFREEL_LLM_MODEL ?? 'gpt-4o-mini';
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: buildRankingPrompt(highlights, transcript) }],
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`LLM API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? '{}';
  const json = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1) || '{}';
  return applyRanking(highlights, JSON.parse(json) as LlmRanking, opts.blend ?? 0.4);
}
