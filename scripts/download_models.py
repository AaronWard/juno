#!/usr/bin/env python3
"""Runtime downloader for the ACE-Step 1.5 XL model stack.

Downloads the four required Hugging Face repos into the host-mounted /models
directory. This script is executed by the container entrypoint on every boot
and can also be run manually (host or container).

Rules:
  * Never runs at Docker build time.
  * Skips repos whose target directory already exists and is non-empty.
  * Resumes partial downloads where huggingface_hub supports it.
  * Fails fast with a clear message on auth/rate-limit/corruption issues.
"""

from __future__ import annotations

import os
import sys

MODELS = [
    ("ACE-Step/acestep-v15-xl-sft", "acestep-v15-xl-sft"),
    ("ACE-Step/acestep-v15-xl-turbo", "acestep-v15-xl-turbo"),
    ("ACE-Step/acestep-v15-xl-base", "acestep-v15-xl-base"),
    ("ACE-Step/acestep-5Hz-lm-4B", "acestep-5Hz-lm-4B"),
]

MODEL_ROOT = os.environ.get("JUNO_MODEL_DIR", "/models")


def dir_nonempty(path: str) -> bool:
    if not os.path.isdir(path):
        return False
    for _root, _dirs, files in os.walk(path):
        for f in files:
            # ignore hidden bookkeeping files when deciding "non-empty"
            if not f.startswith("."):
                return True
    return False


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
        if dir_nonempty(target):
            print(f"[skip] {repo_id} — already present at {target}")
            continue

        print(f"[download] {repo_id} -> {target}")
        os.makedirs(target, exist_ok=True)
        try:
            snapshot_download(
                repo_id=repo_id,
                local_dir=target,
                token=token,
                resume_download=True,  # resume where possible
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

        if not dir_nonempty(target):
            print(
                f"[error] {repo_id} download finished but {target} is empty — "
                "the snapshot may be corrupted. Delete the folder and retry.",
                file=sys.stderr,
            )
            failures.append(repo_id)
        else:
            print(f"[ok] {repo_id} ready at {target}")

    if failures:
        print(f"\nFAILED to download: {', '.join(failures)}", file=sys.stderr)
        return 1

    print("\nAll ACE-Step models are present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
