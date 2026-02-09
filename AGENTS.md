# Repository Guidelines

## Project Structure & Module Organization
This repository combines a Blender add-on scaffold, a validation harness, and a React dashboard.
- `scaffold/`: Blender add-on package (`__init__.py`, `operators.py`, `panels.py`).
- `test_harness.py`: Headless Blender import/registration sanity check for generated add-ons.
- `web_interface/`: Vite + React monitoring UI (`src/App.jsx`, `src/main.jsx`, `src/index.css`).
- `skills/`: Prompt/agent reference material used by swarm workflows.
- `mcp.json`: MCP server configuration used with Claude CLI.

## Build, Test, and Development Commands
Run commands from the repository root unless noted.
- `cd web_interface && npm install`: Install dashboard dependencies.
- `cd web_interface && npm run dev`: Start local Vite dev server.
- `cd web_interface && npm run build`: Produce production UI build.
- `cd web_interface && npm run preview`: Preview the built UI locally.
- `blender -b -P test_harness.py -- scaffold`: Validate add-on package import in headless Blender.
- `claude --mcp mcp.json`: Launch Claude CLI with repository MCP servers.

## Coding Style & Naming Conventions
- Python: Follow PEP 8, 4-space indentation, and explicit imports.
- Blender classes: Keep Blender-style prefixes (for example `AETHER_OT_*` operators, `AETHER_PT_*` panels) and register classes in `scaffold/__init__.py`.
- JavaScript/React: Use functional components and `const`; component files in PascalCase (for example `App.jsx`), variables/functions in camelCase.
- Keep modules focused: operator logic in `operators.py`, UI panel drawing in `panels.py`.

## Testing Guidelines
- Primary validation is Blender headless execution via `test_harness.py`.
- Treat import failures, registration errors, and syntax errors as blocking.
- For UI changes, run `npm run build` to catch type/bundle issues before opening a PR.

## Commit & Pull Request Guidelines
Local `.git` history is not present in this workspace snapshot, so use this baseline:
- Commit format: Conventional Commits (for example `feat: add mesh cleanup operator`, `fix: guard null prompt in dashboard`).
- Keep commits small and scoped to one concern.
- PRs should include: purpose, changed paths, validation steps run, and screenshots/GIFs for `web_interface/` UI updates.
- Link related issues/tasks and note any Blender version assumptions (target is 4.0+).
