# Release Signing and Provenance (PKG-002)

This pipeline adds provenance generation and optional cryptographic signing to the deterministic release build.

## Build Integration
- `scripts/build-release.ps1` and `scripts/build-release.sh` now execute:
  - `scripts/package_release.py`
  - `scripts/sign_release.py`

`sign_release.py` always writes:
- `release/provenance.json`
- `release/signing-status.json`

It writes signatures when signing is configured and available:
- `release/aether-blender-swarm.zip.sig`
- `release/aether-blender-swarm.zip.pem`
- `release/provenance.json.sig`
- `release/provenance.json.pem`

## Signing Modes

### 1) Key-based signing (recommended for CI)
Set:
- `RELEASE_SIGNING_KEY` to a cosign private key file path.

Example (PowerShell):
```powershell
$env:RELEASE_SIGNING_KEY = "C:\keys\cosign.key"
powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1
```

Example (POSIX):
```bash
export RELEASE_SIGNING_KEY=/secure/cosign.key
./scripts/build-release.sh
```

### 2) Keyless signing (optional)
Set:
- `COSIGN_ENABLE_KEYLESS=1`

This requires a functional cosign keyless/OIDC flow in the current environment.

### 3) Safe fallback (default)
If `cosign` is missing or no signing key/mode is configured, build continues and records an unsigned status in `release/signing-status.json`.

To force hard failure when signing cannot be completed, set:
- `RELEASE_SIGNING_REQUIRED=1`

## Verification Commands

### Standard verification (checksum + optional signatures)
```powershell
py -3 scripts/verify_release.py
```

```bash
python3 scripts/verify_release.py
```

Behavior:
- Always verifies artifact SHA-256 against both `release/SHA256SUMS.txt` and `release/build-metadata.json`.
- Verifies signatures only when release is signed and verification prerequisites exist.

To require signature verification (fail if unsigned/unverifiable):
- `RELEASE_SIGNATURE_REQUIRED=1`
- `RELEASE_SIGNING_PUBKEY=<path-to-cosign.pub>`

### Manual cosign verification (signed releases)
```bash
cosign verify-blob \
  --key /path/to/cosign.pub \
  --signature release/aether-blender-swarm.zip.sig \
  release/aether-blender-swarm.zip

cosign verify-blob \
  --key /path/to/cosign.pub \
  --signature release/provenance.json.sig \
  release/provenance.json
```
