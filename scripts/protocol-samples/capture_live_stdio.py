#!/usr/bin/env python3
"""
Capture live stdio protocol events from Codex app-server and Claude.

Spawns each provider in stdio mode, sends a prompt that triggers:
- text output
- tool use (shell command)
- tool result
- error handling
- (codex) reasoning

Saves raw JSONL output to output/live/ directory.
"""

import json
import os
import subprocess
import sys
import time
import signal
import threading
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "output" / "live"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def find_binary(name):
    """Find binary in PATH or common locations."""
    result = subprocess.run(["which", name], capture_output=True, text=True)
    if result.returncode == 0:
        return result.stdout.strip()
    return None


# ============================================================
# Codex Live Capture (JSON-RPC stdio protocol)
# ============================================================

def capture_codex_interactive():
    """
    Capture Codex app-server JSON-RPC protocol.
    This is the LIVE protocol (different from stored JSONL).
    """
    codex_bin = find_binary("codex")
    if not codex_bin:
        print("  [SKIP] codex binary not found")
        return

    print(f"  Using: {codex_bin}")
    out_file = OUTPUT_DIR / "codex_stdio_interactive.jsonl"

    args = [codex_bin, "app-server", "--listen", "stdio://"]

    env = os.environ.copy()
    env["CODEX_APPROVAL_POLICY"] = "never"

    proc = subprocess.Popen(
        args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        text=False,
    )

    lines = []
    stderr_lines = []

    def read_stdout():
        for raw_line in proc.stdout:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if line:
                lines.append(line)

    def read_stderr():
        for raw_line in proc.stderr:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if line:
                stderr_lines.append(line)

    t_out = threading.Thread(target=read_stdout, daemon=True)
    t_err = threading.Thread(target=read_stderr, daemon=True)
    t_out.start()
    t_err.start()

    def send_jsonrpc(obj):
        data = json.dumps(obj).encode("utf-8") + b"\n"
        proc.stdin.write(data)
        proc.stdin.flush()

    try:
        # Step 1: initialize
        send_jsonrpc({
            "jsonrpc": "2.0",
            "id": "init_1",
            "method": "initialize",
            "params": {
                "clientInfo": {"name": "ropcode-capture", "version": "0.1.0"},
            }
        })
        time.sleep(2)

        # Step 2: initialized notification
        send_jsonrpc({
            "jsonrpc": "2.0",
            "method": "initialized",
            "params": {}
        })
        time.sleep(1)

        # Step 3: thread/start
        send_jsonrpc({
            "jsonrpc": "2.0",
            "id": "thread_1",
            "method": "thread/start",
            "params": {}
        })
        time.sleep(2)

        # Step 4: send a prompt that will trigger tool use
        # Extract thread ID from responses
        thread_id = None
        for line in lines:
            try:
                obj = json.loads(line)
                if obj.get("id") == "thread_1":
                    result = obj.get("result", {})
                    thread = result.get("thread", {})
                    thread_id = thread.get("id", "")
            except:
                pass

        if not thread_id:
            print("  [WARN] Could not extract thread_id, using fallback")
            thread_id = "unknown"

        print(f"  Thread ID: {thread_id}")

        # Send a prompt that triggers shell command execution
        send_jsonrpc({
            "jsonrpc": "2.0",
            "id": "turn_1",
            "method": "turn/start",
            "params": {
                "threadId": thread_id,
                "input": [{"type": "text", "text": "Run `echo hello_world` and `ls /tmp | head -3`, then tell me the results."}],
            }
        })

        # Wait for response
        print("  Waiting for Codex response (30s max)...")
        time.sleep(30)

    except Exception as e:
        print(f"  [ERROR] {e}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except:
            proc.kill()

    # Save output
    with open(out_file, "w") as f:
        for line in lines:
            f.write(line + "\n")

    # Save stderr
    stderr_file = OUTPUT_DIR / "codex_stdio_interactive_stderr.txt"
    with open(stderr_file, "w") as f:
        for line in stderr_lines:
            f.write(line + "\n")

    print(f"  Captured {len(lines)} stdout lines, {len(stderr_lines)} stderr lines")
    print(f"  Saved to: {out_file}")

    # Categorize and save individual samples
    categorize_codex_live(lines)


def categorize_codex_live(lines):
    """Categorize live Codex JSON-RPC events and save samples."""
    samples = {}
    for line in lines:
        try:
            obj = json.loads(line)
        except:
            continue

        category = classify_codex_live_event(obj)
        if category and category not in samples:
            samples[category] = obj

    out_dir = OUTPUT_DIR / "codex_categorized"
    out_dir.mkdir(parents=True, exist_ok=True)

    for category, obj in sorted(samples.items()):
        safe_name = category.replace("/", "__").replace(".", "_")
        filepath = out_dir / f"{safe_name}.json"
        with open(filepath, "w") as f:
            json.dump(obj, f, indent=2, ensure_ascii=False)

    index = {
        "provider": "codex_live",
        "protocol": "JSON-RPC over stdio",
        "categories": sorted(samples.keys()),
        "total": len(samples),
    }
    with open(out_dir / "_index.json", "w") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)

    print(f"  Categorized into {len(samples)} event types")


