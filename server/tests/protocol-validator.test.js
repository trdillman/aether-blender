const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateProtocolPlan,
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_PYTHON_CODE_LENGTH,
} = require('../lib/protocolValidator');

const buildValidProtocol = () => ({
  version: '1.0',
  steps: [
    {
      id: 'step_1',
      type: 'PYTHON',
      description: 'Run helper script',
      payload: {
        code: "print('ok')",
      },
    },
  ],
  done: true,
  final_message: 'Completed.',
  meta: {
    requires_gate_verification: true,
  },
});

const assertValidationError = (input, expectedCode, expectedPath) => {
  assert.throws(
    () => validateProtocolPlan(input),
    (error) => error && error.code === expectedCode && error.path === expectedPath,
  );
};

test('validateProtocolPlan accepts valid v1 protocol and defaults python mode=safe', () => {
  const protocol = validateProtocolPlan(buildValidProtocol());
  assert.equal(protocol.version, '1.0');
  assert.equal(protocol.steps[0].payload.mode, 'safe');
});

test('validateProtocolPlan rejects unknown envelope fields', () => {
  const protocol = buildValidProtocol();
  protocol.extra = true;
  assertValidationError(protocol, 'PROTOCOL_UNKNOWN_FIELD', 'root');
});

test('validateProtocolPlan rejects non-object envelope with root path', () => {
  assertValidationError([], 'PROTOCOL_ENVELOPE_INVALID', 'root');
});

test('validateProtocolPlan rejects non-array steps with root.steps path', () => {
  const protocol = buildValidProtocol();
  protocol.steps = {};
  assertValidationError(protocol, 'PROTOCOL_STEPS_INVALID', 'root.steps');
});

test('validateProtocolPlan rejects unknown step type', () => {
  const protocol = buildValidProtocol();
  protocol.steps[0].type = 'SHELL';
  assertValidationError(protocol, 'PROTOCOL_STEP_TYPE_INVALID', 'steps[0].type');
});

test('validateProtocolPlan rejects empty step description with indexed path', () => {
  const protocol = buildValidProtocol();
  protocol.steps[0].description = '';
  assertValidationError(protocol, 'PROTOCOL_STEP_INVALID', 'steps[0].description');
});

test('validateProtocolPlan rejects traversal-like step id values', () => {
  const protocol = buildValidProtocol();
  protocol.steps[0].id = '../escape';
  assertValidationError(protocol, 'PROTOCOL_STEP_ID_INVALID', 'steps[0].id');
});

test('validateProtocolPlan rejects unknown NODE_TREE operation', () => {
  const protocol = buildValidProtocol();
  protocol.steps = [
    {
      id: 'step_1',
      type: 'NODE_TREE',
      description: 'Create node',
      payload: {
        target: {
          object_name: 'Cube',
          modifier_name: 'GeometryNodes',
          node_group_name: 'GN_Group',
        },
        operations: [
          {
            op: 'mystery',
          },
        ],
      },
    },
  ];

  assert.throws(
    () => validateProtocolPlan(protocol),
    (error) => error && error.code === 'PROTOCOL_NODE_TREE_OP_INVALID',
  );
});

test('validateProtocolPlan rejects NODE_TREE link endpoint with precise nested path', () => {
  const protocol = buildValidProtocol();
  protocol.steps = [
    {
      id: 'step_1',
      type: 'NODE_TREE',
      description: 'Link nodes',
      payload: {
        target: {
          object_name: 'Cube',
          modifier_name: 'GeometryNodes',
          node_group_name: 'GN_Group',
        },
        operations: [
          {
            op: 'link',
            from: {
              node_id: 'NodeA',
              socket: 'Geometry',
            },
            to: {
              node_id: '',
              socket: 'Geometry',
            },
          },
        ],
      },
    },
  ];

  assertValidationError(
    protocol,
    'PROTOCOL_PAYLOAD_INVALID',
    'steps[].payload.operations[0].to.node_id',
  );
});

test('validateProtocolPlan rejects unknown GN_OPS operation', () => {
  const protocol = buildValidProtocol();
  protocol.steps = [
    {
      id: 'step_1',
      type: 'GN_OPS',
      description: 'Patch graph',
      payload: {
        v: 1,
        target: {
          object_name: 'Cube',
          modifier_name: 'GeometryNodes',
        },
        ops: [{ op: 'boom' }],
      },
    },
  ];

  assert.throws(
    () => validateProtocolPlan(protocol),
    (error) => error && error.code === 'PROTOCOL_GN_OP_INVALID',
  );
});

test('validateProtocolPlan rejects GN_OPS link endpoint with precise nested path', () => {
  const protocol = buildValidProtocol();
  protocol.steps = [
    {
      id: 'step_1',
      type: 'GN_OPS',
      description: 'Patch graph',
      payload: {
        v: 1,
        target: {
          object_name: 'Cube',
          modifier_name: 'GeometryNodes',
        },
        ops: [
          {
            op: 'link',
            from: {
              node_id: 'InputNode',
              socket_name: 'Geometry',
            },
            to: {
              node_id: 'OutputNode',
              socket_name: '',
            },
          },
        ],
      },
    },
  ];

  assertValidationError(
    protocol,
    'PROTOCOL_PAYLOAD_INVALID',
    'steps[].payload.ops[0].to.socket_name',
  );
});

test('validateProtocolPlan enforces max steps=25 by default', () => {
  const protocol = buildValidProtocol();
  protocol.steps = Array.from({ length: DEFAULT_MAX_STEPS + 1 }, (_, index) => ({
    id: `step_${index + 1}`,
    type: 'PYTHON',
    description: `Step ${index + 1}`,
    payload: { code: "print('ok')" },
  }));

  assert.throws(
    () => validateProtocolPlan(protocol),
    (error) => error && error.code === 'PROTOCOL_STEPS_LIMIT_EXCEEDED',
  );
});

test('validateProtocolPlan enforces default python code length limit (20k)', () => {
  const protocol = buildValidProtocol();
  protocol.steps[0].payload.code = 'a'.repeat(DEFAULT_MAX_PYTHON_CODE_LENGTH + 1);
  assertValidationError(protocol, 'PROTOCOL_PYTHON_CODE_LENGTH_EXCEEDED', 'steps[].payload.code');
});
