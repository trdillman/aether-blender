import bpy

class AETHER_PT_main_panel(bpy.types.Panel):
    bl_label = "Aether Swarm"
    bl_idname = "AETHER_PT_main_panel"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Aether'

    def draw(self, context):
        layout = self.layout
        layout.operator("aether.example", icon='PLAY')