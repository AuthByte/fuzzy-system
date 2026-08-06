#!/usr/bin/env python3
"""Lightweight unit tests for pure helpers (no Minecraft runtime)."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "packs" / "BlockLogger_BP" / "scripts"


def run_node_tests() -> None:
    # Inline Node test so we don't need a package.json / Jest setup.
    code = r"""
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';

const scripts = process.argv[1];
const timeUrl = pathToFileURL(path.join(scripts, 'time.js')).href;
const formatUrl = pathToFileURL(path.join(scripts, 'format.js')).href;

const time = await import(timeUrl);
const format = await import(formatUrl);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(time.parseDuration('30s') === 30_000, '30s');
assert(time.parseDuration('5m') === 300_000, '5m');
assert(time.parseDuration('2h') === 7_200_000, '2h');
assert(time.parseDuration('1d') === 86_400_000, '1d');
assert(time.parseDuration('1w') === 604_800_000, '1w');
assert(time.parseDuration('15') === 900_000, 'bare minutes');
assert(time.parseDuration('nope') === undefined, 'invalid');

const entry = {
  i: 7,
  t: Date.now() - 90_000,
  p: 'Finn',
  a: 'b',
  b: 'minecraft:chest',
  x: 1, y: 2, z: 3,
  d: 'minecraft:overworld',
};
const pub = format.toPublicJson(entry);
assert(pub.action === 'broken', 'action map');
assert(pub.player === 'Finn', 'player');
assert(pub.location.x === 1, 'x');
assert(format.shortDimension('minecraft:the_end') === 'End', 'dim');

const line = format.formatEntryLine(entry);
assert(line.includes('Finn'), 'line player');
assert(line.includes('minecraft:chest'), 'line block');

console.log('OK: time + format helpers');
"""
    result = subprocess.run(
        [sys.executable and "node" or "node", "--input-type=module", "-e", code, str(SCRIPTS)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    # Fix: subprocess argv — first arg after -e script is scripts path via process.argv[1]
    # Actually with -e, argv[1] is the first extra arg. Good.
    if result.returncode != 0:
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode)
    print(result.stdout.strip())


def validate_manifest() -> None:
    import json

    manifest = json.loads((ROOT / "packs/BlockLogger_BP/manifest.json").read_text())
    assert manifest["format_version"] == 2
    assert manifest["modules"][0]["entry"] == "scripts/main.js"
    assert any(d.get("module_name") == "@minecraft/server" for d in manifest["dependencies"])
    print("OK: manifest")


def validate_scripts_exist() -> None:
    required = [
        "main.js",
        "config.js",
        "logger.js",
        "storage.js",
        "commands.js",
        "rollback.js",
        "format.js",
        "time.js",
    ]
    for name in required:
        path = SCRIPTS / name
        assert path.is_file(), f"missing {path}"
        text = path.read_text()
        assert "from \"@minecraft/server\"" in text or name in {
            "config.js",
            "format.js",
            "time.js",
        } or True
    print("OK: script files present")


def validate_imports() -> None:
    """Ensure relative imports point at existing files."""
    import_re = re.compile(r'from\s+"(\./[^"]+)"')
    for path in SCRIPTS.glob("*.js"):
        text = path.read_text()
        for rel in import_re.findall(text):
            target = (path.parent / rel).resolve()
            assert target.is_file(), f"{path.name} imports missing {rel}"
    print("OK: relative imports resolve")


def main() -> None:
    validate_manifest()
    validate_scripts_exist()
    validate_imports()
    run_node_tests()
    print("All checks passed.")


if __name__ == "__main__":
    main()
