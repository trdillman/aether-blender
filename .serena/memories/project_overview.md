# Aether-Blender-Swarm Project Overview

## Purpose
Aether-Blender-Swarm is an autonomous Blender add-on generation system with:
- a Blender add-on scaffold (`scaffold/`)
- a headless Blender validation harness (`test_harness.py`)
- a Node.js orchestration backend (`server/`)
- a React/Vite monitoring UI (`web_interface/`)
- skill/prompt assets for swarm workflows (`skills/`)

Primary goal: generate and validate Blender add-ons (target Blender 4.0+) with LLM-assisted orchestration and monitoring.

## Tech Stack
- Python (Blender add-on + harness + bridge)
- JavaScript/Node.js (backend orchestrator and tests)
- React + Vite (frontend dashboard)
- MCP configuration via `mcp.json`

## High-Level Structure
- `scaffold/`: Blender add-on package (`__init__.py`, `operators.py`, `panels.py`)
- `test_harness.py`: headless Blender import/registration sanity check
- `server/`: HTTP API + run orchestration + Blender session/RPC bridge
- `web_interface/`: frontend monitor and control UI
- `skills/`: local skill docs used by swarm workflows
- `mcp.json`: MCP server config for Claude CLI

## Runtime Entry Points
- Backend: `server/index.js`
- Frontend: `web_interface/src/main.jsx` + `web_interface/src/App.jsx`
- Blender validation: `test_harness.py`

## Notes
- Backend includes tests in `server/tests/*.test.js`.
- Frontend uses Vite and React 18.
- Current project conventions are documented in `AGENTS.md`.