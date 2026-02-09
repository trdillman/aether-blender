# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aether-Blender-Swarm is an autonomous Blender add-on generation system designed for Claude CLI and GLM 4.7. It implements a multi-agent swarm architecture (DAG) to generate, validate, and test Blender add-ons through inference-time scaling techniques including recursive self-refinement, chain-of-thought expansion, and consensus voting.

## Architecture

### Swarm Agent DAG Structure
- **Architect (Commander):** Breaks prompts into sub-tasks, manages global state
- **Developer (GLM-Dev):** Writes Blender Python code using the scaffold framework
- **Auditor (Linter/Critic):** Validates against `bpy` standards and PEP8
- **Test Pilot:** Executes code in headless Blender environment
- **Doc-Gen:** Creates user manuals and API documentation

### Core Components
- `scaffold/`: Blender add-on package scaffold with registration pattern
  - `__init__.py`: Main entry point with `classes` tuple, `register()/unregister()` functions
  - `operators.py`: Blender operators (prefixed `AETHER_OT_*`)
  - `panels.py`: UI panels (prefixed `AETHER_PT_*`)
- `test_harness.py`: Headless Blender import/registration validation
- `web_interface/`: Vite + React monitoring dashboard for swarm operations
- `skills/`: Agent prompt/injection reference material
- `mcp.json`: MCP server configuration for Claude CLI integration

### MCP Integration
The project uses Model Context Protocol servers for:
- **Filesystem MCP:** Recursive directory management
- **Memory MCP:** Context persistence across swarm sessions
- **Fetch MCP:** Real-time Blender API documentation lookups

## Development Commands

### Blender Add-on Development
```bash
# Validate add-on package import in headless Blender
blender -b -P test_harness.py -- scaffold
```

### Web Interface
```bash
cd web_interface
npm install              # Install dependencies
npm run dev              # Start Vite dev server
npm run build            # Production build
npm run preview          # Preview built UI
```

### Claude CLI with MCP
```bash
# Launch Claude CLI with repository MCP servers
claude --mcp mcp.json
```

## Coding Standards

### Python (Blender Add-ons)
- Follow PEP 8 with 4-space indentation
- Blender class prefixes: `AETHER_OT_*` for operators, `AETHER_PT_*` for panels
- All operators must have `try-except` in `execute()` returning `{'CANCELLED'}` on failure
- Use `bl_info` dictionary at top of main `__init__.py`
- Registration pattern: `classes = (...)` tuple with `register()/unregister()` functions
- Type hints required for all function arguments
- Use official Blender internal icons

### Threading for LLM Integration
Critical: Blender freezes if blocking operations occur on main thread
- Use `threading.Thread(target=my_func).start()` for background work
- Use `queue.Queue` for inter-thread communication
- NEVER access `bpy.context` inside threads; use `bpy.app.timers.register()` for UI updates

### React/Web Interface
- Functional components with `const` declarations
- PascalCase for component files (e.g., `App.jsx`)
- camelCase for variables and functions

## Validation & Testing

Primary validation is headless Blender execution via `test_harness.py`. Blocking failures include:
- Import failures
- Registration errors
- Syntax errors

Pre-validation hooks run `flake8` and `mypy` on generated files.

## Version Requirements
- **Blender:** 4.0+ (executable as `blender` in PATH)
- **Node.js & NPM:** For web dashboard and MCP servers
- **Claude CLI:** Installed via `npm install -g @anthropic-ai/claude-code`
