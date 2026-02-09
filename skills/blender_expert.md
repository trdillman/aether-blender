# Skill: Blender API Mastery (GLM 4.7)

## Purpose
Elevate GLM's understanding of `bpy` (Blender Python API) and UI management.

## Instructions
1.  **Context Injection:** Before writing any operator, always search for the latest `bpy.types.Operator` signature.
2.  **UI Layout:** Always use `layout.prop()` and `layout.operator()` inside the `draw` method.
3.  **Registration Pattern:** Use the standard `classes = (...)`, `register()`, `unregister()` pattern at the bottom of `__init__.py`.
4.  **Error Handling:** Every operator `execute` method MUST be wrapped in a `try-except` block that returns `{'CANCELLED'}` on failure.

## Code Standards
* Use type hints for all function arguments.
* Add `bl_info` dictionary at the top of the main file.
* Ensure all icons use the official Blender internal icon set.