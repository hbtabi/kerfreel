#!/usr/bin/env python3
"""Local transcription helper for kerfreel.

Prints OpenAI-style verbose_json (segments + word timestamps) to stdout.
Uses faster-whisper when installed, otherwise openai-whisper.
    pip install faster-whisper   # recommended
"""
import argparse
import json
import sys


def with_faster_whisper(path, model_name, language):
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="auto", compute_type="auto")
    segments, info = model.transcribe(path, language=language, word_timestamps=True, vad_filter=True)
    out = {"language": info.language, "segments": []}
    for s in segments:
        out["segments"].append({
            "start": round(s.start, 3),
            "end": round(s.end, 3),
            "text": s.text.strip(),
            "words": [{"start": round(w.start, 3), "end": round(w.end, 3), "word": w.word.strip()} for w in (s.words or [])],
        })
    return out


def with_openai_whisper(path, model_name, language):
    import whisper

    model = whisper.load_model(model_name)
    result = model.transcribe(path, language=language, word_timestamps=True)
    return {
        "language": result.get("language"),
        "segments": [
            {
                "start": round(s["start"], 3),
                "end": round(s["end"], 3),
                "text": s["text"].strip(),
                "words": [{"start": round(w["start"], 3), "end": round(w["end"], 3), "word": w["word"].strip()} for w in s.get("words", [])],
            }
            for s in result["segments"]
        ],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default=None)
    args = parser.parse_args()
    try:
        result = with_faster_whisper(args.input, args.model, args.language)
    except ImportError:
        try:
            result = with_openai_whisper(args.input, args.model, args.language)
        except ImportError:
            print("Install faster-whisper (pip install faster-whisper) or openai-whisper.", file=sys.stderr)
            sys.exit(2)
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
