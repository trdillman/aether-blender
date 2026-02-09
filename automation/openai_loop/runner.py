"""CLI entrypoint for autonomous OpenAI loop."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from openai import OpenAI

from .agents import RoleAgents
from .orchestrator import JsonlLogger, OpenAILoopOrchestrator


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Autonomous OpenAI development loop")
    parser.add_argument("--task", required=True, help="Top-level engineering task")
    parser.add_argument(
        "--max-iterations", type=int, default=8, help="Maximum loop iterations"
    )
    parser.add_argument(
        "--planner-model",
        default="gpt-4.1-mini",
        help="Model for planner role",
    )
    parser.add_argument(
        "--coder-model",
        default="gpt-4.1-mini",
        help="Model for coder role",
    )
    parser.add_argument(
        "--tester-model",
        default="gpt-4.1-mini",
        help="Model for tester role",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=2,
        help="Max retries per role call",
    )
    parser.add_argument(
        "--log-path",
        default="automation/openai_loop/logs/loop.jsonl",
        help="Path to structured JSONL log file",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()

    client = OpenAI()
    agents = RoleAgents(
        client=client,
        planner_model=args.planner_model,
        coder_model=args.coder_model,
        tester_model=args.tester_model,
        max_retries=args.max_retries,
    )
    logger = JsonlLogger(path=Path(args.log_path))
    orchestrator = OpenAILoopOrchestrator(agents=agents, logger=logger)

    final_state = orchestrator.run(task=args.task, max_iterations=args.max_iterations)
    print(json.dumps(final_state.to_summary(), indent=2))
    return 0 if final_state.phase.value == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())

