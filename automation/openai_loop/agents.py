"""Role-specific OpenAI Responses API calls for planner/coder/tester."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from openai import OpenAI

from .state import LoopState, TaskStatus


PLANNER_PROMPT = """You are the planner in an autonomous software development loop.
Return strict JSON only (no markdown).
You must:
1) Break the task into concrete work items.
2) Mark each item status as one of: pending, in_progress, done, blocked.
3) Set done_flag=true only when all meaningful work is complete.
JSON schema:
{
  "summary": "string",
  "done_flag": false,
  "tasks": [{"task_id": "T1", "title": "string", "status": "pending", "notes": "string"}]
}
"""

CODER_PROMPT = """You are the coder in an autonomous software development loop.
Return strict JSON only (no markdown).
Based on current state, report what code changes should be made this iteration.
JSON schema:
{
  "summary": "string",
  "changed_files": ["path/to/file.py"],
  "completed_task_ids": ["T1"],
  "pending_task_ids": ["T2"],
  "notes": "string"
}
"""

TESTER_PROMPT = """You are the tester in an autonomous software development loop.
Return strict JSON only (no markdown).
Evaluate whether tests pass. If they do not pass, create follow-up tasks.
JSON schema:
{
  "summary": "string",
  "tests_passed": false,
  "test_command": "string",
  "failures": ["description"],
  "follow_up_tasks": [{"task_id": "T-test-1", "title": "string", "notes": "string"}]
}
"""


@dataclass
class PlannerResult:
    summary: str
    done_flag: bool
    tasks: List[Dict[str, str]]


@dataclass
class CoderResult:
    summary: str
    changed_files: List[str]
    completed_task_ids: List[str]
    pending_task_ids: List[str]
    notes: str = ""


@dataclass
class TesterResult:
    summary: str
    tests_passed: bool
    test_command: str
    failures: List[str]
    follow_up_tasks: List[Dict[str, str]]


class RoleAgents:
    """Encapsulates independent role prompts and model calls."""

    def __init__(
        self,
        client: OpenAI,
        planner_model: str,
        coder_model: str,
        tester_model: str,
        max_retries: int = 2,
        retry_delay_seconds: float = 1.0,
    ) -> None:
        self.client = client
        self.planner_model = planner_model
        self.coder_model = coder_model
        self.tester_model = tester_model
        self.max_retries = max(0, max_retries)
        self.retry_delay_seconds = max(0.1, retry_delay_seconds)

    def run_planner(self, state: LoopState) -> PlannerResult:
        payload = self._call_role(
            model=self.planner_model,
            system_prompt=PLANNER_PROMPT,
            role_name="planner",
            state=state,
        )
        tasks = self._normalize_tasks(payload.get("tasks", []))
        return PlannerResult(
            summary=str(payload.get("summary", "")),
            done_flag=bool(payload.get("done_flag", False)),
            tasks=tasks,
        )

    def run_coder(self, state: LoopState) -> CoderResult:
        payload = self._call_role(
            model=self.coder_model,
            system_prompt=CODER_PROMPT,
            role_name="coder",
            state=state,
        )
        return CoderResult(
            summary=str(payload.get("summary", "")),
            changed_files=self._as_str_list(payload.get("changed_files", [])),
            completed_task_ids=self._as_str_list(payload.get("completed_task_ids", [])),
            pending_task_ids=self._as_str_list(payload.get("pending_task_ids", [])),
            notes=str(payload.get("notes", "")),
        )

    def run_tester(self, state: LoopState) -> TesterResult:
        payload = self._call_role(
            model=self.tester_model,
            system_prompt=TESTER_PROMPT,
            role_name="tester",
            state=state,
        )
        follow_up_tasks = self._normalize_follow_up_tasks(
            payload.get("follow_up_tasks", [])
        )
        return TesterResult(
            summary=str(payload.get("summary", "")),
            tests_passed=bool(payload.get("tests_passed", False)),
            test_command=str(payload.get("test_command", "")),
            failures=self._as_str_list(payload.get("failures", [])),
            follow_up_tasks=follow_up_tasks,
        )

    def _call_role(
        self,
        model: str,
        system_prompt: str,
        role_name: str,
        state: LoopState,
    ) -> Dict[str, Any]:
        last_error: Optional[Exception] = None
        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": json.dumps(state.to_summary(), indent=2),
            },
        ]
        for attempt in range(self.max_retries + 1):
            try:
                response = self.client.responses.create(
                    model=model,
                    input=messages,
                )
                text = self._extract_text(response)
                payload = self._extract_json_dict(text)
                return payload
            except Exception as exc:  # pragma: no cover - exercised through behavior tests
                last_error = exc
                if attempt == self.max_retries:
                    break
                time.sleep(self.retry_delay_seconds * (attempt + 1))
        raise RuntimeError(f"{role_name} call failed after retries: {last_error}") from last_error

    @staticmethod
    def _extract_text(response: Any) -> str:
        if hasattr(response, "output_text") and response.output_text:
            return str(response.output_text)

        # Older/newer SDK compatibility fallback.
        dump = response.model_dump() if hasattr(response, "model_dump") else {}
        if isinstance(dump, dict):
            output = dump.get("output", [])
            for item in output:
                content = item.get("content", [])
                for chunk in content:
                    if chunk.get("type") == "output_text":
                        return str(chunk.get("text", ""))
        raise ValueError("Response did not contain text output.")

    @staticmethod
    def _extract_json_dict(text: str) -> Dict[str, Any]:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
        data = json.loads(cleaned)
        if not isinstance(data, dict):
            raise ValueError("Expected top-level JSON object.")
        return data

    @staticmethod
    def _as_str_list(raw: Any) -> List[str]:
        if not isinstance(raw, list):
            return []
        return [str(item) for item in raw]

    @staticmethod
    def _normalize_tasks(raw: Any) -> List[Dict[str, str]]:
        tasks: List[Dict[str, str]] = []
        if not isinstance(raw, list):
            return tasks
        for i, item in enumerate(raw):
            if not isinstance(item, dict):
                continue
            task_id = str(item.get("task_id") or f"T{i + 1}")
            status = str(item.get("status") or TaskStatus.PENDING.value)
            if status not in {status.value for status in TaskStatus}:
                status = TaskStatus.PENDING.value
            tasks.append(
                {
                    "task_id": task_id,
                    "title": str(item.get("title") or task_id),
                    "status": status,
                    "notes": str(item.get("notes") or ""),
                }
            )
        return tasks

    @staticmethod
    def _normalize_follow_up_tasks(raw: Any) -> List[Dict[str, str]]:
        tasks: List[Dict[str, str]] = []
        if not isinstance(raw, list):
            return tasks
        for i, item in enumerate(raw):
            if not isinstance(item, dict):
                continue
            task_id = str(item.get("task_id") or f"T-test-{i + 1}")
            tasks.append(
                {
                    "task_id": task_id,
                    "title": str(item.get("title") or task_id),
                    "notes": str(item.get("notes") or ""),
                }
            )
        return tasks

