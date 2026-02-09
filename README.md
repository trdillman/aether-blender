# Aether-Blender-Swarm (GLM 4.7 Edition)

A high-performance, autonomous Blender add-on generation system designed for Claude CLI and GLM 4.7.

## Prerequisites
1. **Blender 4.0+** installed and added to your system PATH (executable as `blender`).
2. **Node.js** & **NPM** (for the web dashboard and MCP servers).
3. **Claude CLI** (`npm install -g @anthropic-ai/claude-code`).

## Quick Start

1. **Configure LLM connection for the dashboard:**
   ```bash
   cd web_interface
   cp .env.example .env
   ```
   Then edit `web_interface/.env`:
   - set `VITE_LLM_PROVIDER` (`glm47`, `zhipu`, `openai`, `gemini`, `openrouter`, or `custom`)
   - set `VITE_LLM_API_KEY`
   - for `custom`, set `VITE_LLM_BASE_URL` and `VITE_LLM_CHAT_PATH`

   Ready-made presets are included:
   ```bash
   cp .env.glm47.example .env   # GLM 4.7 via Zhipu
   cp .env.openai.example .env  # OpenAI
   cp .env.gemini.example .env  # Gemini (OpenAI-compatible endpoint)
   ```

2. **Start the Dashboard:**
   ```bash
   cd web_interface
   npm install
   npm run dev
   ```

3. **Launch the Swarm (in a new terminal):**
   ```bash
   claude --mcp mcp.json
   ```

4. **In Claude CLI, enter:**
   "Adopt the persona defined in `research_plan.md` and use the skills in `skills/` to generate a Blender add-on that [YOUR IDEA HERE]. Use `test_harness.py` to verify it."


## Testing

- Frontend coverage is tracked through Vitest/V8; run `npm run test -- --coverage` inside `web_interface` and review the report under `web_interface/test-results/vitest-coverage`.
- `server/tests/blenderRpcClient.test.js` now validates `server/lib/blenderRpcClient.js` and can be executed directly with `node server/tests/blenderRpcClient.test.js`.
- The existing Python harness (`test_harness.py`) is intentionally light; consider migrating those scripts to `pytest` if future fixtures or parametrized scenarios make the current framework unwieldy.

## Manifest E2E Runner (TST-011)

Run the manifest-driven protocol/execution E2E runner from the server package:

```bash
cd server
npm run test:manifest-e2e
```

Default manifest:

- `server/e2e/manifests/tst-011-node-tree-cube.json`

Direct CLI usage:

```bash
node server/scripts/run-manifest-e2e.js --manifest server/e2e/manifests/tst-011-node-tree-cube.json
```

## Reliability Runners (TST-012 .. TST-014)

Run the stress/chaos runners from the server package:

```bash
cd server
npm run test:manifest-soak
npm run test:manifest-load
npm run test:manifest-chaos
```

Default manifests:

- `server/e2e/manifests/tst-012-soak-50-prompts.json`
- `server/e2e/manifests/tst-013-load-concurrent.json`
- `server/e2e/manifests/tst-014-chaos-provider-network.json`

Direct CLI examples:

```bash
cd server
node scripts/run-manifest-soak.js --manifest e2e/manifests/tst-012-soak-50-prompts.json --iterations 50 --base-url http://127.0.0.1:8787
node scripts/run-manifest-load.js --manifest e2e/manifests/tst-013-load-concurrent.json --total-runs 40 --concurrency 8 --base-url http://127.0.0.1:8787
node scripts/run-manifest-chaos.js --manifest e2e/manifests/tst-014-chaos-provider-network.json --base-url http://127.0.0.1:8787
```

`--base-url` is optional; when provided, runners snapshot `GET /api/health`, `GET /api/metrics`, and `GET /api/runs` at checkpoints.

## Packaging and Release

- Windows reproducible build: `powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1`
- POSIX reproducible build: `./scripts/build-release.sh`
- Install guide: `spec/cross-platform-install.md`
- Rollback playbook: `spec/release-rollback-playbook.md`
- Release checklist: `spec/release-checklist.md`
