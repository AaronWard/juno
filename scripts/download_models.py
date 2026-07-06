#!/usr/bin/env python3
"""Runtime downloader for the ACE-Step 1.5 XL model stack.

Downloads the four required Hugging Face repos into the host-mounted /models
directory. This script is executed by the container entrypoint on every boot
and can also be run manually (host or container).

Rules:
  * Never runs at Docker build time.
  * A repo is only skipped when its snapshot is COMPLETE: every shard listed
    in model.safetensors.index.json must exist on disk. (The old "directory
    is non-empty" check let a half-downloaded acestep-v15-xl-turbo — config
    files present, all four *.safetensors shards missing — pass silently and
    then crash the API server at load time.)
  * Resumes partial downloads where huggingface_hub supports it.
  * Fails fast with a clear message on auth/rate-limit/corruption issues.
"""

from __future__ import annotations

import json
import os
import sys

MODELS = [
    ("ACE-Step/acestep-v15-xl-sft", "acestep-v15-xl-sft"),
    ("ACE-Step/acestep-v15-xl-turbo", "acestep-v15-xl-turbo"),
    ("ACE-Step/acestep-v15-xl-base", "acestep-v15-xl-base"),
    ("ACE-Step/acestep-5Hz-lm-4B", "acestep-5Hz-lm-4B"),
]

MODEL_ROOT = os.environ.get("JUNO_MODEL_DIR", "/models")

WEIGHT_EXTS = (".safetensors", ".bin", ".pt", ".gguf")


def model_state(path: str) -> tuple[bool, str]:
    """Return (complete, detail).

    Complete means: the directory exists AND every weight shard referenced
    by model.safetensors.index.json is present (or, when there is no index,
    at least one weight file exists).
    """
    if not os.path.isdir(path):
        return False, "directory missing"

    idx_path = os.path.join(path, "model.safetensors.index.json")
    if os.path.isfile(idx_path):
        try:
            with open(idx_path, "r", encoding="utf-8") as f:
                idx = json.load(f)
            shards = sorted(set(idx.get("weight_map", {}).values()))
        except Exception as exc:  # noqa: BLE001
            return False, f"unreadable index: {exc}"
        if not shards:
            return False, "index has no weight_map"
        missing = [s for s in shards if not os.path.isfile(os.path.join(path, s))]
        if missing:
            head = ", ".join(missing[:3])
            more = f" (+{len(missing) - 3} more)" if len(missing) > 3 else ""
            return False, f"missing weight shards: {head}{more}"
        return True, f"{len(shards)} shard(s) present"

    # No sharded index: single-file checkpoints.
    single = os.path.join(path, "model.safetensors")
    if os.path.isfile(single):
        return True, "model.safetensors present"
    for _root, _dirs, files in os.walk(path):
        for fn in files:
            if fn.endswith(WEIGHT_EXTS) and not fn.startswith("."):
                return True, "weight files present"
    return False, "no weight files found"


def main() -> int:
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("ERROR: huggingface_hub is not installed.", file=sys.stderr)
        print("       pip install huggingface_hub", file=sys.stderr)
        return 1

    token = os.environ.get("HF_TOKEN") or None
    failures = []

    for repo_id, local_name in MODELS:
        target = os.path.join(MODEL_ROOT, local_name)
        complete, detail = model_state(target)
        if complete:
            print(f"[skip] {repo_id} — complete at {target} ({detail})")
            continue

        if os.path.isdir(target):
            print(f"[repair] {repo_id} — incomplete snapshot ({detail}); resuming download")
        else:
            print(f"[download] {repo_id} -> {target}")
        os.makedirs(target, exist_ok=True)
        try:
            snapshot_download(
                repo_id=repo_id,
                local_dir=target,
                token=token,
                max_workers=8,
            )
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            print(f"[error] failed to download {repo_id}: {msg}", file=sys.stderr)
            if "401" in msg or "403" in msg or "auth" in msg.lower() or "gated" in msg.lower():
                print(
                    "        This looks like an authentication or access problem.\n"
                    "        Set a Hugging Face token and retry:\n"
                    "          export HF_TOKEN=your_token_here\n"
                    "        (or put HF_TOKEN=... into your .env file)",
                    file=sys.stderr,
                )
            if "429" in msg or "rate" in msg.lower():
                print(
                    "        This looks like a rate limit. Setting HF_TOKEN raises\n"
                    "        the anonymous rate limits: export HF_TOKEN=your_token_here",
                    file=sys.stderr,
                )
            failures.append(repo_id)
            continue

        complete, detail = model_state(target)
        if not complete:
            print(
                f"[error] {repo_id} download finished but the snapshot is still "
                f"incomplete ({detail}). Delete {target} and retry.",
                file=sys.stderr,
            )
            failures.append(repo_id)
        else:
            print(f"[ok] {repo_id} ready at {target} ({detail})")

    if failures:
        print(f"\nFAILED to download: {', '.join(failures)}", file=sys.stderr)
        return 1

    print("\nAll ACE-Step models are present and complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
