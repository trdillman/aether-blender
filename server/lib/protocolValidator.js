const DEFAULT_MAX_STEPS = 25;
const DEFAULT_MAX_PYTHON_CODE_LENGTH = 20000;
const STEP_ID_SAFE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const STEP_TYPES = new Set(['NODE_TREE', 'GN_OPS', 'PYTHON']);
const NODE_TREE_OPS = new Set([
  'create_node',
  'delete_node',
  'set_input_default',
  'set_property',
  'link',
  'unlink',
  'set_group_io',
]);
const GN_OPS = new Set([
  'ensure_target',
  'ensure_single_group_io',
  'add_node',
  'remove_node',
  'link',
  'unlink',
  'set_input',
  'cleanup_unused',
]);

const createValidationError = (code, message, path) => {
  const error = new Error(message);
  error.code = code;
  if (path) {
    error.path = path;
  }
  return error;
};

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const assertObject = (value, code, message, path) => {
  if (!isObject(value)) {
    throw createValidationError(code, message, path);
  }
};

const rejectUnknownFields = (value, allowed, path) => {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw createValidationError(
      'PROTOCOL_UNKNOWN_FIELD',
      `Unknown field "${unknown[0]}" at ${path}`,
      path,
    );
  }
};

const assertString = (value, code, message, path) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw createValidationError(code, message, path);
  }
};

const validateNodeEndpoint = (endpoint, path) => {
  assertObject(
    endpoint,
    'PROTOCOL_PAYLOAD_INVALID',
    `Expected object at ${path}`,
    path,
  );
  rejectUnknownFields(endpoint, new Set(['node_id', 'socket']), path);
  assertString(
    endpoint.node_id,
    'PROTOCOL_PAYLOAD_INVALID',
    `Missing or invalid node_id at ${path}.node_id`,
    `${path}.node_id`,
  );
  assertString(
    endpoint.socket,
    'PROTOCOL_PAYLOAD_INVALID',
    `Missing or invalid socket at ${path}.socket`,
    `${path}.socket`,
  );
};

const validateNodeTreeOperation = (operation, index) => {
  const path = `steps[].payload.operations[${index}]`;
  assertObject(
    operation,
    'PROTOCOL_PAYLOAD_INVALID',
    `Expected object at ${path}`,
    path,
  );
  assertString(
    operation.op,
    'PROTOCOL_NODE_TREE_OP_INVALID',
    `Missing op at ${path}.op`,
    `${path}.op`,
  );
  if (!NODE_TREE_OPS.has(operation.op)) {
    throw createValidationError(
      'PROTOCOL_NODE_TREE_OP_INVALID',
      `Unsupported NODE_TREE op "${operation.op}"`,
      `${path}.op`,
    );
  }

  if (operation.op === 'create_node') {
    rejectUnknownFields(operation, new Set(['op', 'node_id', 'bl_idname', 'location']), path);
    assertString(
      operation.node_id,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing node_id at ${path}.node_id`,
      `${path}.node_id`,
    );
    assertString(
      operation.bl_idname,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing bl_idname at ${path}.bl_idname`,
      `${path}.bl_idname`,
    );
    if (
      !Array.isArray(operation.location) ||
      operation.location.length !== 2 ||
      !operation.location.every((value) => typeof value === 'number')
    ) {
      throw createValidationError(
        'PROTOCOL_PAYLOAD_INVALID',
        `location must be [x, y] numbers at ${path}.location`,
        `${path}.location`,
      );
    }
    return;
  }

  if (operation.op === 'delete_node') {
    rejectUnknownFields(operation, new Set(['op', 'node_id']), path);
    assertString(
      operation.node_id,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing node_id at ${path}.node_id`,
      `${path}.node_id`,
    );
    return;
  }

  if (operation.op === 'set_input_default') {
    rejectUnknownFields(operation, new Set(['op', 'node_id', 'socket', 'value']), path);
    assertString(
      operation.node_id,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing node_id at ${path}.node_id`,
      `${path}.node_id`,
    );
    assertString(
      operation.socket,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing socket at ${path}.socket`,
      `${path}.socket`,
    );
    return;
  }

  if (operation.op === 'set_property') {
    rejectUnknownFields(operation, new Set(['op', 'node_id', 'property', 'value']), path);
    assertString(
      operation.node_id,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing node_id at ${path}.node_id`,
      `${path}.node_id`,
    );
    assertString(
      operation.property,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing property at ${path}.property`,
      `${path}.property`,
    );
    return;
  }

  if (operation.op === 'link' || operation.op === 'unlink') {
    rejectUnknownFields(operation, new Set(['op', 'from', 'to']), path);
    validateNodeEndpoint(operation.from, `${path}.from`);
    validateNodeEndpoint(operation.to, `${path}.to`);
    return;
  }

  if (operation.op === 'set_group_io') {
    rejectUnknownFields(operation, new Set(['op', 'action', 'socket', 'socket_type']), path);
    assertString(
      operation.action,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing action at ${path}.action`,
      `${path}.action`,
    );
    assertString(
      operation.socket,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing socket at ${path}.socket`,
      `${path}.socket`,
    );
    assertString(
      operation.socket_type,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing socket_type at ${path}.socket_type`,
      `${path}.socket_type`,
    );
  }
};

