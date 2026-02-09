#!/usr/bin/env python3
"""Verify release checksums and optional signatures."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_checksums(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        sha, rel = line.split("  ", 1)
        values[rel] = sha
    return values


def run_command(args: list[str]) -> tuple[int, str]:
    proc = subprocess.run(args, capture_output=True, text=True)
    output = "\n".join(part for part in [proc.stdout.strip(), proc.stderr.strip()] if part).strip()
    return proc.returncode, output


def require_signatures() -> bool:
    return os.environ.get("RELEASE_SIGNATURE_REQUIRED", "").strip().lower() in {"1", "true", "yes"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-dir", default="release", help="Path to release directory")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    release_dir = (repo_root / args.release_dir).resolve()

    metadata_path = release_dir / "build-metadata.json"
    checksums_path = release_dir / "SHA256SUMS.txt"
    status_path = release_dir / "signing-status.json"

    if not metadata_path.exists() or not checksums_path.exists():
        raise RuntimeError("Missing release metadata/checksum files")

    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    checksums = parse_checksums(checksums_path)

    artifact_name = str(metadata.get("artifact", ""))
    artifact_path = release_dir / artifact_name
    if not artifact_name or not artifact_path.exists():
        raise RuntimeError("Artifact missing from release directory")

    artifact_sha = sha256_file(artifact_path)
    metadata_sha = str(metadata.get("artifactSha256", ""))
    if metadata_sha != artifact_sha:
        raise RuntimeError("Artifact checksum mismatch against build-metadata.json")

    for rel_path, expected_sha in checksums.items():
        candidate = repo_root / rel_path
        if not candidate.exists():
            raise RuntimeError(f"Checksum file missing from workspace: {rel_path}")
        actual_sha = sha256_file(candidate)
        if actual_sha != expected_sha:
            raise RuntimeError(f"Checksum mismatch for {rel_path}")

    print(f"Checksum OK: {artifact_name} ({artifact_sha})")

    if not status_path.exists():
        if require_signatures():
            raise RuntimeError("signing-status.json missing while signatures are required")
        print("Signature verification skipped: signing-status.json missing")
        return 0

    status = json.loads(status_path.read_text(encoding="utf-8"))
    signing = status.get("signing", {})
    signed = bool(signing.get("signed"))

    if not signed:
        if require_signatures():
            raise RuntimeError(f"Signatures required but status is unsigned: {signing.get('reason', '')}")
        print(f"Signature verification skipped: {signing.get('reason', 'unsigned release')}")
        return 0

    cosign = shutil.which("cosign")
    pubkey = os.environ.get("RELEASE_SIGNING_PUBKEY", "").strip()
    if not cosign:
        if require_signatures():
            raise RuntimeError("cosign not found while signatures are required")
        print("Signature verification skipped: cosign not found in PATH")
        return 0
    if not pubkey:
        if require_signatures():
            raise RuntimeError("RELEASE_SIGNING_PUBKEY is required to verify signatures")
        print("Signature verification skipped: RELEASE_SIGNING_PUBKEY not set")
        return 0
    if not Path(pubkey).exists():
        if require_signatures():
            raise RuntimeError(f"RELEASE_SIGNING_PUBKEY not found: {pubkey}")
        print(f"Signature verification skipped: RELEASE_SIGNING_PUBKEY not found: {pubkey}")
        return 0

    artifact_sig = signing.get("artifactSignature")
    provenance_name = status.get("provenanceFile", "provenance.json")
    provenance_sig = signing.get("provenanceSignature")
    if not artifact_sig or not provenance_sig:
        raise RuntimeError("Signed status missing signature file references")

    artifact_sig_path = release_dir / str(artifact_sig)
    provenance_path = release_dir / str(provenance_name)
    provenance_sig_path = release_dir / str(provenance_sig)

    if not artifact_sig_path.exists() or not provenance_path.exists() or not provenance_sig_path.exists():
        raise RuntimeError("Signature verification files are missing")

    commands = [
        [
            "cosign",
            "verify-blob",
            "--key",
            pubkey,
            "--signature",
            str(artifact_sig_path),
            str(artifact_path),
        ],
        [
            "cosign",
            "verify-blob",
            "--key",
            pubkey,
            "--signature",
            str(provenance_sig_path),
            str(provenance_path),
        ],
    ]

    for cmd in commands:
        code, output = run_command(cmd)
        if code != 0:
            raise RuntimeError(f"Signature verification failed: {output}")

    print("Signature verification OK: artifact + provenance")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
