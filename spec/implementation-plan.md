# GeoNode AI Assistant Implementation Plan

## Timeline
- Total estimate: **38 engineering days**
- Critical path: **31 days**
- Milestones:
1. Alpha (Day ~20)
2. Beta (Day ~31)
3. GA (Day ~38)

## Phases
1. Foundations and Contracts (3d)
- Deliverables: addon module skeleton, protocol schemas, config model.
- Acceptance: strict schema fixtures pass for valid/invalid payloads.

2. Provider Abstraction (4d)
- Deliverables: OpenAI/Anthropic/Gemini/OpenAI-compatible adapters.
- Acceptance: smoke tests per provider with retry/timeout/error mapping.

3. Context Collector and Budgeting (4d)
- Deliverables: deterministic context summaries and slice retrieval.
- Acceptance: bounded payload size with stable context hashes.

4. Run State Machine and Orchestrator (4d)
- Deliverables: phase transitions, step logs, cancel flow, retry path.
- Acceptance: ordered step execution and deterministic terminal states.

5. Executors MVP (5d)
- Deliverables: `NODE_TREE`, `GN_OPS`, `PYTHON` executors.
- Acceptance: end-to-end graph creation/edit + safe Python policy checks.

6. Safety and Verification Gates (3d)
- Deliverables: required gates + done-blocking enforcement.
- Acceptance: `done=true` rejected when gates fail; retry envelope generated.

7. Presets, Cache, Telemetry (3d)
- Deliverables: preset manager, local cache, run metrics.
- Acceptance: preset replay works on another object; metrics recorded.

8. E2E Harness and Regression Suite (5d)
- Deliverables: manifest-driven E2E runner with expected node assertions.
- Acceptance: core flow suite green in CI/headless execution.

9. Hardening and Release Prep (7d)
- Deliverables: reliability tuning, docs, packaging, release checklist.
- Acceptance: soak test target met, no critical blockers, release artifact signed.

## Release Gates
## Alpha
- Working chat+protocol pipeline
- MVP executors functional
- 10 canonical prompts without addon crash

## Beta
- Safety UX and gate enforcement complete
- Presets and telemetry integrated
- Incremental edit regression checks passing

## GA
- Full E2E manifest suite passing
- Soak stability target met
- Packaging/install/upgrade path validated
