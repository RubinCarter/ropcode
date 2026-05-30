#!/usr/bin/env python3
"""
Extract protocol event samples from Claude and Codex JSONL history files.
Categorizes events by type and saves one sample per category.
"""

import json
import os
import sys
from pathlib import Path
from collections import defaultdict

OUTPUT_DIR = Path(__file__).parent / "output"
CLAUDE_DIR = Path.home() / ".claude"
CODEX_DIR = Path.home() / ".codex"


def find_claude_sessions(limit=5):
    """Find recent Claude session JSONL files, sorted by size (larger = more diverse)."""
    projects_dir = CLAUDE_DIR / "projects"
    if not projects_dir.exists():
        return []
    all_files = list(projects_dir.rglob("*.jsonl"))
    all_files.sort(key=lambda p: p.stat().st_size, reverse=True)
    return all_files[:limit]


def find_codex_sessions(limit=5):
    """Find recent Codex session JSONL files."""
    sessions_dir = CODEX_DIR / "sessions"
    if not sessions_dir.exists():
        return []
    files = sorted(sessions_dir.rglob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[:limit]


def truncate_str(s, max_len=200):
    if isinstance(s, str) and len(s) > max_len:
        return s[:max_len] + f"... [truncated, total {len(s)} chars]"
    return s


def truncate_obj(obj, max_str=200, max_list=3):
    """Recursively truncate long strings and lists for readability."""
    if isinstance(obj, str):
        return truncate_str(obj, max_str)
    elif isinstance(obj, list):
        if len(obj) > max_list:
            return [truncate_obj(item, max_str, max_list) for item in obj[:max_list]] + [f"... ({len(obj) - max_list} more items)"]
        return [truncate_obj(item, max_str, max_list) for item in obj]
    elif isinstance(obj, dict):
        return {k: truncate_obj(v, max_str, max_list) for k, v in obj.items()}
    return obj


# ============================================================
# Claude extraction
# ============================================================

def extract_claude_samples(sessions):
    """Extract one sample per event category from Claude sessions."""
    samples = {}

    for session_path in sessions:
        with open(session_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue

                category = classify_claude_event(obj)
                if category and category not in samples:
                    samples[category] = obj

        if len(samples) >= 20:
            break

    return samples


def classify_claude_event(obj):
    """Classify a Claude JSONL event into a category."""
    t = obj.get("type", "")

    if t == "assistant":
        msg = obj.get("message", {})
        content = msg.get("content", [])
        if not content:
            return "assistant/empty"
        content_types = set()
        for c in content:
            if isinstance(c, dict):
                content_types.add(c.get("type", ""))
        if "tool_use" in content_types:
            return "assistant/tool_use"
        if "thinking" in content_types:
            return "assistant/thinking"
        if "text" in content_types:
            return "assistant/text"
        return f"assistant/{'+'.join(sorted(content_types))}"

    elif t == "user":
        msg = obj.get("message", {})
        content = msg.get("content", [])
        if not content:
            return "user/empty"
        content_types = set()
        for c in content:
            if isinstance(c, dict):
                content_types.add(c.get("type", ""))
            elif isinstance(c, str):
                content_types.add("text_str")
        if "tool_result" in content_types:
            return "user/tool_result"
        if "text" in content_types or "text_str" in content_types:
            return "user/text"
        return f"user/{'+'.join(sorted(content_types))}"

    elif t == "system":
        subtype = obj.get("subtype", "unknown")
        return f"system/{subtype}"

    elif t == "result":
        return "result"

    elif t in ("queue-operation", "last-prompt", "attachment"):
        return t

    elif t:
        return t

    return None


# ============================================================
# Codex extraction
# ============================================================

def extract_codex_samples(sessions):
    """Extract one sample per event category from Codex sessions."""
    samples = {}

    for session_path in sessions:
        with open(session_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue

                category = classify_codex_event(obj)
                if category and category not in samples:
                    samples[category] = obj

    return samples


def classify_codex_event(obj):
    """Classify a Codex JSONL event into a category."""
    t = obj.get("type", "")

    if t == "session_meta":
        payload = obj.get("payload", {})
        source = payload.get("source", {})
        if "subagent" in source:
            return "session_meta/subagent"
        return "session_meta"

    elif t == "turn_context":
        return "turn_context"

    elif t == "event_msg":
        payload = obj.get("payload", {})
        pt = payload.get("type", "")
        return f"event_msg/{pt}"

    elif t == "response_item":
        payload = obj.get("payload", {})
        pt = payload.get("type", "")
        if pt == "function_call":
            name = payload.get("name", "")
            ns = payload.get("namespace", "")
            if ns:
                return f"response_item/function_call/{ns}.{name}"
            return f"response_item/function_call/{name}"
        return f"response_item/{pt}"

    elif t == "item.completed":
        item = obj.get("item", {})
        it = item.get("type", "")
        return f"item.completed/{it}"

    elif t in ("thread.started", "thread.completed", "thread.cancelled",
               "thread.error", "turn.completed", "turn.failed",
               "message.delta"):
        return t

    elif t:
        return t

    return None


# ============================================================
# Main
# ============================================================

def save_samples(samples, provider_name):
    """Save samples to output directory."""
    out_dir = OUTPUT_DIR / provider_name
    out_dir.mkdir(parents=True, exist_ok=True)

    # Save individual samples
    for category, obj in sorted(samples.items()):
        safe_name = category.replace("/", "__").replace(".", "_")
        filepath = out_dir / f"{safe_name}.json"
        with open(filepath, "w") as f:
            json.dump(truncate_obj(obj, max_str=500, max_list=5), f, indent=2, ensure_ascii=False)

    # Save index
    index_path = out_dir / "_index.json"
    with open(index_path, "w") as f:
        json.dump({
            "provider": provider_name,
            "categories": sorted(samples.keys()),
            "total_categories": len(samples),
        }, f, indent=2, ensure_ascii=False)

    print(f"  [{provider_name}] Saved {len(samples)} event categories to {out_dir}")


def main():
    print("=" * 60)
    print("Protocol Event Sample Extractor")
    print("=" * 60)

    # Claude
    print("\n[1/2] Extracting Claude history samples...")
    claude_sessions = find_claude_sessions(limit=5)
    print(f"  Found {len(claude_sessions)} Claude sessions")
    if claude_sessions:
        claude_samples = extract_claude_samples(claude_sessions)
        save_samples(claude_samples, "claude")
    else:
        print("  No Claude sessions found!")

    # Codex
    print("\n[2/2] Extracting Codex history samples...")
    codex_sessions = find_codex_sessions(limit=10)
    print(f"  Found {len(codex_sessions)} Codex sessions")
    if codex_sessions:
        codex_samples = extract_codex_samples(codex_sessions)
        save_samples(codex_samples, "codex")
    else:
        print("  No Codex sessions found!")

    print("\n" + "=" * 60)
    print("Done! Samples saved to:", OUTPUT_DIR)


if __name__ == "__main__":
    main()
