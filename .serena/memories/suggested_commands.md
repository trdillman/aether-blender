# Suggested Commands (Windows / PowerShell)

## Repository Basics
- `cd C:\Users\Tyler\Desktop\Aether-Blender-Swarm`
- `Get-ChildItem`
- `git status`
- `git diff`
- `rg <pattern>`

## Frontend (`web_interface`)
- `cd web_interface; npm install`
- `cd web_interface; npm run dev`
- `cd web_interface; npm run build`
- `cd web_interface; npm run preview`

## Backend (`server`)
- `cd server; npm test`
- `cd server; npm start`

## Blender Add-on Validation
- `blender -b -P test_harness.py -- scaffold`

## MCP / CLI
- `claude --mcp mcp.json`
- `codex mcp list`

## Helpful Windows Commands
- `Get-Content <file>`
- `Select-String -Path <file> -Pattern <regex>`
- `Get-ChildItem -Recurse <path>`
- `where blender`
- `node -v; npm -v`