const { executeOnActive, getActiveSession, stopSession } = require('./blenderSessionManager');
const { assertExecPythonPayloadAllowed } = require('./securityPolicy');

const DEFAULT_EXEC_TIMEOUT_MS = 120000;

const toPythonPayloadLiteral = (value) => JSON.stringify(JSON.stringify(value || {}));

const buildRpcPrelude = (step, serializedPayloadLiteral) => `
import json
import bpy

_STEP_ID = ${JSON.stringify(step.id || 'protocol_step')}
_PAYLOAD = json.loads(${serializedPayloadLiteral})

def _raise(message):
    raise Exception(str(message))

def _ensure_object(name):
    obj = bpy.data.objects.get(str(name or ""))
    if obj is None:
        _raise("Object not found: " + str(name))
    return obj

def _ensure_nodes_modifier(obj, modifier_name, allow_create):
    normalized_name = str(modifier_name or "")
    mod = obj.modifiers.get(normalized_name)
    if mod is None and allow_create:
        mod = obj.modifiers.new(name=normalized_name or "GeometryNodes", type='NODES')
    if mod is None:
        _raise("Modifier not found: " + normalized_name)
    if mod.type != 'NODES':
        _raise("Modifier is not Geometry Nodes: " + normalized_name)
    return mod

def _ensure_geometry_node_tree(modifier, requested_name):
    tree = modifier.node_group
    if tree is None:
        tree_name = str(requested_name or modifier.name or "GeometryNodes")
        tree = bpy.data.node_groups.new(tree_name, 'GeometryNodeTree')
        modifier.node_group = tree
    elif requested_name and tree.name != str(requested_name):
        tree.name = str(requested_name)
    if tree.bl_idname != 'GeometryNodeTree':
        _raise("Node group is not GeometryNodeTree: " + str(tree.name))
    return tree

def _ensure_group_io_nodes(node_tree):
    group_input = None
    group_output = None
    for node in node_tree.nodes:
        if node.bl_idname == 'NodeGroupInput' and group_input is None:
            group_input = node
        if node.bl_idname == 'NodeGroupOutput' and group_output is None:
            group_output = node
    if group_input is None:
        group_input = node_tree.nodes.new(type='NodeGroupInput')
    if group_output is None:
        group_output = node_tree.nodes.new(type='NodeGroupOutput')
    return group_input, group_output

def _index_nodes(node_tree):
    node_index = {}
    for node in node_tree.nodes:
        stored_id = None
        try:
            stored_id = node.get("_aether_node_id")
        except Exception:
            stored_id = None
        if isinstance(stored_id, str) and stored_id:
            node_index[stored_id] = node
        if node.bl_idname == 'NodeGroupInput':
            node_index['group_input'] = node
        if node.bl_idname == 'NodeGroupOutput':
            node_index['group_output'] = node
    return node_index

def _track_node(node_index, node_id, node):
    normalized = str(node_id or "").strip()
    if not normalized:
        _raise("Node id is required")
    node_index[normalized] = node
    try:
        node["_aether_node_id"] = normalized
    except Exception:
        pass
    return normalized

def _require_node(node_index, node_id):
    normalized = str(node_id or "").strip()
    node = node_index.get(normalized)
    if node is None:
        _raise("Node not found: " + normalized)
    return node

def _find_socket(sockets, socket_name):
    target_name = str(socket_name or "").strip()
    for socket in sockets:
        if str(socket.name) == target_name:
            return socket
    _raise("Socket not found: " + target_name)

def _assign_socket_default(socket, value):
    if not hasattr(socket, "default_value"):
        _raise("Socket has no default_value: " + str(socket.name))
    try:
        socket.default_value = value
    except Exception:
        if isinstance(value, list):
            socket.default_value = tuple(value)
            return
        raise

def _link_once(node_tree, from_socket, to_socket):
    for link in node_tree.links:
        if link.from_socket == from_socket and link.to_socket == to_socket:
            return
    node_tree.links.new(from_socket, to_socket)

def _remove_link(node_tree, from_socket, to_socket):
    for link in list(node_tree.links):
        if link.from_socket == from_socket and link.to_socket == to_socket:
            node_tree.links.remove(link)

def _set_group_interface_socket(node_tree, action, socket_name, socket_type):
    if not hasattr(node_tree, "interface") or node_tree.interface is None:
        _raise("Node group interface is unavailable")
    interface = node_tree.interface
    normalized_action = str(action or "").strip().lower()
    normalized_name = str(socket_name or "").strip()
    normalized_type = str(socket_type or "").strip()

    if normalized_action in ("add_input", "add_output"):
        in_out = "INPUT" if normalized_action == "add_input" else "OUTPUT"
        interface.new_socket(name=normalized_name, in_out=in_out, socket_type=normalized_type)
        return

    if normalized_action in ("remove_input", "remove_output"):
        in_out = "INPUT" if normalized_action == "remove_input" else "OUTPUT"
        item_to_remove = None
        for item in interface.items_tree:
            item_type = ""
            item_dir = ""
            try:
                item_type = str(item.item_type)
            except Exception:
                item_type = ""
            try:
                item_dir = str(item.in_out)
            except Exception:
                item_dir = ""
            if item_type == "SOCKET" and str(item.name) == normalized_name and item_dir == in_out:
                item_to_remove = item
                break
        if item_to_remove is not None:
            interface.remove(item_to_remove)
        return

    _raise("Unsupported set_group_io action: " + str(action))
`;

