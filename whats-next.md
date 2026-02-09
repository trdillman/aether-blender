<original_task>
Complete the GeoNode AI Assistant roadmap up through GA: protocol/executor safety, provider adapters, telemetry, presets, UI, testing, and packaging.
</original_task>

<work_completed>
Implemented full backend protocol/executor layers with JSON schemas, error taxonomy, handshake, provider adapters, telemetry, preset store, audit controls, manifest-based testing, and authentication. Frontend chat UI, presets, settings, and accessibility were refreshed; Vitest/Playwright cover UI components and regression scenarios. Release tooling now produces deterministic artifacts, metrics, and provenance/signing docs; live-provider evidence captured.
</work_completed>

<work_remaining>
Original roadmap is complete; no remaining work scoped to that task.
</work_remaining>

<context>
Release signing currently runs unsigned unless `cosign` is installed (scripts record that fallback). Preset creation now requires schemaVersion/metadata on both client and server; API keyed writes must send `x-aether-api-key` (TopBar updates the cached key). Build artifacts are regenerated after each change (`web_interface/dist` removed). All server tests (109), frontend tests (7), Playwright E2E (2), build commands, and release verification have passed against the latest code.
</context>
