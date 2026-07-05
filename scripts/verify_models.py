#!/usr/bin/env python3
"""Verify that all ACE-Step model directories exist and are non-empty."""

from __future__ import annotations

import os
import sys

MODEL_ROOT = os.environ.get("JUNO_MODEL_DIR", "/models")

EXPECTED = [
    "acestep-v15-xl-sft",
    "acestep-v15-xl-turbo",
    "acestep-v15-xl-base",
    "acestep-5Hz-lm-4B",
]


def dir_nonempty(path: str) -> bool:
    if not os.path.isdir(path):
        return False
    for _root, _dirs, files in os.walk(path):
        for f in files:
            if not f.startswith("."):
                return True
    return False


def main() -> int:
    missing = []
    for name in EXPECTED:
        path = os.path.join(MODEL_ROOT, name)
        if dir_nonempty(path):
            print(f"[ok]      {path}")
        else:
            print(f"[MISSING] {path} — directory absent or empty", file=sys.stderr)
            missing.append(path)

    if missing:
        print(
            "\nERROR: one or more model directories are missing or empty:\n  "
            + "\n  ".join(missing)
            + "\n\nRun the downloader:\n"
            "  python3 /app/juno/scripts/download_models.py\n"
            "or from the host:\n"
            "  docker compose run --rm juno python /app/juno/scripts/download_models.py",
            file=sys.stderr,
        )
        return 1

    print("\nSUCCESS: all ACE-Step model directories are present and non-empty.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
