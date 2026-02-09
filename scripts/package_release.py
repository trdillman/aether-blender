#!/usr/bin/env python3
"""Create deterministic release archives and checksums."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import zipfile


FIXED_ZIP_TIME = (2026, 1, 1, 0, 0, 0)
ROOT_PREFIX = "aether-blender-swarm"


def should_skip(path: Path, repo_root: Path) -> bool:
    rel = path.relative_to(repo_root).as_posix()
    skip_dirs = {
        ".git",
        ".grepai",
        ".serena",
        "__pycache__",
        "generated_addons",
        "archive",
        "monitor",
        "release",
    }
    parts = set(path.parts)
    if parts.intersection(skip_dirs):
        return True
    if rel.startswith("web_interface/node_modules/"):
        return True
    if rel.startswith("web_interface/dist/assets/") and rel.endswith(".map"):
        return True
    if rel.endswith(".pyc"):
        return True
    return False


def iter_release_files(repo_root: Path) -> list[Path]:
    include_paths = [
        "AGENTS.md",
        "README.md",
        "mcp.json",
        "test_harness.py",
        "scaffold",
        "server",
        "spec",
        "skills",
        "scripts/build-release.ps1",
        "scripts/build-release.sh",
        "scripts/package_release.py",
        "scripts/sign_release.py",
        "scripts/verify_release.py",
        "web_interface/index.html",
        "web_interface/package.json",
        "web_interface/package-lock.json",
        "web_interface/postcss.config.cjs",
        "web_interface/tailwind.config.cjs",
        "web_interface/vite.config.js",
        "web_interface/src",
        "web_interface/dist",
    ]

    files: list[Path] = []
    for rel in include_paths:
        src = repo_root / rel
        if not src.exists():
            continue
        if src.is_file():
            if not should_skip(src, repo_root):
                files.append(src)
            continue
        for candidate in src.rglob("*"):
            if candidate.is_file() and not should_skip(candidate, repo_root):
                files.append(candidate)

    unique_sorted = sorted(set(files), key=lambda p: p.relative_to(repo_root).as_posix())
    return unique_sorted


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_checksums(repo_root: Path, out_file: Path, files: list[Path]) -> None:
    lines = []
    for file_path in files:
        rel = file_path.relative_to(repo_root).as_posix()
        lines.append(f"{file_sha256(file_path)}  {rel}")
    out_file.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_zip(repo_root: Path, out_zip: Path, files: list[Path]) -> None:
    with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for file_path in files:
            rel = PurePosixPath(file_path.relative_to(repo_root).as_posix())
            arc_name = str(PurePosixPath(ROOT_PREFIX) / rel)
            info = zipfile.ZipInfo(filename=arc_name, date_time=FIXED_ZIP_TIME)
            mode = stat.S_IMODE(file_path.stat().st_mode)
            info.external_attr = (mode & 0xFFFF) << 16
            data = file_path.read_bytes()
            zf.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    release_dir = repo_root / "release"
    release_dir.mkdir(parents=True, exist_ok=True)

    files = iter_release_files(repo_root)
    if not files:
        raise RuntimeError("No files selected for release archive")

    artifact_name = f"{ROOT_PREFIX}.zip"
    artifact_path = release_dir / artifact_name
    checksums_path = release_dir / "SHA256SUMS.txt"
    metadata_path = release_dir / "build-metadata.json"

    if artifact_path.exists():
        artifact_path.unlink()

    write_checksums(repo_root, checksums_path, files)
    build_zip(repo_root, artifact_path, files)

    metadata = {
        "artifact": artifact_name,
        "artifactSha256": file_sha256(artifact_path),
        "sourceFileCount": len(files),
        "checksumsFile": checksums_path.name,
        "python": os.environ.get("PYTHON_VERSION", ""),
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    print(f"Created {artifact_path}")
    print(f"Wrote {checksums_path}")
    print(f"Wrote {metadata_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

