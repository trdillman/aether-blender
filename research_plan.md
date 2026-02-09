# Aether-Blender-Swarm: GLM 4.7 Quality Elevation Plan

## 1. The "Quality Elevation" Strategy for GLM 4.7
To achieve "Frontier Model" results with GLM 4.7, we implement **Inference-Time Scaling**:
* **Recursive Self-Refinement:** Instead of one-shot generation, GLM is forced to generate a plan, a draft, a critique, and then a final version.
* **Chain-of-Thought Expansion:** System prompts require GLM to output "Thinking" blocks exceeding 1000 words for complex logic before writing code.
* **Consensus Voting:** Parallel agents generate solutions for the same module; a "Judge" agent selects the most PEP8 and Blender-compliant version.

## 2. Swarm Orchestration Structure
The system operates as a **Directed Acyclic Graph (DAG)** of agents:
1.  **The Architect (Commander):** Breaks the prompt into sub-tasks and manages the global state.
2.  **The Developer (GLM-Dev):** Writes the Blender Python code using the `blender_scaffold`.
3.  **The Auditor (Linter/Critic):** Validates code against `bpy` standards and PEP8.
4.  **The Test Pilot:** Executes the code in a headless Blender environment.
5.  **The Doc-Gen:** Creates user manuals and API documentation.

## 3. Automation & Hooks
* **Pre-Validation Hook:** Runs `flake8` and `mypy` on every generated file.
* **Blender Runtime Hook:** Executes `blender -b --factory-startup -P test_harness.py` to ensure the add-on registers without errors.

## 4. MCP Server Integration
Leveraging `mcp.json` to provide:
* **Filesystem MCP:** For recursive directory management.
* **Memory MCP:** To maintain context across long-running swarm sessions.
* **Search MCP:** For real-time Blender API documentation lookups.