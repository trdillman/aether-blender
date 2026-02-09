# Task Completion Checklist

Run the appropriate checks based on changed areas.

## If Blender/Python scaffold or harness changed
- Run: `blender -b -P test_harness.py -- scaffold`
- Treat import failures, registration errors, and syntax errors as blocking.

## If frontend changed (`web_interface`)
- Run: `cd web_interface; npm run build`
- Use `npm run dev` for local verification if needed.

## If backend changed (`server`)
- Run: `cd server; npm test`
- Optionally run: `cd server; npm start` for manual endpoint checks.

## Before finalizing work
- Confirm no obvious runtime/config regressions.
- Summarize validation commands run and outcomes.
- Keep change scope aligned to a single concern when possible.