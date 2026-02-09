# Cross-Platform Install Guide (PKG-003)

This guide targets clean installs on Windows and POSIX systems (Linux/macOS) with practical commands that work today.

## Prerequisites
- Blender 4.0+ available on `PATH` as `blender`
- Node.js 20+ with npm
- Python 3.10+
- Git (recommended)

## 1. Clone and enter repository

Windows PowerShell:
```powershell
git clone <repo-url> Aether-Blender-Swarm
cd Aether-Blender-Swarm
```

POSIX shell:
```bash
git clone <repo-url> Aether-Blender-Swarm
cd Aether-Blender-Swarm
```

## 2. Install server dependencies

Windows PowerShell:
```powershell
cd server
if (-not (Test-Path package-lock.json)) { npm install --package-lock-only }
npm ci
cd ..
```

POSIX shell:
```bash
cd server
test -f package-lock.json || npm install --package-lock-only
npm ci
cd ..
```

## 3. Install web dashboard dependencies

Windows PowerShell:
```powershell
cd web_interface
npm ci
cd ..
```

POSIX shell:
```bash
cd web_interface
npm ci
cd ..
```

## 4. Validate install

Windows PowerShell:
```powershell
cd server
npm test
cd ../web_interface
npm run build
cd ..
blender -b -P test_harness.py -- scaffold
```

POSIX shell:
```bash
cd server
npm test
cd ../web_interface
npm run build
cd ..
blender -b -P test_harness.py -- scaffold
```

## 5. Build deterministic release artifact

Windows PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1
```

POSIX shell:
```bash
chmod +x scripts/build-release.sh
./scripts/build-release.sh
```

Expected output artifacts:
- `release/aether-blender-swarm.zip`
- `release/SHA256SUMS.txt`
- `release/build-metadata.json`
- `release/provenance.json`
- `release/signing-status.json`
- optional signatures (`*.sig`, `*.pem`) when signing is configured
- logs in `release/logs/`

## 6. Verify release artifact and signatures

Windows PowerShell:
```powershell
py -3 scripts/verify_release.py
```

POSIX shell:
```bash
python3 scripts/verify_release.py
```

To require signature verification (fail if unsigned/unverifiable), set:
- `RELEASE_SIGNATURE_REQUIRED=1`
- `RELEASE_SIGNING_PUBKEY` to your cosign public key path

See `spec/release-signing-provenance.md` for signing-mode setup and manual cosign verification commands.