const validateNodeTreePayload = (payload) => {
  assertObject(
    payload,
    'PROTOCOL_PAYLOAD_INVALID',
    'NODE_TREE payload must be an object',
    'steps[].payload',
  );
  rejectUnknownFields(payload, new Set(['target', 'operations']), 'steps[].payload');

  assertObject(
    payload.target,
    'PROTOCOL_PAYLOAD_INVALID',
    'NODE_TREE target must be an object',
    'steps[].payload.target',
  );
  rejectUnknownFields(
    payload.target,
    new Set(['object_name', 'modifier_name', 'node_group_name']),
    'steps[].payload.target',
  );
  assertString(
    payload.target.object_name,
    'PROTOCOL_PAYLOAD_INVALID',
    'NODE_TREE target.object_name is required',
    'steps[].payload.target.object_name',
  );
  assertString(
    payload.target.modifier_name,
    'PROTOCOL_PAYLOAD_INVALID',
    'NODE_TREE target.modifier_name is required',
    'steps[].payload.target.modifier_name',
  );
  assertString(
    payload.target.node_group_name,
    'PROTOCOL_PAYLOAD_INVALID',
    'NODE_TREE target.node_group_name is required',
    'steps[].payload.target.node_group_name',
  );

  if (!Array.isArray(payload.operations)) {
    throw createValidationError(
      'PROTOCOL_PAYLOAD_INVALID',
      'NODE_TREE payload.operations must be an array',
      'steps[].payload.operations',
    );
  }

  payload.operations.forEach((operation, index) => validateNodeTreeOperation(operation, index));
};

const validateGnEndpoint = (endpoint, path) => {
  assertObject(endpoint, 'PROTOCOL_PAYLOAD_INVALID', `Expected object at ${path}`, path);
  rejectUnknownFields(endpoint, new Set(['node_id', 'socket_name']), path);
  assertString(
    endpoint.node_id,
    'PROTOCOL_PAYLOAD_INVALID',
    `Missing node_id at ${path}.node_id`,
    `${path}.node_id`,
  );
  assertString(
    endpoint.socket_name,
    'PROTOCOL_PAYLOAD_INVALID',
    `Missing socket_name at ${path}.socket_name`,
    `${path}.socket_name`,
  );
};

const validateGnOperation = (operation, index) => {
  const path = `steps[].payload.ops[${index}]`;
  assertObject(operation, 'PROTOCOL_PAYLOAD_INVALID', `Expected object at ${path}`, path);
  assertString(
    operation.op,
    'PROTOCOL_GN_OP_INVALID',
    `Missing op at ${path}.op`,
    `${path}.op`,
  );
  if (!GN_OPS.has(operation.op)) {
    throw createValidationError(
      'PROTOCOL_GN_OP_INVALID',
      `Unsupported GN_OPS op "${operation.op}"`,
      `${path}.op`,
    );
  }

  if (operation.op === 'ensure_target') {
    rejectUnknownFields(operation, new Set(['op', 'allow_create_modifier']), path);
    if (
      operation.allow_create_modifier !== undefined &&
      typeof operation.allow_create_modifier !== 'boolean'
    ) {
      throw createValidationError(
        'PROTOCOL_PAYLOAD_INVALID',
        `allow_create_modifier must be boolean at ${path}.allow_create_modifier`,
        `${path}.allow_create_modifier`,
      );
    }
    return;
  }

  if (operation.op === 'ensure_single_group_io' || operation.op === 'cleanup_unused') {
    rejectUnknownFields(operation, new Set(['op']), path);
    return;
  }

  if (operation.op === 'add_node') {
    rejectUnknownFields(operation, new Set(['op', 'id', 'bl_idname', 'x', 'y']), path);
    assertString(
      operation.id,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing id at ${path}.id`,
      `${path}.id`,
    );
    assertString(
      operation.bl_idname,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing bl_idname at ${path}.bl_idname`,
      `${path}.bl_idname`,
    );
    if (typeof operation.x !== 'number' || typeof operation.y !== 'number') {
      throw createValidationError(
        'PROTOCOL_PAYLOAD_INVALID',
        `x and y must be numbers at ${path}`,
        path,
      );
    }
    return;
  }

  if (operation.op === 'remove_node') {
    rejectUnknownFields(operation, new Set(['op', 'id']), path);
    assertString(
      operation.id,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing id at ${path}.id`,
      `${path}.id`,
    );
    return;
  }

  if (operation.op === 'set_input') {
    rejectUnknownFields(operation, new Set(['op', 'node_id', 'socket_name', 'value']), path);
    assertString(
      operation.node_id,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing node_id at ${path}.node_id`,
      `${path}.node_id`,
    );
    assertString(
      operation.socket_name,
      'PROTOCOL_PAYLOAD_INVALID',
      `Missing socket_name at ${path}.socket_name`,
      `${path}.socket_name`,
    );
    return;
  }

  if (operation.op === 'link' || operation.op === 'unlink') {
    rejectUnknownFields(operation, new Set(['op', 'from', 'to']), path);
    validateGnEndpoint(operation.from, `${path}.from`);
    validateGnEndpoint(operation.to, `${path}.to`);
  }
};

