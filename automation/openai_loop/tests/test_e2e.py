"""E2E test for the OpenAI loop using mocked role agents."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List
from unittest import mock

from automation.openai_loop import runner


class FakeResponse:
    def __init__(self, output_text: str) -> None:
        self.output_text = output_text


class FakeOpenAI:
    def __init__(self, model_payloads: Dict[str, Dict[str, Any]]) -> None:
        self._model_payloads = model_payloads
        self.responses = self
        self.calls: List[Dict[str, Any]] = []

    def create(self, model: str, input: Any) -> FakeResponse:  # type: ignore[override]
        payload = self._model_payloads.get(model)
        if payload is None:
            raise ValueError(f"Unexpected model requested: {model}")
        self.calls.append({"model": model, "input": input})
        return FakeResponse(output_text=json.dumps(payload))


class OpenAILoopE2ETest(unittest.TestCase):
    def test_loop_runner_completes_with_mocked_agents(self) -> None:
        planner_payload = {
            "summary": "plan ready",
            "done_flag": True,
            "tasks": [
                {
                    "task_id": "T1",
                    "title": "Ship feature",
                    "status": "done",
                    "notes": "",
                }
            ],
        }
        coder_payload = {
            "summary": "code done",
            "changed_files": ["automation/openai_loop/state.py"],
            "completed_task_ids": ["T1"],
            "pending_task_ids": [],
            "notes": "",
        }
        tester_payload = {
            "summary": "tests green",
            "tests_passed": True,
            "test_command": "python -m unittest",
            "failures": [],
            "follow_up_tasks": [],
        }

        fake_client = FakeOpenAI(
            {
                "planner-model": planner_payload,
                "coder-model": coder_payload,
                "tester-model": tester_payload,
            }
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = Path(tmpdir) / "loop.jsonl"
            argv = [
                "openai-loop",
                "--task",
                "E2E mocked run",
                "--max-iterations",
                "3",
                "--planner-model",
                "planner-model",
                "--coder-model",
                "coder-model",
                "--tester-model",
                "tester-model",
                "--log-path",
                str(log_path),
            ]

            with mock.patch.object(runner, "OpenAI", return_value=fake_client):
                with mock.patch("sys.argv", argv):
                    exit_code = runner.main()

            self.assertEqual(exit_code, 0)
            self.assertTrue(log_path.exists())
            self.assertGreater(log_path.stat().st_size, 0)
            self.assertEqual(
                {call["model"] for call in fake_client.calls},
                {"planner-model", "coder-model", "tester-model"},
            )


if __name__ == "__main__":
    unittest.main()
