const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertRpcCommandAllowed,
  assertExecPythonPayloadAllowed,
  isAuthorizedRequest,
} = require('../lib/securityPolicy');

test('assertRpcCommandAllowed allows read-only RPC commands', () => {
  assert.equal(assertRpcCommandAllowed('ping'), 'ping');
  assert.equal(assertRpcCommandAllowed(' get_context '), 'get_context');
  assert.equal(assertRpcCommandAllowed('validate_addon'), 'validate_addon');
});

test('assertRpcCommandAllowed blocks unsupported commands', () => {
  assert.throws(
    () => assertRpcCommandAllowed('delete_everything'),
    (error) => error && error.code === 'RPC_COMMAND_UNSUPPORTED',
  );
});

test('assertRpcCommandAllowed allows exec_python command verb', () => {
  assert.equal(assertRpcCommandAllowed('exec_python'), 'exec_python');
});

test('assertExecPythonPayloadAllowed defaults to safe mode', () => {
  const normalized = assertExecPythonPayloadAllowed({}, { allowTrustedPythonExecution: false });
  assert.equal(normalized.mode, 'safe');
});

test('assertExecPythonPayloadAllowed blocks invalid mode values', () => {
  assert.throws(
    () => assertExecPythonPayloadAllowed({ mode: 'danger' }),
    (error) => error && error.code === 'RPC_EXEC_PYTHON_INVALID_MODE',
  );
});

test('assertExecPythonPayloadAllowed blocks trusted mode when setting is disabled', () => {
  assert.throws(
    () => assertExecPythonPayloadAllowed({ mode: 'trusted' }, { allowTrustedPythonExecution: false }),
    (error) => error && error.code === 'RPC_EXEC_PYTHON_TRUSTED_DISABLED',
  );
});

test('assertExecPythonPayloadAllowed allows trusted mode only when enabled', () => {
  const normalized = assertExecPythonPayloadAllowed(
    { code: 'print(1)', mode: 'trusted' },
    { allowTrustedPythonExecution: true },
  );
  assert.equal(normalized.mode, 'trusted');
});

test('isAuthorizedRequest permits all when expected key is empty', () => {
  assert.equal(isAuthorizedRequest({}, ''), true);
  assert.equal(isAuthorizedRequest({}, null), true);
});

test('isAuthorizedRequest accepts x-aether-api-key header', () => {
  assert.equal(
    isAuthorizedRequest({ 'x-aether-api-key': 'secret-key' }, 'secret-key'),
    true,
  );
  assert.equal(
    isAuthorizedRequest({ 'x-aether-api-key': 'wrong-key' }, 'secret-key'),
    false,
  );
});

test('isAuthorizedRequest accepts Authorization bearer token', () => {
  assert.equal(
    isAuthorizedRequest({ authorization: 'Bearer secret-key' }, 'secret-key'),
    true,
  );
  assert.equal(
    isAuthorizedRequest({ authorization: 'Bearer wrong-key' }, 'secret-key'),
    false,
  );
});
