#!/usr/bin/env python3
"""Package BlockLogger_BP into a .mcpack (zip) under dist/."""

from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BP = ROOT / "packs" / "BlockLogger_BP"
DIST = ROOT / "dist"
OUT = DIST / "BlockLogger_BP.mcpack"


def main() -> None:
    if not BP.is_dir():
        raise SystemExit(f"Missing behavior pack at {BP}")

    DIST.mkdir(parents=True, exist_ok=True)
    if OUT.exists():
        OUT.unlink()

    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(BP.rglob("*")):
            if path.is_dir():
                continue
            if path.name.startswith("."):
                continue
            arc = path.relative_to(BP).as_posix()
            zf.write(path, arcname=arc)

    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")
    # Also keep a plain zip copy for convenience
    shutil.copyfile(OUT, DIST / "BlockLogger_BP.zip")


if __name__ == "__main__":
    main()
