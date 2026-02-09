# Release Checklist (PKG-004)

Owner: Release Engineer  
Scope: Packaging and release readiness for current repository state.

## Pre-Release
- [ ] Confirm `spec/execution-backlog.md` status entries are current.
- [ ] Confirm `spec/execution-log.md` includes latest evidence commands and outcomes.
- [ ] Confirm no unintended local changes are included.
- [ ] Confirm Blender version target remains 4.0+.

## Build and Validation
- [ ] Run deterministic build script:
  - Windows: `powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1`
  - POSIX: `./scripts/build-release.sh`
- [ ] Verify `release/aether-blender-swarm.zip` exists.
- [ ] Verify `release/SHA256SUMS.txt` exists.
- [ ] Verify `release/build-metadata.json` exists and includes `artifactSha256`.
- [ ] Verify `release/provenance.json` exists.
- [ ] Verify `release/signing-status.json` exists and reflects expected signed/unsigned mode.
- [ ] Review `release/logs/server-test.log` for passing test summary.
- [ ] Review `release/logs/web-build.log` for successful build output.
- [ ] Review `release/logs/blender-harness.log` (pass or explicit skip reason).
- [ ] Run `py -3 scripts/verify_release.py` (or `python3 scripts/verify_release.py`) and record result.
- [ ] If signed release is required, set `RELEASE_SIGNATURE_REQUIRED=1` and `RELEASE_SIGNING_PUBKEY` before verification.

## Installability
- [ ] Follow `spec/cross-platform-install.md` on at least one clean Windows environment.
- [ ] Follow `spec/cross-platform-install.md` on at least one clean POSIX environment.
- [ ] Confirm fresh install can run validation commands without manual patching.

## Rollback Readiness
- [ ] Confirm previous known-good artifact is preserved and accessible.
- [ ] Confirm team has reviewed `spec/release-rollback-playbook.md`.
- [ ] Confirm rollback owner and communication channel are assigned.

## Sign-Off
- [ ] Release engineer sign-off captured in execution log.
- [ ] Link to produced artifact hash (`artifactSha256`) captured in execution log.

