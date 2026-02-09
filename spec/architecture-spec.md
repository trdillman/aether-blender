# GeoNode AI Assistant - Architecture Spec

## 1. High-Level Architecture
1. Blender Add-on UI Layer
- Chat panel, settings panel, run history, execution logs.

2. Orchestration Layer (inside addon)
- Builds context snapshot.
- Sends prompt + context to selected provider.
- Parses and validates protocol JSON.
- Executes steps sequentially.

3. Execution Layer
- `NodeTreeExecutor`: create/edit Geometry Nodes safely.
- `GNOpsExecutor`: deterministic patch operations on target node trees.
- `PythonExecutor`: run policy-gated script actions.

4. Storage Layer
- Local presets store.
- Local cache for prompts/responses.
- Optional local docs index for retrieval helpers.

## 2. Blender Add-on Modules
- `ui_panel.py`: chat/settings/log UI
- `provider_client.py`: multi-provider API abstraction
- `protocol_schema.py`: protocol model + validation
- `orchestrator.py`: run loop and step state management
- `executors/node_tree_executor.py`
- `executors/gn_ops_executor.py`
- `executors/python_executor.py`
- `context_collector.py`
- `presets_store.py`
- `cache_store.py`
- `telemetry.py`

## 3. Provider Abstraction
`ProviderClient` interface:
- `send(messages, system, model, options) -> response`
- `stream(...) -> event iterator` (optional)

Provider adapters:
- OpenAI
- Anthropic
- Gemini
- OpenAI-compatible custom endpoint

## 4. Context Model (Input to LLM)
- Blender version
- Scene units and frame range
- Active object summary
- Active modifiers summary
- Active node group summary (nodes, links, exposed sockets)
- User intent text

Context must be compact, deterministic, and bounded by token budget.

## 5. Run State Machine
- `IDLE -> PLANNING -> VALIDATING -> EXECUTING -> DONE|ERROR|CANCELLED`

Recommended detailed phase machine:
- `idle -> generating -> requesting_context -> applying -> verifying -> done|error|cancelled`

Each step stores:
- `step_id`
- `action_type` (`NODE_TREE` or `GN_OPS` or `PYTHON`)
- `status`
- `started_at`, `ended_at`
- `message`, `error`

## 6. Execution Policies
### 6.1 NodeTreeExecutor
- Creates or targets a named Geometry Nodes modifier.
- Supports:
  - node creation/deletion/update
  - link create/remove
  - socket defaults
  - group input/output wiring
  - simulation/repeat zones (where API supports)
- Uses ID-based reconciliation to reduce graph churn.

### 6.2 PythonExecutor
- Executes snippet in controlled globals.
- Default `safe` mode:
  - restricted builtins
  - denylist imports/modules
  - no file/network/process spawn
- `trusted` mode enabled only via explicit user setting + per-run confirmation.

### 6.3 GNOpsExecutor
- Applies ordered deterministic operations to a target Geometry Nodes modifier.
- Suggested operations:
  - `ensure_target`
  - `ensure_single_group_io`
  - `add_node`
  - `remove_node`
  - `link`
  - `unlink`
  - `set_input`
  - `cleanup_unused`
- Uses strategy registry pattern for extensibility and testability.

## 7. Verification Gates
- Required gates must pass before accepting `done=true`.
- Suggested default gates:
  - `SINGLE_GROUP_OUTPUT`
  - `OUTPUT_CONNECTED`
  - `NO_MODIFIER_ERROR`
  - `NO_UNEXPECTED_NEW_MODIFIER`
  - `NO_UNEXPECTED_NEW_NODE_GROUP`
- On gate failure:
  - run enters retry path (`verifying -> generating`)
  - assistant receives structured failure feedback.

## 8. Error Handling
- Protocol validation errors returned before execution.
- Step-level failure does not crash addon; run ends in `ERROR` with partial log.
- Include actionable failure messages back to chat.

## 9. Context Slicing and Budget
- Always send minimal context each iteration (active object, target modifier, iteration state).
- Support on-demand context slices:
  - modifier stack
  - node tree summary
  - full scene summary
  - active node tree IR
  - geometry stats
- Enforce truncation budgets for large IR payloads.

## 10. Presets
- Format: JSON export with metadata, version, and protocol payload.
- Operations:
  - save current run as preset
  - load and apply preset
  - import/export files

## 11. Telemetry & Metrics (Local)
- request latency
- execution latency per step
- success/failure counters
- token usage (if provider exposes)

## 12. Testing Harness
- Manifest-driven E2E tests with:
  - prompt
  - timeout
  - expected objects/modifiers/node types
- Runner validates both:
  - protocol/execution status
  - scene outcome assertions

## 13. Extensibility
- Add new action types via executor registry:
  - `register_executor(action_type, executor_impl)`
- Versioned protocol to preserve backward compatibility.