const buildNodeTreeScript = (step) => {
  const serializedPayloadLiteral = toPythonPayloadLiteral(step.payload || {});
  const script = `
${buildRpcPrelude(step, serializedPayloadLiteral)}

target = _PAYLOAD.get("target") or {}
operations = _PAYLOAD.get("operations") or []

obj = _ensure_object(target.get("object_name"))
modifier = _ensure_nodes_modifier(obj, target.get("modifier_name"), True)
node_tree = _ensure_geometry_node_tree(modifier, target.get("node_group_name"))
_ensure_group_io_nodes(node_tree)
node_index = _index_nodes(node_tree)

for operation in operations:
    op = str(operation.get("op") or "").strip()
    if op == "create_node":
        node_id = str(operation.get("node_id") or "").strip()
        if not node_id:
            _raise("NODE_TREE create_node missing node_id")
        if node_id in node_index:
            _raise("NODE_TREE create_node node already exists: " + node_id)
        node = node_tree.nodes.new(type=str(operation.get("bl_idname") or ""))
        location = operation.get("location") or [0, 0]
        if isinstance(location, list) and len(location) >= 2:
            node.location = (float(location[0]), float(location[1]))
        _track_node(node_index, node_id, node)
    elif op == "delete_node":
        node = _require_node(node_index, operation.get("node_id"))
        for key, candidate in list(node_index.items()):
            if candidate == node:
                del node_index[key]
        node_tree.nodes.remove(node)
    elif op == "set_input_default":
        node = _require_node(node_index, operation.get("node_id"))
        socket = _find_socket(node.inputs, operation.get("socket"))
        _assign_socket_default(socket, operation.get("value"))
    elif op == "set_property":
        node = _require_node(node_index, operation.get("node_id"))
        property_name = str(operation.get("property") or "").strip()
        if not property_name:
            _raise("NODE_TREE set_property missing property")
        node.__setattr__(property_name, operation.get("value"))
    elif op == "link":
        from_spec = operation.get("from") or {}
        to_spec = operation.get("to") or {}
        from_node = _require_node(node_index, from_spec.get("node_id"))
        to_node = _require_node(node_index, to_spec.get("node_id"))
        from_socket = _find_socket(from_node.outputs, from_spec.get("socket"))
        to_socket = _find_socket(to_node.inputs, to_spec.get("socket"))
        _link_once(node_tree, from_socket, to_socket)
    elif op == "unlink":
        from_spec = operation.get("from") or {}
        to_spec = operation.get("to") or {}
        from_node = _require_node(node_index, from_spec.get("node_id"))
        to_node = _require_node(node_index, to_spec.get("node_id"))
        from_socket = _find_socket(from_node.outputs, from_spec.get("socket"))
        to_socket = _find_socket(to_node.inputs, to_spec.get("socket"))
        _remove_link(node_tree, from_socket, to_socket)
    elif op == "set_group_io":
        _set_group_interface_socket(
            node_tree,
            operation.get("action"),
            operation.get("socket"),
            operation.get("socket_type"),
        )
    else:
        _raise("Unsupported NODE_TREE op: " + op)
`;
  return script.trim();
};

