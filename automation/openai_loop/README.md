# OpenAI Autonomous Development Loop

Self-contained framework for iterative planner/coder/tester orchestration using the OpenAI Python SDK Responses API.

## Files
- `automation/openai_loop/orchestrator.py`: loop coordinator, completion gates, and guards.
- `automation/openai_loop/agents.py`: role-specific OpenAI calls and structured JSON parsing.
- `automation/openai_loop/state.py`: phase/state machine, work-item tracking, artifact tracking.
- `automation/openai_loop/runner.py`: CLI entrypoint.
- `automation/openai_loop/logs/loop.jsonl`: default structured log output.

## Requirements
- Python 3.10+
- `openai` Python SDK installed.
- Environment variable: `OPENAI_API_KEY`

## Setup
```bash
python -m pip install openai
```

## Usage
```bash
python -m automation.openai_loop.runner --task "Implement feature X with tests"
```

Common options:
```bash
python -m automation.openai_loop.runner ^
  --task "Refactor module Y and stabilize tests" ^
  --max-iterations 10 ^
  --planner-model gpt-4.1-mini ^
  --coder-model gpt-4.1-mini ^
  --tester-model gpt-4.1-mini ^
  --max-retries 3 ^
  --log-path automation/openai_loop/logs/run-001.jsonl
```

## Completion Gates
The orchestrator only exits as complete when all are true:
1. `tests_passed == true`
2. no pending work items remain
3. explicit `done_flag == true` from planner output

## Safety Guards
- `max_iterations` hard stop.
- per-role retry limit (`max_retries`).
- `max_consecutive_failures` guard in orchestrator.
- no-progress guard (`max_no_progress_iterations`) to stop dead loops.
- structured local JSONL logs for audit and replay.

## Structured Logging
Every major event is logged as one JSON object per line with:
- UTC timestamp (`ts`)
- event name (`event`)
- event payload (`payload`)

Example events:
- `loop_started`
- `iteration_started`
- `planner_output`
- `coder_output`
- `tester_output`
- `loop_completed` / `loop_stopped` / `loop_failed`

## Stop Conditions
Loop exits on first matched condition:
1. completion gates met (`completed`)
2. max iterations reached (`stopped`)
3. no progress across configured iterations (`stopped`)
4. max consecutive failures reached (`failed`)

## Notes
- Role workers are independent functions with independent prompts and model calls.
- The tester role output controls `tests_passed`; this framework does not execute shell tests directly.
- Use external CI/local runners for authoritative command execution when needed.

