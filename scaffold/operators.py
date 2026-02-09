import bpy

class AETHER_OT_example(bpy.types.Operator):
    bl_idname = "aether.example"
    bl_label = "Example Operator"
    
    def execute(self, context):
        self.report({'INFO'}, "Aether Scaffold Running")
        return {'FINISHED'}