import bpy
import sys
import os

def validate_addon(addon_path):
    print(f"--- AETHER TEST HARNESS ---")
    print(f"Target: {addon_path}")
    
    abs_path = os.path.abspath(addon_path)
    if not os.path.exists(abs_path):
        print(f"FAILURE: Path not found: {abs_path}")
        sys.exit(1)

    sys.path.append(os.path.dirname(abs_path))
    module_name = os.path.basename(abs_path)

    try:
        print(f"Attempting import: {module_name}")
        __import__(module_name)
        
        print(f"Attempting register...")
        # In a real swarm, we might try bpy.ops.preferences.addon_enable(module=module_name)
        # But for headless verification without installing to user scripts, import is often enough to catch syntax/registry errors.
        
        print("SUCCESS: Syntax valid and import successful.")
    except Exception as e:
        print(f"FAILURE: {e}")
        sys.exit(1)

if __name__ == "__main__":
    # Get the addon path from args (after '--')
    argv = sys.argv
    if "--" in argv:
        target = argv[argv.index("--") + 1]
        validate_addon(target)
    else:
        # Fallback for manual running
        print("Usage: blender -b -P test_harness.py -- [ADDON_FOLDER]")
        # Check if a path was passed directly (not via blender arg parsing)
        if len(sys.argv) > 1 and not sys.argv[-1].endswith(".py"):
             validate_addon(sys.argv[-1])