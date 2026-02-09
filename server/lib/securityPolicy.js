const ALLOWED_RPC_COMMANDS = new Set(['ping', 'get_context', 'validate_addon', 'exec_python']);
const ALLOWED_EXEC_PYTHON_MODES = new Set(['safe', 'trusted']);

const normalizeCommand = (value) => String(value || '').trim().toLowerCase();

const createPolicyError = (message, statusCode = 400, code = 'SECURITY_POLICY_VIOLATION') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const assertRpcCommandAllowed = (command, options = {}) => {
  const normalized = normalizeCommand(command);
  if (!normalized) {
    throw createPolicyError('command is required and must be a non-empty string.', 400, 'RPC_COMMAND_REQUIRED');
  }
  if (!ALLOWED_RPC_COMMANDS.has(normalized)) {
    throw createPolicyError(`Unsupported RPC command: ${normalized}`, 400, 'RPC_COMMAND_UNSUPPORTED');
  }

  return normalized;
};

const normalizeExecPythonMode = (payload = {}) => {
  const rawMode = payload.mode == null ? 'safe' : String(payload.mode).trim().toLowerCase();
  if (!ALLOWED_EXEC_PYTHON_MODES.has(rawMode)) {
    throw createPolicyError(
      'exec_python payload.mode must be "safe" or "trusted".',
      400,
      'RPC_EXEC_PYTHON_INVALID_MODE',
    );
  }
  return rawMode;
};

const assertExecPythonPayloadAllowed = (payload = {}, options = {}) => {
  const mode = normalizeExecPythonMode(payload);
  const allowTrustedPythonExecution = options.allowTrustedPythonExecution === true;
  if (mode === 'trusted' && !allowTrustedPythonExecution) {
    throw createPolicyError(
      'exec_python mode "trusted" is disabled by server security policy.',
      403,
      'RPC_EXEC_PYTHON_TRUSTED_DISABLED',
    );
  }
  return {
    ...payload,
    mode,
  };
};

const extractProvidedApiKey = (headers = {}) => {
  const explicitHeader = String(headers['x-aether-api-key'] || '').trim();
  if (explicitHeader) {
    return explicitHeader;
  }

  const auth = String(headers.authorization || '').trim();
  if (!auth) return '';

  const bearerMatch = auth.match(/^bearer\s+(.+)$/i);
  if (bearerMatch && bearerMatch[1]) {
    return bearerMatch[1].trim();
  }
  return auth;
};

const isAuthorizedRequest = (headers, expectedKey) => {
  const required = String(expectedKey || '').trim();
  if (!required) {
    return true;
  }
  return extractProvidedApiKey(headers) === required;
};

module.exports = {
  assertRpcCommandAllowed,
  assertExecPythonPayloadAllowed,
  isAuthorizedRequest,
};
