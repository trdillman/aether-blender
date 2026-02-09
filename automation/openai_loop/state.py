"""State machine and artifact tracking for the autonomous loop."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional


class LoopPhase(str, Enum):
    INIT = "init"
    PLANNING = "planning"
    CODING = "coding"
    TESTING = "testing"
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"


class TaskStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    BLOCKED = "blocked"


@dataclass
class WorkItem:
    task_id: str
    title: str
    status: TaskStatus = TaskStatus.PENDING
    notes: str = ""


@dataclass
class LoopState:
    task: str
    max_iterations: int = 8
    phase: LoopPhase = LoopPhase.INIT
    iteration: int = 0
    done_flag: bool = False
    tests_passed: bool = False
    stop_reason: Optional[str] = None
    consecutive_failures: int = 0
    no_progress_iterations: int = 0
    work_items: Dict[str, WorkItem] = field(default_factory=dict)
    artifacts: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    _VALID_TRANSITIONS = {
        LoopPhase.INIT: {LoopPhase.PLANNING, LoopPhase.STOPPED, LoopPhase.FAILED},
        LoopPhase.PLANNING: {LoopPhase.CODING, LoopPhase.STOPPED, LoopPhase.FAILED},
        LoopPhase.CODING: {LoopPhase.TESTING, LoopPhase.STOPPED, LoopPhase.FAILED},
        LoopPhase.TESTING: {
            LoopPhase.PLANNING,
            LoopPhase.COMPLETED,
            LoopPhase.STOPPED,
            LoopPhase.FAILED,
        },
        LoopPhase.COMPLETED: set(),
        LoopPhase.FAILED: set(),
        LoopPhase.STOPPED: set(),
    }

    def transition_to(self, new_phase: LoopPhase) -> None:
        allowed = self._VALID_TRANSITIONS.get(self.phase, set())
        if new_phase not in allowed:
            raise ValueError(
                f"Invalid transition: {self.phase.value} -> {new_phase.value}"
            )
        self.phase = new_phase

    def apply_planner_result(self, tasks: List[Dict[str, str]], done_flag: bool) -> None:
        self.done_flag = bool(done_flag)
        for raw_task in tasks:
            task_id = raw_task["task_id"]
            status_text = raw_task.get("status", TaskStatus.PENDING.value)
            status = TaskStatus(status_text)
            item = self.work_items.get(task_id)
            if item is None:
                self.work_items[task_id] = WorkItem(
                    task_id=task_id,
                    title=raw_task.get("title", task_id),
                    status=status,
                    notes=raw_task.get("notes", ""),
                )
                continue
            item.title = raw_task.get("title", item.title)
            item.status = status
            item.notes = raw_task.get("notes", item.notes)

    def apply_coder_result(
        self,
        changed_files: List[str],
        completed_task_ids: List[str],
        pending_task_ids: List[str],
    ) -> None:
        for path in changed_files:
            if path not in self.artifacts:
                self.artifacts.append(path)
        for task_id in completed_task_ids:
            item = self.work_items.get(task_id)
            if item:
                item.status = TaskStatus.DONE
        for task_id in pending_task_ids:
            item = self.work_items.get(task_id)
            if item:
                item.status = TaskStatus.PENDING

    def apply_tester_result(
        self, tests_passed: bool, follow_up_tasks: List[Dict[str, str]]
    ) -> None:
        self.tests_passed = bool(tests_passed)
        for follow_up in follow_up_tasks:
            task_id = follow_up["task_id"]
            if task_id in self.work_items:
                self.work_items[task_id].status = TaskStatus.PENDING
                if follow_up.get("notes"):
                    self.work_items[task_id].notes = follow_up["notes"]
                continue
            self.work_items[task_id] = WorkItem(
                task_id=task_id,
                title=follow_up.get("title", task_id),
                status=TaskStatus.PENDING,
                notes=follow_up.get("notes", ""),
            )

    def has_pending_tasks(self) -> bool:
        return any(
            item.status in (TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED)
            for item in self.work_items.values()
        )

    def completion_gates_met(self) -> bool:
        return self.done_flag and self.tests_passed and not self.has_pending_tasks()

    def record_error(self, message: str) -> None:
        self.errors.append(message)

    def state_fingerprint(self) -> str:
        pending = sorted(
            [
                item.task_id
                for item in self.work_items.values()
                if item.status != TaskStatus.DONE
            ]
        )
        done = sorted(
            [item.task_id for item in self.work_items.values() if item.status == TaskStatus.DONE]
        )
        return (
            f"pending={pending}|done={done}|tests_passed={self.tests_passed}|"
            f"done_flag={self.done_flag}|artifacts={sorted(self.artifacts)}"
        )

    def to_summary(self) -> Dict[str, object]:
        return {
            "task": self.task,
            "phase": self.phase.value,
            "iteration": self.iteration,
            "done_flag": self.done_flag,
            "tests_passed": self.tests_passed,
            "pending_tasks": [
                {
                    "task_id": item.task_id,
                    "title": item.title,
                    "status": item.status.value,
                    "notes": item.notes,
                }
                for item in self.work_items.values()
                if item.status != TaskStatus.DONE
            ],
            "artifacts": list(self.artifacts),
            "errors": list(self.errors),
            "stop_reason": self.stop_reason,
        }