def classify_codex_live_event(obj):
    """Classify a live Codex JSON-RPC event."""
    # Response (has "id")
    if "id" in obj and "method" not in obj:
        obj_id = obj.get("id", "")
        if "error" in obj:
            return f"response/error/{obj_id}"
        return f"response/{obj_id}"

    # Notification (has "method")
    method = obj.get("method", "")
    params = obj.get("params", {})

    if method == "item/started":
        item = params.get("item", {})
        item_type = item.get("type", "unknown")
        return f"item__started/{item_type}"

    elif method == "item/completed":
        item = params.get("item", {})
        item_type = item.get("type", "unknown")
        return f"item__completed/{item_type}"

    elif method == "item/agentMessage/delta":
        return "item__agentMessage__delta"

    elif method:
        return method.replace("/", "__")

    return None


# ============================================================
# Codex Batch Capture (exec --json)
# ============================================================

def capture_codex_batch():
    """
    Capture Codex exec --json output (batch/non-interactive mode).
    This produces the stored JSONL-like format in real-time.
    """
    codex_bin = find_binary("codex")
    if not codex_bin:
        print("  [SKIP] codex binary not found")
        return

    print(f"  Using: {codex_bin}")
    out_file = OUTPUT_DIR / "codex_stdio_batch.jsonl"

    # Use current repo as working directory (must be a git repo)
    repo_dir = Path(__file__).resolve().parents[2]  # rising-pelican root

    args = [
        codex_bin, "exec",
        "--sandbox", "danger-full-access",
        "-c", 'approval_policy="never"',
        "-C", str(repo_dir),
        "--json", "--color", "never",
        "--", "Run `echo hello_protocol_test` and `pwd`, then summarize results briefly."
    ]

    env = os.environ.copy()

    print(f"  Working dir: {repo_dir}")
    print("  Running codex exec --json (60s timeout)...")
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, env=env, timeout=60, cwd=str(repo_dir)
        )
        stdout_lines = [l for l in result.stdout.strip().split("\n") if l.strip()]
        stderr_lines = [l for l in result.stderr.strip().split("\n") if l.strip()]
    except subprocess.TimeoutExpired:
        print("  [TIMEOUT] codex exec timed out after 60s")
        return
    except Exception as e:
        print(f"  [ERROR] {e}")
        return

    with open(out_file, "w") as f:
        for line in stdout_lines:
            f.write(line + "\n")

    stderr_file = OUTPUT_DIR / "codex_batch_stderr.txt"
    with open(stderr_file, "w") as f:
        for line in stderr_lines:
            f.write(line + "\n")

    print(f"  Captured {len(stdout_lines)} stdout lines, {len(stderr_lines)} stderr lines")
    print(f"  Saved to: {out_file}")

    # Categorize
    samples = {}
    for line in stdout_lines:
        try:
            obj = json.loads(line)
        except:
            continue
        t = obj.get("type", "")
        if t == "response_item":
            p = obj.get("payload", {})
            pt = p.get("type", "")
            cat = f"response_item/{pt}"
        elif t == "item.completed":
            item = obj.get("item", {})
            it = item.get("type", "")
            cat = f"item.completed/{it}"
        else:
            cat = t
        if cat and cat not in samples:
            samples[cat] = obj

    out_dir = OUTPUT_DIR / "codex_batch_categorized"
    out_dir.mkdir(parents=True, exist_ok=True)
    for category, obj in sorted(samples.items()):
        safe_name = category.replace("/", "__").replace(".", "_")
        filepath = out_dir / f"{safe_name}.json"
        with open(filepath, "w") as f:
            json.dump(obj, f, indent=2, ensure_ascii=False)

    with open(out_dir / "_index.json", "w") as f:
        json.dump({"provider": "codex_batch", "categories": sorted(samples.keys()), "total": len(samples)}, f, indent=2, ensure_ascii=False)

    print(f"  Categorized into {len(samples)} event types")


