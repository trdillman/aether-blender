"""Orchestrates planner/coder/tester agents in a guarded loop."""

from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .agents import CoderResult, PlannerResult, RoleAgents, TesterResult
from .state import LoopPhase, LoopState


class JsonlLogger:
    """Simple structured logger writing one JSON document per line."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def log(self, event: str, payload: dict[str, Any]) -> None:
        entry = {
            "ts": datetime.now(tz=timezone.utc).isoformat(),
            "event": event,
            "payload": payload,
        }
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=True) + "\n")


class OpenAILoopOrchestrator:
    """Coordinates role workers and loop stop/completion gates."""

    def __init__(
        self,
        agents: RoleAgents,
        logger: JsonlLogger,
        max_consecutive_failures: int = 3,
        max_no_progress_iterations: int = 2,
    ) -> None:
        self.agents = agents
        self.logger = logger
        self.max_consecutive_failures = max(1, max_consecutive_failures)
        self.max_no_progress_iterations = max(1, max_no_progress_iterations)

    def run(self, task: str, max_iterations: int) -> LoopState:
        state = LoopState(task=task, max_iterations=max_iterations)
        self.logger.log("loop_started", {"task": task, "max_iterations": max_iterations})

        while state.iteration < state.max_iterations:
            state.iteration += 1
            before = state.state_fingerprint()
            self.logger.log(
                "iteration_started",
                {"iteration": state.iteration, "state": state.to_summary()},
            )

            try:
                if state.phase != LoopPhase.PLANNING:
                    state.transition_to(LoopPhase.PLANNING)
                planner_result = self.agents.run_planner(state)
                self._log_role_output("planner_output", planner_result)
                self._apply_planner_result(state, planner_result)

                state.transition_to(LoopPhase.CODING)
                coder_result = self.agents.run_coder(state)
                self._log_role_output("coder_output", coder_result)
                self._apply_coder_result(state, coder_result)

                state.transition_to(LoopPhase.TESTING)
                tester_result = self.agents.run_tester(state)
                self._log_role_output("tester_output", tester_result)
                self._apply_tester_result(state, tester_result)

                state.consecutive_failures = 0

                if state.completion_gates_met():
                    state.transition_to(LoopPhase.COMPLETED)
                    state.stop_reason = "completion_gates_met"
                    self.logger.log("loop_completed", state.to_summary())
                    return state

                after = state.state_fingerprint()
                state.no_progress_iterations = (
                    state.no_progress_iterations + 1 if after == before else 0
                )
                if state.no_progress_iterations >= self.max_no_progress_iterations:
                    state.transition_to(LoopPhase.STOPPED)
                    state.stop_reason = "no_progress_guard_triggered"
                    self.logger.log("loop_stopped", state.to_summary())
                    return state

                state.transition_to(LoopPhase.PLANNING)
                self.logger.log("iteration_finished", {"iteration": state.iteration})
            except Exception as exc:
                state.consecutive_failures += 1
                state.record_error(str(exc))
                self.logger.log(
                    "iteration_failed",
                    {
                        "iteration": state.iteration,
                        "error": str(exc),
                        "consecutive_failures": state.consecutive_failures,
                    },
                )
                if state.consecutive_failures >= self.max_consecutive_failures:
                    state.transition_to(LoopPhase.FAILED)
                    state.stop_reason = "max_consecutive_failures"
                    self.logger.log("loop_failed", state.to_summary())
                    return state
                if state.phase != LoopPhase.PLANNING:
                    try:
                        state.transition_to(LoopPhase.PLANNING)
                    except ValueError:
                        pass

        state.transition_to(LoopPhase.STOPPED)
        state.stop_reason = "max_iterations_reached"
        self.logger.log("loop_stopped", state.to_summary())
        return state

    def _apply_planner_result(self, state: LoopState, result: PlannerResult) -> None:
        state.apply_planner_result(tasks=result.tasks, done_flag=result.done_flag)

    def _apply_coder_result(self, state: LoopState, result: CoderResult) -> None:
        state.apply_coder_result(
            changed_files=result.changed_files,
            completed_task_ids=result.completed_task_ids,
            pending_task_ids=result.pending_task_ids,
        )

    def _apply_tester_result(self, state: LoopState, result: TesterResult) -> None:
        state.apply_tester_result(
            tests_passed=result.tests_passed,
            follow_up_tasks=result.follow_up_tasks,
        )

    def _log_role_output(self, event: str, result: Any) -> None:
        payload = asdict(result) if is_dataclass(result) else {"result": str(result)}
        self.logger.log(event, payload)