const buildGnOpsScript = (step) => {
  const serializedPayloadLiteral = toPythonPayloadLiteral(step.payload || {});
  const script = `
${buildRpcPrelude(step, serializedPayloadLiteral)}

target = _PAYLOAD.get("target") or {}
ops = _PAYLOAD.get("ops") or []

allow_create_modifier = False
for operation in ops:
    if str(operation.get("op") or "").strip() == "ensure_target" and bool(operation.get("allow_create_modifier")):
        allow_create_modifier = True

obj = _ensure_object(target.get("object_name"))
modifier = _ensure_nodes_modifier(obj, target.get("modifier_name"), allow_create_modifier)
node_tree = _ensure_geometry_node_tree(modifier, None)
_ensure_group_io_nodes(node_tree)
node_index = _index_nodes(node_tree)

for operation in ops:
    op = str(operation.get("op") or "").strip()
    if op == "ensure_target":
        continue
    if op == "ensure_single_group_io":
        first_input = None
        first_output = None
        for node in list(node_tree.nodes):
            if node.bl_idname == "NodeGroupInput":
                if first_input is None:
                    first_input = node
                else:
                    node_tree.nodes.remove(node)
            elif node.bl_idname == "NodeGroupOutput":
                if first_output is None:
                    first_output = node
                else:
                    node_tree.nodes.remove(node)
        _ensure_group_io_nodes(node_tree)
        node_index = _index_nodes(node_tree)
        continue
    if op == "add_node":
        node_id = str(operation.get("id") or "").strip()
        if not node_id:
            _raise("GN_OPS add_node missing id")
        if node_id in node_index:
            _raise("GN_OPS add_node node already exists: " + node_id)
        node = node_tree.nodes.new(type=str(operation.get("bl_idname") or ""))
        node.location = (float(operation.get("x") or 0), float(operation.get("y") or 0))
        _track_node(node_index, node_id, node)
        continue
    if op == "remove_node":
        node_id = str(operation.get("id") or "").strip()
        if node_id and node_id in node_index:
            node = node_index[node_id]
            for key, candidate in list(node_index.items()):
                if candidate == node:
                    del node_index[key]
            node_tree.nodes.remove(node)
        continue
    if op == "link":
        from_spec = operation.get("from") or {}
        to_spec = operation.get("to") or {}
        from_node = _require_node(node_index, from_spec.get("node_id"))
        to_node = _require_node(node_index, to_spec.get("node_id"))
        from_socket = _find_socket(from_node.outputs, from_spec.get("socket_name"))
        to_socket = _find_socket(to_node.inputs, to_spec.get("socket_name"))
        _link_once(node_tree, from_socket, to_socket)
        continue
    if op == "unlink":
        from_spec = operation.get("from") or {}
        to_spec = operation.get("to") or {}
        from_node = _require_node(node_index, from_spec.get("node_id"))
        to_node = _require_node(node_index, to_spec.get("node_id"))
        from_socket = _find_socket(from_node.outputs, from_spec.get("socket_name"))
        to_socket = _find_socket(to_node.inputs, to_spec.get("socket_name"))
        _remove_link(node_tree, from_socket, to_socket)
        continue
    if op == "set_input":
        node = _require_node(node_index, operation.get("node_id"))
        socket = _find_socket(node.inputs, operation.get("socket_name"))
        _assign_socket_default(socket, operation.get("value"))
        continue
    if op == "cleanup_unused":
        linked_nodes = set()
        for link in node_tree.links:
            linked_nodes.add(link.from_node.name)
            linked_nodes.add(link.to_node.name)
        for key, node in list(node_index.items()):
            if key in ("group_input", "group_output"):
                continue
            if node.name not in linked_nodes:
                node_tree.nodes.remove(node)
                del node_index[key]
        continue
    _raise("Unsupported GN_OPS op: " + op)
`;
  return script.trim();
};