const validateGnOpsPayload = (payload) => {
  assertObject(payload, 'PROTOCOL_PAYLOAD_INVALID', 'GN_OPS payload must be an object', 'steps[].payload');
  rejectUnknownFields(payload, new Set(['v', 'target', 'ops']), 'steps[].payload');

  if (payload.v !== 1) {
    throw createValidationError(
      'PROTOCOL_PAYLOAD_INVALID',
      'GN_OPS payload.v must be 1',
      'steps[].payload.v',
    );
  }

  assertObject(
    payload.target,
    'PROTOCOL_PAYLOAD_INVALID',
    'GN_OPS target must be an object',
    'steps[].payload.target',
  );
  rejectUnknownFields(payload.target, new Set(['object_name', 'modifier_name']), 'steps[].payload.target');
  assertString(
    payload.target.object_name,
    'PROTOCOL_PAYLOAD_INVALID',
    'GN_OPS target.object_name is required',
    'steps[].payload.target.object_name',
  );
  assertString(
    payload.target.modifier_name,
    'PROTOCOL_PAYLOAD_INVALID',
    'GN_OPS target.modifier_name is required',
    'steps[].payload.target.modifier_name',
  );

  if (!Array.isArray(payload.ops)) {
    throw createValidationError(
      'PROTOCOL_PAYLOAD_INVALID',
      'GN_OPS payload.ops must be an array',
      'steps[].payload.ops',
    );
  }
  payload.ops.forEach((operation, index) => validateGnOperation(operation, index));
};

const validatePythonPayload = (payload, maxPythonCodeLength) => {
  assertObject(payload, 'PROTOCOL_PAYLOAD_INVALID', 'PYTHON payload must be an object', 'steps[].payload');
  rejectUnknownFields(payload, new Set(['mode', 'code', 'timeout_ms']), 'steps[].payload');

  const mode = payload.mode === undefined ? 'safe' : payload.mode;
  if (mode !== 'safe' && mode !== 'trusted') {
    throw createValidationError(
      'PROTOCOL_PYTHON_MODE_INVALID',
      'PYTHON payload.mode must be "safe" or "trusted"',
      'steps[].payload.mode',
    );
  }
  assertString(
    payload.code,
    'PROTOCOL_PAYLOAD_INVALID',
    'PYTHON payload.code is required',
    'steps[].payload.code',
  );
  if (payload.code.length > maxPythonCodeLength) {
    throw createValidationError(
      'PROTOCOL_PYTHON_CODE_LENGTH_EXCEEDED',
      `PYTHON payload.code exceeds max length of ${maxPythonCodeLength}`,
      'steps[].payload.code',
    );
  }
  if (payload.timeout_ms !== undefined && !Number.isInteger(payload.timeout_ms)) {
    throw createValidationError(
      'PROTOCOL_PAYLOAD_INVALID',
      'PYTHON payload.timeout_ms must be an integer',
      'steps[].payload.timeout_ms',
    );
  }

  return {
    ...payload,
    mode,
  };
};

