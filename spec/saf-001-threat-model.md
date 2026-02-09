# SAF-001 Threat Model and Trust Boundaries

Date: 2026-02-09
Owner: Security Engineer
Scope: `server/` API/orchestration runtime, Blender RPC bridge, protocol executors, persisted run artifacts.

## Security Objectives
- Prevent untrusted input from triggering unsafe filesystem access (path traversal, symlink escape).
- Constrain Python execution in safe mode to block privileged/runtime escape primitives.
- Preserve integrity and traceability of security-relevant events.
- Keep trust boundaries explicit between external clients, server orchestration, and Blender process.

## Assets
- Host filesystem under repository root and configured output directories.
- Blender process and RPC bridge control channel.
- Run records, generated artifacts, and audit log.
- API credentials and server-managed key material.

## Threat Actors
- Unauthenticated network caller.
- Authenticated but malicious caller.
- Prompt-injected LLM output producing malicious protocol steps.
- Local attacker attempting symlink/path tricks in writable directories.

## Trust Boundaries
1. External Client -> HTTP API (`server/index.js`)
- Boundary type: network/input trust boundary.
- Controls: API key checks for protected writes, request schema/policy validation, command allow-list.

2. Orchestrator -> Protocol Plan / Step Payload
- Boundary type: model output trust boundary.
- Controls: strict protocol validation (`server/lib/protocolValidator.js`), step type and payload constraints, step-id constraints.

3. Orchestrator -> Filesystem Artifacts
- Boundary type: path/materialization trust boundary.
- Controls: step artifact directories constrained under run path, traversal-safe step-id policy, symlink segment blocking (`server/lib/protocolExecutor.js`).

4. Server -> Blender RPC Bridge
- Boundary type: process/RPC boundary.
- Controls: RPC token, command allow-list, safe/trusted exec mode policy, safe-mode blocked import/builtin checks.

5. Security Events -> Audit Log
- Boundary type: evidence/integrity boundary.
- Controls: append-only hash-chained audit records and integrity verification.

## Key Attack Scenarios and Mitigations
1. Protocol step ID traversal (`../` or absolute-like)
- Risk: artifact writes outside intended `runDir/protocol_steps`.
- Mitigation: step ID regex + traversal rejection in validator and executor path policy (`PROTOCOL_STEP_ID_INVALID`, `SAF_003_INVALID_STEP_ID`).

2. Symlink escape from protocol artifact directory
- Risk: pre-planted symlink redirects writes outside run tree.
- Mitigation: symlink segment detection and block before mkdir/write (`SAF_003_SYMLINK_BLOCKED`).

3. Safe-mode Python breakout via blocked imports/builtins
- Risk: filesystem/network/process access from untrusted code.
- Mitigation: AST-based import checks, restricted builtins, blocked `__import__`, RPC-level safe-mode enforcement/audit.

4. Unauthorized RPC command invocation
- Risk: arbitrary operations through Blender bridge endpoint.
- Mitigation: explicit command allow-list + auth + policy error paths and audit records.

## Residual Risk and Assumptions
- Trusted mode remains high-privilege by design and must stay operator-gated.
- If repository root or data directories are compromised at OS level, application-layer checks can be bypassed.
- Additional hardening opportunity: apply the same canonical path policy helper centrally across all file-writing subsystems.

## Verification Evidence
- `server/tests/protocol-executor-security.test.js` (traversal and symlink escape blocked).
- `server/tests/protocol-validator.test.js` (invalid step-id rejection).
- `server/tests/blender-rpc-bridge-policy.test.js` (safe/trusted mode policy, blocked import/builtin paths).
- `server/tests/blender-session-audit.test.js` (safe-mode blocked operation audit coverage).