const executePython = async ({
  code,
  mode = 'safe',
  timeoutMs,
  settings,
  stepId,
  logEvent,
  registerCancelHandler,
}) => {
  const session = getActiveSession();
  if (!session) {
    if (typeof logEvent === 'function') {
      await logEvent('protocol_rpc_skipped', {
        stepId,
        reason: 'no active Blender session',
      });
    }
    return null;
  }

  const payload = assertExecPythonPayloadAllowed(
    { code, mode },
    { allowTrustedPythonExecution: Boolean(settings && settings.allowTrustedPythonExecution) },
  );

  let unregisterCancel = null;
  if (typeof registerCancelHandler === 'function') {
    unregisterCancel = registerCancelHandler(async () => {
      try {
        if (typeof logEvent === 'function') {
          await logEvent('protocol_rpc_cancel_escalated', {
            stepId,
            sessionId: session.id,
          });
        }
        await stopSession(session.id);
      } catch (error) {
        if (typeof logEvent === 'function') {
          await logEvent('protocol_rpc_cancel_error', {
            stepId,
            sessionId: session.id,
            error: String(error && error.message ? error.message : error),
          });
        }
      }
    });
  }

  try {
    const result = await executeOnActive(
      'exec_python',
      payload,
      Number.isInteger(timeoutMs) ? timeoutMs : DEFAULT_EXEC_TIMEOUT_MS,
    );
    if (typeof logEvent === 'function') {
      await logEvent('protocol_rpc_result', { stepId, result });
    }
    return result;
  } catch (error) {
    if (typeof logEvent === 'function') {
      await logEvent('protocol_rpc_error', {
        stepId,
        error: String(error && error.message ? error.message : error),
      });
    }
    throw error;
  } finally {
    if (typeof unregisterCancel === 'function') {
      unregisterCancel();
    }
  }
};

const runNodeTreeStep = async ({ step, settings, logEvent, registerCancelHandler }) => {
  const code = buildNodeTreeScript(step);
  await executePython({
    code,
    mode: 'safe',
    settings,
    stepId: step.id,
    logEvent,
    registerCancelHandler,
    timeoutMs: Number.isFinite(step.payload && step.payload.timeout_ms)
      ? step.payload.timeout_ms
      : undefined,
  });
};

const runGnOpsStep = async ({ step, settings, logEvent, registerCancelHandler }) => {
  const code = buildGnOpsScript(step);
  await executePython({
    code,
    mode: 'safe',
    settings,
    stepId: step.id,
    logEvent,
    registerCancelHandler,
    timeoutMs: Number.isFinite(step.payload && step.payload.timeout_ms)
      ? step.payload.timeout_ms
      : undefined,
  });
};

const runUserPythonStep = async ({ step, settings, logEvent, registerCancelHandler }) => {
  const payload = step.payload || {};
  const code = String(payload.code || '').trim();
  if (!code) {
    throw new Error(`PYTHON step ${step.id || 'unknown'} must include code`);
  }
  await executePython({
    code,
    mode: String(payload.mode || 'safe').trim().toLowerCase(),
    timeoutMs: Number.isFinite(payload.timeout_ms) ? payload.timeout_ms : undefined,
    settings,
    stepId: step.id,
    logEvent,
    registerCancelHandler,
  });
};

module.exports = {
  runNodeTreeStep,
  runGnOpsStep,
  runUserPythonStep,
};
