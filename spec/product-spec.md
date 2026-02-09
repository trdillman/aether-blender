# GeoNode AI Assistant for Blender

## 1. Product Vision
GeoNode AI Assistant is an in-Blender chat assistant that converts natural language requests into safe, structured actions for:
- Geometry Nodes authoring/editing
- Scene automation via Python

The assistant returns a strict JSON protocol. Blender-side code validates and executes this protocol, then reports results back in chat.

## 2. Target Users
- Motion designers and procedural artists using Geometry Nodes
- Technical artists building reusable node systems
- General Blender users needing fast scene automation

## 3. Core Use Cases
1. Create a Geometry Nodes setup from a prompt.
2. Modify an existing node tree without destroying unrelated parts.
3. Build simulation/repeat-zone workflows.
4. Run Python scene actions (object creation, scene setup, utility tasks).
5. Generate mini-addon scaffolds for focused automation tasks.

## 4. MVP Scope
- Blender add-on panel with chat UI.
- Protocol executor for:
  - `NODE_TREE` actions
  - `GN_OPS` deterministic patch actions
  - `PYTHON` actions
- Multi-step plans: action list + `done` + `final_message`.
- Context packaging:
  - active object
  - active modifier
  - units
  - current node tree summary
- Provider configuration UI:
  - OpenAI, Anthropic, Gemini, OpenAI-compatible base URL.
- Preset save/load (local JSON file library).

## 5. Post-MVP Scope
- Streaming token updates.
- Shared preset exchange/import format.
- Local cache and retrieval helpers over docs/API snippets.
- Metrics dashboard (latency, success rate, token usage).

## 6. Non-Goals (MVP)
- Fully autonomous background agents making unconfirmed scene changes.
- Arbitrary unrestricted code execution by default.
- Cloud-hosted backend dependency requirement (must work local-first).

## 7. UX Requirements
- Single panel in `N` sidebar.
- Clear run states: `idle`, `planning`, `executing`, `done`, `error`.
- Preview protocol before apply (default ON for Python).
- Cancel current run.
- Execution log per step with success/failure and message.

## 8. Safety Requirements
- Strict JSON schema validation before execution.
- Completion gate: `done=true` is accepted only if required verification gates pass.
- Python sandbox policy modes:
  - `safe` (default): deny dangerous builtins/modules.
  - `trusted`: full execution with explicit user opt-in.
- Confirmation gate for destructive actions (delete/override).
- Timeouts on each step.

## 9. Success Criteria
1. A prompt can generate and apply a non-trivial Geometry Nodes graph end-to-end.
2. Existing node trees can be edited incrementally with no unrelated breakage.
3. Python action runs with visible logs and controlled permission mode.
4. Multi-step actions complete with deterministic `final_message`.
5. Presets can be saved and replayed on another object.
6. A manifest-driven E2E test can validate expected object/modifier/node-type outcomes for a prompt.
