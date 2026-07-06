#!/usr/bin/env python3
"""Verify that all ACE-Step model directories exist and are COMPLETE.

"Complete" means every weight shard referenced by the repo's
model.safetensors.index.json exists on disk (or, for un-sharded models, at
least one weight file exists). The previous "directory is non-empty" check
allowed a half-downloaded acestep-v15-xl-turbo (config files only, zero
*.safetensors shards) to pass verification and then crash the ACE-Step API
server with:

    FileNotFoundError: /models/acestep-v15-xl-turbo/model-00001-of-00004.safetensors
"""

from __future__ import annotations

import json
import os
import sys

MODEL_ROOT = os.environ.get("JUNO_MODEL_DIR", "/models")

EXPECTED = [
    "acestep-v15-xl-sft",
    "acestep-v15-xl-turbo",
    "acestep-v15-xl-base",
    "acestep-5Hz-lm-4B",
]

WEIGHT_EXTS = (".safetensors", ".bin", ".pt", ".gguf")


def model_state(path: str) -> tuple[bool, str]:
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

    single = os.path.join(path, "model.safetensors")
    if os.path.isfile(single):
        return True, "model.safetensors present"
    for _root, _dirs, files in os.walk(path):
        for fn in files:
            if fn.endswith(WEIGHT_EXTS) and not fn.startswith("."):
                return True, "weight files present"
    return False, "no weight files found"


def main() -> int:
    incomplete = []
    for name in EXPECTED:
        path = os.path.join(MODEL_ROOT, name)
        ok, detail = model_state(path)
        if ok:
            print(f"[ok]         {path} ({detail})")
        else:
            print(f"[INCOMPLETE] {path} — {detail}", file=sys.stderr)
            incomplete.append(path)

    if incomplete:
        print(
            "\nERROR: one or more model snapshots are missing or incomplete:\n  "
            + "\n  ".join(incomplete)
            + "\n\nRun the downloader (it resumes and repairs partial snapshots):\n"
            "  python3 /app/juno/scripts/download_models.py\n"
            "or from the host:\n"
            "  docker compose run --rm juno python3 /app/juno/scripts/download_models.py",
            file=sys.stderr,
        )
        return 1

    print("\nSUCCESS: all ACE-Step model snapshots are present and complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
