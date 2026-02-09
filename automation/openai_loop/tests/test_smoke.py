"""Smoke tests for autonomous loop state transitions and guards."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from automation.openai_loop.agents import CoderResult, PlannerResult, TesterResult
from automation.openai_loop.orchestrator import JsonlLogger, OpenAILoopOrchestrator
from automation.openai_loop.state import LoopPhase, LoopState


class FakeAgents:
    def __init__(self) -> None:
        self._planner_calls = 0

    def run_planner(self, _state: LoopState) -> PlannerResult:
        self._planner_calls += 1
        if self._planner_calls == 1:
            return PlannerResult(
                summary="create one task",
                done_flag=False,
                tasks=[{"task_id": "T1", "title": "Do work", "status": "pending", "notes": ""}],
            )
        return PlannerResult(
            summary="mark done",
            done_flag=True,
            tasks=[{"task_id": "T1", "title": "Do work", "status": "done", "notes": ""}],
        )

    def run_coder(self, _state: LoopState) -> CoderResult:
        return CoderResult(
            summary="mark task done",
            changed_files=["automation/openai_loop/state.py"],
            completed_task_ids=["T1"],
            pending_task_ids=[],
            notes="",
        )

    def run_tester(self, state: LoopState) -> TesterResult:
        # Pass on second iteration so completion gate also requires explicit planner done_flag.
        pass_now = state.iteration >= 2
        return TesterResult(
            summary="tests result",
            tests_passed=pass_now,
            test_command="python -m unittest",
            failures=[] if pass_now else ["failing smoke check"],
            follow_up_tasks=[],
        )


class StuckAgents:
    def run_planner(self, _state: LoopState) -> PlannerResult:
        return PlannerResult(
            summary="never done",
            done_flag=False,
            tasks=[{"task_id": "T1", "title": "still pending", "status": "pending", "notes": ""}],
        )

    def run_coder(self, _state: LoopState) -> CoderResult:
        return CoderResult(
            summary="no progress",
            changed_files=[],
            completed_task_ids=[],
            pending_task_ids=["T1"],
            notes="",
        )

    def run_tester(self, _state: LoopState) -> TesterResult:
        return TesterResult(
            summary="tests failing",
            tests_passed=False,
            test_command="python -m unittest",
            failures=["still failing"],
            follow_up_tasks=[],
        )


class StateMachineSmokeTest(unittest.TestCase):
    def test_loop_completes_when_all_gates_are_true(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            logger = JsonlLogger(Path(tmpdir) / "loop.jsonl")
            orchestrator = OpenAILoopOrchestrator(agents=FakeAgents(), logger=logger)
            state = orchestrator.run(task="demo task", max_iterations=4)

        self.assertEqual(state.phase, LoopPhase.COMPLETED)
        self.assertTrue(state.done_flag)
        self.assertTrue(state.tests_passed)
        self.assertFalse(state.has_pending_tasks())
        self.assertIn("automation/openai_loop/state.py", state.artifacts)

    def test_loop_stops_on_max_iterations_guard(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            logger = JsonlLogger(Path(tmpdir) / "loop.jsonl")
            orchestrator = OpenAILoopOrchestrator(
                agents=StuckAgents(),
                logger=logger,
                max_no_progress_iterations=10,
            )
            state = orchestrator.run(task="stuck task", max_iterations=1)

        self.assertEqual(state.phase, LoopPhase.STOPPED)
        self.assertEqual(state.stop_reason, "max_iterations_reached")

    def test_invalid_state_transition_raises(self) -> None:
        state = LoopState(task="t")
        with self.assertRaises(ValueError):
            state.transition_to(LoopPhase.TESTING)


if __name__ == "__main__":
    unittest.main()

