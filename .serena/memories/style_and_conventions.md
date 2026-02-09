# Style And Conventions

## Python
- Follow PEP 8.
- Use 4-space indentation.
- Prefer explicit imports.

## Blender Add-on Naming
- Keep Blender-style class prefixes:
  - operators: `AETHER_OT_*`
  - panels: `AETHER_PT_*`
- Register classes centrally in `scaffold/__init__.py`.
- Keep module boundaries clear:
  - operator logic in `scaffold/operators.py`
  - UI drawing/panel logic in `scaffold/panels.py`

## JavaScript/React
- Use functional components.
- Prefer `const` where possible.
- Component filenames in PascalCase (e.g., `App.jsx`, `TopBar.jsx`).
- Variables and functions in camelCase.

## Commit/PR Conventions
- Use Conventional Commits (e.g., `feat: ...`, `fix: ...`).
- Keep commits scoped to one concern.
- PRs should include purpose, changed paths, validation steps, and UI screenshots/GIFs for frontend changes.
- Mention Blender version assumptions (target 4.0+).