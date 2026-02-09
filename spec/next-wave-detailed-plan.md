# GeoNode AI Assistant - Detailed Next Wave Plan

Date: 2026-02-08  
Wave: Safety + Verification Closure (post-protocol baseline)

## Wave Objectives
1. Complete safe/trusted Python execution policy enforcement.
2. Implement immutable audit logging with integrity verification.
3. Close high-priority protocol/gate test gaps.
4. Preserve current runtime behavior and keep all tests green.

## Backlog Scope
- SAF-004 (partial -> expanded)
- SAF-005 (new baseline implementation)
- TST-001 (expanded)
- TST-004 (expanded)
- TST-005 (expanded)

## Parallel Workstreams
1. `security-policy-worker`
- Files:
  - `server/blender_rpc_bridge.py`
  - `server/lib/securityPolicy.js`
  - `server/index.js`
  - `server/lib/settingsService.js`
  - `server/tests/security-policy.test.js`
  - `server/tests/blender-rpc-bridge-policy.test.js`
- Deliverables:
  - Safe/trusted mode handling for `exec_python`
  - Trusted mode blocked unless `allowTrustedPythonExecution=true`
  - Safe-mode denylist for dangerous imports/builtins
  - Deterministic policy errors with code/message

2. `audit-log-worker`
- Files:
  - `server/lib/auditLog.js` (new)
  - `server/lib/constants.js`
  - `server/lib/runOrchestrator.js`
  - `server/index.js`
  - `server/tests/audit-log.test.js` (new)
  - `server/tests/index-audit-events.test.js` (new)
- Deliverables:
  - Append-only JSONL log
  - Chained `prevHash`/`hash` integrity records
  - Integrity verifier
  - Security audit event emissions (`AUTH_FAILURE`, `RPC_COMMAND_BLOCKED`, `GATE_FAILURE`, terminal state)

3. `test-gap-worker`
- Files:
  - `server/tests/protocol-validator.test.js`
  - `server/tests/run-orchestrator-rpc.test.js`
- Deliverables:
  - More envelope/path/code assertions in protocol validator tests
  - Gate success/failure envelope coverage

## Dependency/Order
1. Merge security policy and audit log features first.
2. Expand test assertions after behavior settles.
3. Run full `server` tests and Python compile validation.

## Verification Plan
1. `cd server && npm test`
- Pass criteria: all tests pass, no regressions in existing suites.
2. `python -m py_compile server/blender_rpc_bridge.py`
- Pass criteria: no syntax/runtime compile errors.
3. `rg` evidence check for expected symbols and event types.
- Pass criteria: new policy/audit logic present and referenced by runtime/tests.

## Risks
- Policy false positives can block legitimate Python tasks.
- Audit chain serialization bugs can corrupt integrity checks.
- Gate-path test updates can become brittle with event payload shape drift.

## Mitigations
- Default safe mode with explicit trusted opt-in.
- Queue-based append writes for audit log serialization.
- Assertions on stable fields (`code`, `path`, gate keys), not full snapshots.

## Wave Exit Criteria
1. Security policy enabled with explicit trusted-mode gate.
2. Immutable audit logging baseline implemented and integrity verifiable.
3. Expanded TST-001/TST-004/TST-005 coverage merged.
4. Full `server` test suite green.

## Successor Wave: Executor Integration + Protocol Gate

Date: 2026-02-08  
Wave: Executor RPC Runtime

### Wave Objectives
1. Route NODE_TREE/GN_OPS/PYTHON steps through the Blender RPC bridge via safe-mode `exec_python`.
2. Ensure executor steps honor cancellation, gate semantics, and produce audit-worthy events.
3. Broaden TST-003/TST-005 to cover executor lifecycle, RPC skips, and policy enforcement feedback.
4. Keep observable artifacts + logs consistent for future provider/integration work.

### Backlog Scope
- EXE-004: PYTHON executor safe/trusted runtime (safe-mode enforcement + trusted opt-in).
- EXE-005: Cancellation/escalation coverage for RPC-backed executors.
- TST-003: Executor lifecycle tests adjusted for RPC bridging behavior.
- TST-005: Safe-mode security tests covering RPC denial/success events.

### Parallel Workstreams
1. **Executor bridge** - `server/lib/executorBridge.js`
   - Build RPC wrapper that defers to `blenderSessionManager.executeOnActive`.
   - Emit `protocol_rpc_skipped` when no session, log `protocol_rpc_result`/`protocol_rpc_error` events.
2. **Executor implementations** - `server/lib/executors/*`
   - Call the bridge before/after writing artifacts.
   - Capture RPC event types for Node/GN/Python steps.
3. **Regression coverage** - `server/tests/*`
   - Assert executor logs include RPC skip events.
   - Add new tests for `protocol_rpc_*` log entries if necessary.
4. **Traceability/logs** - `spec/execution-log.md`
   - Flag active EXE-004..EXE-005 work and record decision log.

### Verification Plan
1. `cd server && npm test` (must pass all suites).
2. `python -m py_compile server/blender_rpc_bridge.py`.
3. Inspect logs to confirm `protocol_rpc_skipped` events when sessions are unavailable.

### Risks
- No active Blender session => RPC bridge calls skipped (expected, but ensure skip events exist).
- RPC errors should surface as `protocol_rpc_error` with stepId for debugging.

### Mitigations
- Gracefully skip RPC when `getActiveSession()` is null and document the skip event.
- Allow Python steps to throw if RPC calls legitimately fail (ensuring orchestrator fails fast).
