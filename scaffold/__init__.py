bl_info = {
    "name": "Aether Scaffold",
    "author": "GLM 4.7 Swarm",
    "version": (1, 0),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > Aether",
    "description": "Scaffold generated addon",
    "category": "Development",
}

import bpy
from . import operators, panels

classes = (
    operators.AETHER_OT_example,
    panels.AETHER_PT_main_panel,
)

def register():
    for cls in classes:
        bpy.utils.register_class(cls)

def unregister():
    for cls in classes:
        bpy.utils.unregister_class(cls)

if __name__ == "__main__":
    register()