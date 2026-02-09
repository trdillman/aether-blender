# Release Rollback Playbook (PKG-004)

Use this playbook when a release causes regressions, install failures, or runtime instability.

## Trigger Conditions
- Critical path failure (server API unavailable, protocol runs fail, Blender bridge fails)
- Data corruption risk in `data/` or `server/data/`
- Broken install path (fresh machine cannot pass validation commands)

## Required Inputs
- Last known-good artifact (`release/aether-blender-swarm.zip`)
- Failed artifact version and timestamp
- `release/logs/*.log` from the failed attempt

## Rollback Procedure
1. Freeze new rollout.
   - Stop sharing/installing the failed artifact immediately.
2. Preserve current evidence.
   - Copy `release/logs/` from failed attempt to a timestamped archive folder.
3. Restore last known-good artifact.
   - Replace deployed files with previous known-good release contents.
4. Reinstall dependencies deterministically.
   - Run `npm ci` in `server/` and `web_interface/`.
5. Re-run validation gates.
   - `cd server && npm test`
   - `cd web_interface && npm run build`
   - `blender -b -P test_harness.py -- scaffold`
6. Verify service health.
   - Confirm server starts and web build artifacts exist.
7. Communicate rollback result.
   - Record timestamp, owner, reason, and validation output in `spec/execution-log.md`.

## Data Safety Notes
- Do not delete `data/` or `server/data/` during rollback; back up first.
- If schema changes were introduced, restore both code and data snapshot from the same known-good release window.

## Post-Rollback Actions
1. Create a hotfix branch from known-good baseline.
2. Reproduce failed behavior with saved logs.
3. Add/extend tests that catch the failure before next release.
4. Run full `scripts/build-release.ps1` or `scripts/build-release.sh` before retrying rollout.
