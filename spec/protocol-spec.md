# GeoNode AI Assistant - Protocol Spec (v1)

## 1. Contract
Model must return strict JSON only.

Top-level object:
```json
{
  "version": "1.0",
  "steps": [],
  "done": true,
  "final_message": "string",
  "meta": {
    "requires_gate_verification": true
  }
}
```

## 2. Step Schema
Each step:
```json
{
  "id": "step_1",
  "type": "NODE_TREE | GN_OPS | PYTHON",
  "description": "string",
  "payload": {}
}
```

## 3. NODE_TREE Payload
```json
{
  "target": {
    "object_name": "Cube",
    "modifier_name": "GeometryNodes",
    "node_group_name": "GN_Assistant_Group"
  },
  "operations": [
    {
      "op": "create_node",
      "node_id": "n1",
      "bl_idname": "GeometryNodeSubdivisionSurface",
      "location": [100, 200]
    },
    {
      "op": "set_input_default",
      "node_id": "n1",
      "socket": "Level",
      "value": 2
    },
    {
      "op": "link",
      "from": {"node_id": "n1", "socket": "Mesh"},
      "to": {"node_id": "group_output", "socket": "Geometry"}
    }
  ]
}
```

Supported `op` values (v1):
- `create_node`
- `delete_node`
- `set_input_default`
- `set_property`
- `link`
- `unlink`
- `set_group_io`

## 4. GN_OPS Payload (Deterministic Patch)
```json
{
  "v": 1,
  "target": {
    "object_name": "Cube",
    "modifier_name": "GeometryNodes"
  },
  "ops": [
    { "op": "ensure_target", "allow_create_modifier": true },
    { "op": "ensure_single_group_io" },
    {
      "op": "add_node",
      "id": "noise_1",
      "bl_idname": "ShaderNodeTexNoise",
      "x": 120,
      "y": 40
    },
    {
      "op": "set_input",
      "node_id": "noise_1",
      "socket_name": "Scale",
      "value": 5.0
    }
  ]
}
```

Supported GN ops (v1):
- `ensure_target`
- `ensure_single_group_io`
- `add_node`
- `remove_node`
- `link`
- `unlink`
- `set_input`
- `cleanup_unused`

## 5. PYTHON Payload
```json
{
  "mode": "safe | trusted",
  "code": "import bpy\\nprint('hello')",
  "timeout_ms": 4000
}
```

Rules:
- `safe` is default if omitted.
- `trusted` requires explicit user confirmation in UI.

## 6. Multi-Step Semantics
- Steps execute in order.
- On failure:
  - stop execution
  - return error summary with failing `step.id`
- `done` must be `true` when no further actions are needed.

## 7. Validation Rules
- Unknown fields rejected (strict mode).
- Unknown step types rejected.
- Missing `final_message` rejected.
- `done=true` is not accepted unless required verification gates pass.
- Maximum limits:
  - steps: 25
  - python code length: configurable (default 20k chars)

## 8. Verification Gate Envelope (Runtime Feedback)
Runtime verifier should produce:
```json
{
  "success": false,
  "failed_gates": ["OUTPUT_CONNECTED"],
  "messages": ["Group Output geometry socket is not connected"]
}
```

This envelope is fed back into the next model iteration before accepting `done`.

## 9. Example Response
```json
{
  "version": "1.0",
  "steps": [
    {
      "id": "step_1",
      "type": "NODE_TREE",
      "description": "Create a simple scatter setup",
      "payload": {
        "target": {
          "object_name": "Plane",
          "modifier_name": "GeometryNodes",
          "node_group_name": "GN_Scatter"
        },
        "operations": []
      }
    },
    {
      "id": "step_2",
      "type": "GN_OPS",
      "description": "Apply deterministic graph cleanup and final link checks",
      "payload": {
        "v": 1,
        "target": {
          "object_name": "Plane",
          "modifier_name": "GeometryNodes"
        },
        "ops": [
          { "op": "cleanup_unused" }
        ]
      }
    },
    {
      "id": "step_3",
      "type": "PYTHON",
      "description": "Frame viewport on target object",
      "payload": {
        "mode": "safe",
        "timeout_ms": 3000,
        "code": "import bpy\\nobj=bpy.data.objects.get('Plane')\\nprint(obj.name if obj else 'missing')"
      }
    }
  ],
  "done": true,
  "final_message": "Created scatter graph scaffold, normalized links, and ran scene helper script.",
  "meta": {
    "requires_gate_verification": true
  }
}
```
