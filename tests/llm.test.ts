import { describe, expect, it } from 'vitest';
import { applyRanking, buildRankingPrompt, rankWithLlm } from '../src/core/llm.js';
import { parseVerboseJson } from '../src/core/transcribe.js';
import type { Highlight } from '../src/core/shared/types.js';

const hl = (id: string, score: number): Highlight => ({
  id,
  start: 0,
  end: 10,
  score,
  title: id,
  breakdown: { loudness: 0, dynamics: 0, speech: 0, keywords: 0, motion: 0, hook: 0 },
});

describe('LLM reranking', () => {
  it('blends model scores and reorders', () => {
    const out = applyRanking(
      [hl('a', 80), hl('b', 60)],
      {
        ranking: [
          { id: 'b', score: 10, title: 'Better title' },
          { id: 'a', score: 2 },
        ],
      },
      0.5,
    );
    expect(out[0]!.id).toBe('b');
    expect(out[0]!.score).toBe(80);
    expect(out[0]!.title).toBe('Better title');
    expect(out[0]!.breakdown.llm).toBe(1);
  });

  it('calls an OpenAI-compatible endpoint with a JSON prompt', async () => {
    let seen: { url: string; body: { model: string; messages: { content: string }[] } } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"ranking":[{"id":"a","score":9,"reason":"great hook"}]}\n```' } }] }));
    }) as unknown as typeof fetch;
    const out = await rankWithLlm([hl('a', 50)], undefined, { apiKey: 'test', baseUrl: 'http://llm.local/v1/', model: 'tiny', fetchImpl: fakeFetch });
    expect(seen!.url).toBe('http://llm.local/v1/chat/completions');
    expect(seen!.body.model).toBe('tiny');
    expect(out[0]!.reason).toBe('great hook');
    expect(buildRankingPrompt([hl('a', 50)], undefined)).toContain('id: a');
  });

  it('is a no-op without an API key', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const hs = [hl('a', 1)];
    expect(await rankWithLlm(hs, undefined)).toBe(hs);
    if (prev) process.env.OPENAI_API_KEY = prev;
  });
});

describe('transcription response parsing', () => {
  it('normalises verbose_json with top-level words', () => {
    const t = parseVerboseJson(
      {
        language: 'en',
        segments: [{ start: 0, end: 2, text: ' Hello world ' }],
        words: [
          { start: 0, end: 0.5, word: 'Hello' },
          { start: 0.6, end: 1.2, word: ' world' },
        ],
      },
      'openai',
    );
    expect(t.segments[0]!.text).toBe('Hello world');
    expect(t.segments[0]!.words.map((w) => w.text)).toEqual(['Hello', 'world']);
  });

  it('falls back to distributed words when none are given', () => {
    const t = parseVerboseJson({ segments: [{ start: 0, end: 1, text: 'two words' }] }, 'whisper-local');
    expect(t.segments[0]!.words).toHaveLength(2);
  });
});
