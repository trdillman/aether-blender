#!/usr/bin/env python3
"""Generate release provenance and optional signatures with safe fallbacks."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import uuid


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso_utc(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run_command(args: list[str]) -> tuple[int, str]:
    proc = subprocess.run(args, capture_output=True, text=True)
    output = "\n".join(part for part in [proc.stdout.strip(), proc.stderr.strip()] if part).strip()
    return proc.returncode, output


def get_git_commit(repo_root: Path) -> str:
    code, output = run_command(["git", "-C", str(repo_root), "rev-parse", "HEAD"])
    if code == 0:
        return output.strip()
    return ""


def build_provenance_statement(
    artifact_name: str,
    artifact_sha256: str,
    metadata: dict[str, object],
    repo_root: Path,
    started_at: dt.datetime,
    finished_at: dt.datetime,
) -> dict[str, object]:
    return {
        "_type": "https://in-toto.io/Statement/v1",
        "subject": [{"name": artifact_name, "digest": {"sha256": artifact_sha256}}],
        "predicateType": "https://slsa.dev/provenance/v1",
        "predicate": {
            "buildDefinition": {
                "buildType": "https://aether-blender-swarm.dev/release/build-release/v1",
                "externalParameters": {
                    "releaseScript": "scripts/build-release.ps1|scripts/build-release.sh",
                    "platform": platform.platform(),
                },
                "internalParameters": {
                    "python": sys.version.split()[0],
                    "sourceFileCount": metadata.get("sourceFileCount"),
                },
                "resolvedDependencies": [
                    {
                        "uri": f"git+file://{repo_root.as_posix()}",
                        "digest": {"sha1": get_git_commit(repo_root)},
                    }
                ],
            },
            "runDetails": {
                "builder": {"id": "aether-blender-swarm/release-pipeline"},
                "metadata": {
                    "invocationId": str(uuid.uuid4()),
                    "startedOn": iso_utc(started_at),
                    "finishedOn": iso_utc(finished_at),
                },
            },
        },
    }


def sign_blob_with_cosign(blob: Path, sig_path: Path, cert_path: Path, key_path: str | None) -> tuple[bool, str]:
    cmd = [
        "cosign",
        "sign-blob",
        "--yes",
        "--output-signature",
        str(sig_path),
        "--output-certificate",
        str(cert_path),
    ]
    if key_path:
        cmd.extend(["--key", key_path])
    cmd.append(str(blob))

    code, output = run_command(cmd)
    if code != 0:
        return False, output
    return True, output


def should_require_signing() -> bool:
    return os.environ.get("RELEASE_SIGNING_REQUIRED", "").strip().lower() in {"1", "true", "yes"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-dir", default="release", help="Path to release directory")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    release_dir = (repo_root / args.release_dir).resolve()
    metadata_path = release_dir / "build-metadata.json"
    status_path = release_dir / "signing-status.json"

    if not metadata_path.exists():
        raise RuntimeError(f"Missing metadata file: {metadata_path}")

    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    artifact_name = str(metadata.get("artifact", ""))
    if not artifact_name:
        raise RuntimeError("build-metadata.json missing 'artifact' field")

    artifact_path = release_dir / artifact_name
    if not artifact_path.exists():
        raise RuntimeError(f"Missing artifact file: {artifact_path}")

    started_at = utc_now()
    artifact_sha = sha256_file(artifact_path)

    provenance_path = release_dir / "provenance.json"
    provenance = build_provenance_statement(
        artifact_name=artifact_name,
        artifact_sha256=artifact_sha,
        metadata=metadata,
        repo_root=repo_root,
        started_at=started_at,
        finished_at=utc_now(),
    )
    provenance_path.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")

    signing = {
        "attempted": False,
        "signed": False,
        "mode": "none",
        "reason": "signing not attempted",
        "artifactSignature": None,
        "artifactCertificate": None,
        "provenanceSignature": None,
        "provenanceCertificate": None,
        "cosignVersion": "",
    }

    cosign_path = shutil.which("cosign")
    key_path = os.environ.get("RELEASE_SIGNING_KEY", "").strip()
    enable_keyless = os.environ.get("COSIGN_ENABLE_KEYLESS", "").strip().lower() in {"1", "true", "yes"}

    if not cosign_path:
        signing["reason"] = "cosign not found in PATH"
    elif key_path and not Path(key_path).exists():
        signing["reason"] = f"RELEASE_SIGNING_KEY not found: {key_path}"
    elif not key_path and not enable_keyless:
        signing["reason"] = "no signing key configured (set RELEASE_SIGNING_KEY)"
    else:
        signing["attempted"] = True
        signing["mode"] = "key" if key_path else "keyless"

        _, cosign_version = run_command(["cosign", "version"])
        signing["cosignVersion"] = cosign_version.splitlines()[0] if cosign_version else ""

        artifact_sig = release_dir / f"{artifact_name}.sig"
        artifact_cert = release_dir / f"{artifact_name}.pem"
        prov_sig = release_dir / "provenance.json.sig"
        prov_cert = release_dir / "provenance.json.pem"

        artifact_ok, artifact_output = sign_blob_with_cosign(
            blob=artifact_path,
            sig_path=artifact_sig,
            cert_path=artifact_cert,
            key_path=key_path or None,
        )

        if artifact_ok:
            provenance_ok, provenance_output = sign_blob_with_cosign(
                blob=provenance_path,
                sig_path=prov_sig,
                cert_path=prov_cert,
                key_path=key_path or None,
            )
        else:
            provenance_ok = False
            provenance_output = ""

        if artifact_ok and provenance_ok:
            signing["signed"] = True
            signing["reason"] = "artifact and provenance signed"
            signing["artifactSignature"] = artifact_sig.name
            signing["artifactCertificate"] = artifact_cert.name
            signing["provenanceSignature"] = prov_sig.name
            signing["provenanceCertificate"] = prov_cert.name
        else:
            signing["reason"] = (
                "cosign signing failed"
                + (f": {artifact_output}" if artifact_output else "")
                + (f" | {provenance_output}" if provenance_output else "")
            )

    if should_require_signing() and not signing["signed"]:
        raise RuntimeError(f"Release signing required but unavailable: {signing['reason']}")

    finished_at = utc_now()
    status_payload = {
        "artifact": artifact_name,
        "artifactSha256": artifact_sha,
        "provenanceFile": provenance_path.name,
        "timestampUtc": iso_utc(finished_at),
        "signing": signing,
    }
    status_path.write_text(json.dumps(status_payload, indent=2) + "\n", encoding="utf-8")

    metadata["provenanceFile"] = provenance_path.name
    metadata["signingStatusFile"] = status_path.name
    metadata["signed"] = bool(signing["signed"])
    metadata["signingMode"] = signing["mode"]
    metadata["artifactSignature"] = signing["artifactSignature"]
    metadata["provenanceSignature"] = signing["provenanceSignature"]
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {provenance_path}")
    print(f"Wrote {status_path}")
    print(f"Signing status: {'signed' if signing['signed'] else 'unsigned'} ({signing['reason']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