# ============================================================
# Claude Live Capture
# ============================================================

def capture_claude():
    """
    Capture Claude CLI output.
    Claude uses simple JSONL streaming (not JSON-RPC).
    """
    claude_bin = find_binary("claude")
    if not claude_bin:
        print("  [SKIP] claude binary not found")
        return

    print(f"  Using: {claude_bin}")
    out_file = OUTPUT_DIR / "claude_stdio.jsonl"

    # Claude in non-interactive print mode with JSON output
    args = [
        claude_bin, "-p",  # print mode (non-interactive)
        "--output-format", "stream-json",
        "--verbose",
        "--max-turns", "2",
        "Run `echo hello_protocol_test` and tell me the result briefly."
    ]

    env = os.environ.copy()

    print("  Running claude -p --output-format stream-json (60s timeout)...")
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, env=env, timeout=60
        )
        stdout_lines = [l for l in result.stdout.strip().split("\n") if l.strip()]
        stderr_lines = [l for l in result.stderr.strip().split("\n") if l.strip()]
    except subprocess.TimeoutExpired:
        print("  [TIMEOUT] claude timed out after 60s")
        return
    except Exception as e:
        print(f"  [ERROR] {e}")
        return

    with open(out_file, "w") as f:
        for line in stdout_lines:
            f.write(line + "\n")

    stderr_file = OUTPUT_DIR / "claude_stdio_stderr.txt"
    with open(stderr_file, "w") as f:
        for line in stderr_lines:
            f.write(line + "\n")

    print(f"  Captured {len(stdout_lines)} stdout lines, {len(stderr_lines)} stderr lines")
    print(f"  Saved to: {out_file}")

    # Categorize
    samples = {}
    for line in stdout_lines:
        try:
            obj = json.loads(line)
        except:
            continue
        t = obj.get("type", "")
        if t == "assistant":
            msg = obj.get("message", {})
            content = msg.get("content", [])
            for c in content:
                if isinstance(c, dict):
                    ct = c.get("type", "")
                    cat = f"assistant/{ct}"
                    if cat not in samples:
                        samples[cat] = obj
        elif t == "user":
            msg = obj.get("message", {})
            content = msg.get("content", [])
            for c in content:
                if isinstance(c, dict):
                    ct = c.get("type", "")
                    cat = f"user/{ct}"
                    if cat not in samples:
                        samples[cat] = obj
        elif t == "system":
            cat = f"system/{obj.get('subtype','')}"
            if cat not in samples:
                samples[cat] = obj
        elif t:
            if t not in samples:
                samples[t] = obj

    out_dir = OUTPUT_DIR / "claude_categorized"
    out_dir.mkdir(parents=True, exist_ok=True)
    for category, obj in sorted(samples.items()):
        safe_name = category.replace("/", "__").replace(".", "_")
        filepath = out_dir / f"{safe_name}.json"
        with open(filepath, "w") as f:
            json.dump(obj, f, indent=2, ensure_ascii=False)

    with open(out_dir / "_index.json", "w") as f:
        json.dump({"provider": "claude_live", "categories": sorted(samples.keys()), "total": len(samples)}, f, indent=2, ensure_ascii=False)

    print(f"  Categorized into {len(samples)} event types")


# ============================================================
# Main
# ============================================================

def main():
    print("=" * 60)
    print("Live Protocol Capture Tool")
    print("=" * 60)

    mode = sys.argv[1] if len(sys.argv) > 1 else "all"

    if mode in ("all", "codex-interactive", "codex"):
        print("\n[1] Capturing Codex app-server (interactive JSON-RPC)...")
        capture_codex_interactive()

    if mode in ("all", "codex-batch", "codex"):
        print("\n[2] Capturing Codex exec --json (batch)...")
        capture_codex_batch()

    if mode in ("all", "claude"):
        print("\n[3] Capturing Claude stream-json...")
        capture_claude()

    print("\n" + "=" * 60)
    print("Done! Live samples saved to:", OUTPUT_DIR)


if __name__ == "__main__":
    main()