const validateStep = (step, maxPythonCodeLength, index) => {
  const path = `steps[${index}]`;
  assertObject(step, 'PROTOCOL_STEP_INVALID', `Step at ${path} must be an object`, path);
  rejectUnknownFields(step, new Set(['id', 'type', 'description', 'payload']), path);

  assertString(step.id, 'PROTOCOL_STEP_INVALID', `Step id is required at ${path}.id`, `${path}.id`);
  if (!STEP_ID_SAFE_PATTERN.test(step.id) || step.id.includes('..')) {
    throw createValidationError(
      'PROTOCOL_STEP_ID_INVALID',
      `Step id contains unsupported characters at ${path}.id`,
      `${path}.id`,
    );
  }
  assertString(
    step.description,
    'PROTOCOL_STEP_INVALID',
    `Step description is required at ${path}.description`,
    `${path}.description`,
  );
  assertString(step.type, 'PROTOCOL_STEP_TYPE_INVALID', `Step type is required at ${path}.type`, `${path}.type`);
  if (!STEP_TYPES.has(step.type)) {
    throw createValidationError(
      'PROTOCOL_STEP_TYPE_INVALID',
      `Unsupported step type "${step.type}"`,
      `${path}.type`,
    );
  }
  assertObject(
    step.payload,
    'PROTOCOL_PAYLOAD_INVALID',
    `Step payload is required at ${path}.payload`,
    `${path}.payload`,
  );

  if (step.type === 'NODE_TREE') {
    validateNodeTreePayload(step.payload);
    return step;
  }
  if (step.type === 'GN_OPS') {
    validateGnOpsPayload(step.payload);
    return step;
  }

  return {
    ...step,
    payload: validatePythonPayload(step.payload, maxPythonCodeLength),
  };
};

const parseInput = (value) => {
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw) {
    throw createValidationError('PROTOCOL_JSON_PARSE_ERROR', 'Protocol response is empty');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw createValidationError(
      'PROTOCOL_JSON_PARSE_ERROR',
      'Protocol response is not valid JSON',
    );
  }
};

const validateProtocolPlan = (input, options = {}) => {
  const maxSteps = Number.isInteger(options.maxSteps) && options.maxSteps > 0
    ? options.maxSteps
    : DEFAULT_MAX_STEPS;
  const maxPythonCodeLength =
    Number.isInteger(options.maxPythonCodeLength) && options.maxPythonCodeLength > 0
      ? options.maxPythonCodeLength
      : DEFAULT_MAX_PYTHON_CODE_LENGTH;

  const parsed = parseInput(input);
  assertObject(
    parsed,
    'PROTOCOL_ENVELOPE_INVALID',
    'Protocol envelope must be an object',
    'root',
  );
  rejectUnknownFields(parsed, new Set(['version', 'steps', 'done', 'final_message', 'meta']), 'root');

  if (parsed.version !== '1.0') {
    throw createValidationError(
      'PROTOCOL_VERSION_INVALID',
      'Protocol version must be "1.0"',
      'root.version',
    );
  }
  if (!Array.isArray(parsed.steps)) {
    throw createValidationError('PROTOCOL_STEPS_INVALID', 'Protocol steps must be an array', 'root.steps');
  }
  if (parsed.steps.length > maxSteps) {
    throw createValidationError(
      'PROTOCOL_STEPS_LIMIT_EXCEEDED',
      `Protocol steps exceed max of ${maxSteps}`,
      'root.steps',
    );
  }
  if (typeof parsed.done !== 'boolean') {
    throw createValidationError(
      'PROTOCOL_DONE_INVALID',
      'Protocol done must be a boolean',
      'root.done',
    );
  }
  assertString(
    parsed.final_message,
    'PROTOCOL_FINAL_MESSAGE_INVALID',
    'Protocol final_message is required',
    'root.final_message',
  );

  assertObject(parsed.meta, 'PROTOCOL_META_INVALID', 'Protocol meta must be an object', 'root.meta');
  rejectUnknownFields(parsed.meta, new Set(['requires_gate_verification']), 'root.meta');
  if (typeof parsed.meta.requires_gate_verification !== 'boolean') {
    throw createValidationError(
      'PROTOCOL_META_INVALID',
      'meta.requires_gate_verification must be a boolean',
      'root.meta.requires_gate_verification',
    );
  }

  const steps = parsed.steps.map((step, index) => validateStep(step, maxPythonCodeLength, index));
  return {
    ...parsed,
    steps,
  };
};

module.exports = {
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_PYTHON_CODE_LENGTH,
  validateProtocolPlan,
};
