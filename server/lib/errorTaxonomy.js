const ERROR_TAXONOMY = Object.freeze({
  INTERNAL_ERROR: {
    statusCode: 500,
    category: 'internal',
    message: 'Internal server error.',
  },
  INVALID_JSON_BODY: {
    statusCode: 400,
    category: 'request',
    message: 'Invalid JSON body.',
  },
  PROTOCOL_VERSION_MISMATCH: {
    statusCode: 400,
    category: 'protocol',
    message: 'Requested protocol version is not supported.',
  },
  PROTOCOL_VERSION_REQUIRED: {
    statusCode: 400,
    category: 'protocol',
    message: 'Protocol version is required.',
  },
  PROTOCOL_RUN_EVENT_INVALID: {
    statusCode: 500,
    category: 'protocol',
    message: 'Run event payload failed schema validation.',
  },
  PROTOCOL_SSE_EVENT_INVALID: {
    statusCode: 500,
    category: 'protocol',
    message: 'SSE payload failed schema validation.',
  },
  AUTH_FAILURE: {
    statusCode: 401,
    category: 'auth',
    message: 'Unauthorized request.',
  },
  RPC_COMMAND_REQUIRED: {
    statusCode: 400,
    category: 'security',
    message: 'RPC command is required.',
  },
  RPC_COMMAND_UNSUPPORTED: {
    statusCode: 400,
    category: 'security',
    message: 'Unsupported RPC command.',
  },
  RPC_EXEC_PYTHON_INVALID_MODE: {
    statusCode: 400,
    category: 'security',
    message: 'Invalid exec_python mode.',
  },
  RPC_EXEC_PYTHON_TRUSTED_DISABLED: {
    statusCode: 403,
    category: 'security',
    message: 'Trusted Python execution is disabled.',
  },
  GATE_DONE_REQUIRED: {
    statusCode: 422,
    category: 'protocol',
    message: 'Verification gate requires protocol.done=true.',
  },
  RUN_CANCELLED: {
    statusCode: 409,
    category: 'run',
    message: 'Run cancelled by user request.',
  },
  PRESET_VALIDATION_FAILED: {
    statusCode: 400,
    category: 'preset',
    message: 'Preset payload validation failed.',
  },
  PRESET_BUNDLE_INVALID: {
    statusCode: 400,
    category: 'preset',
    message: 'Preset bundle validation failed.',
  },
  PRESET_STORAGE_CORRUPT: {
    statusCode: 500,
    category: 'preset',
    message: 'Preset storage file is corrupt.',
  },
});

const PROTOCOL_CODE_PREFIX = 'PROTOCOL_';

const resolveDescriptor = (code) => {
  if (!code) {
    return ERROR_TAXONOMY.INTERNAL_ERROR;
  }
  if (ERROR_TAXONOMY[code]) {
    return ERROR_TAXONOMY[code];
  }
  if (String(code).startsWith(PROTOCOL_CODE_PREFIX)) {
    return {
      statusCode: 400,
      category: 'protocol',
      message: 'Protocol validation failed.',
    };
  }
  return ERROR_TAXONOMY.INTERNAL_ERROR;
};

const createTaxonomyError = (code, options = {}) => {
  const descriptor = resolveDescriptor(code);
  const message = String(options.message || descriptor.message || 'Error');
  const error = new Error(message);
  error.code = String(code || 'INTERNAL_ERROR');
  error.statusCode = Number.isInteger(options.statusCode) ? options.statusCode : descriptor.statusCode;
  error.category = options.category || descriptor.category;
  if (options.path) {
    error.path = String(options.path);
  }
  if (options.details && typeof options.details === 'object') {
    error.details = options.details;
  }
  return error;
};

const mapErrorToTaxonomy = (error, options = {}) => {
  const fallbackCode = options.fallbackCode || 'INTERNAL_ERROR';
  const code =
    error && typeof error.code === 'string' && error.code.trim()
      ? error.code.trim()
      : fallbackCode;
  const descriptor = resolveDescriptor(code);
  const statusCode =
    Number.isInteger(error && error.statusCode) && error.statusCode > 0
      ? error.statusCode
      : descriptor.statusCode;
  const message =
    error && typeof error.message === 'string' && error.message.trim()
      ? error.message
      : descriptor.message;

  return {
    code,
    category: descriptor.category,
    statusCode,
    message,
    path: error && typeof error.path === 'string' ? error.path : undefined,
    details: error && typeof error.details === 'object' ? error.details : undefined,
  };
};

const toErrorResponse = (error, options = {}) => {
  const mapped = mapErrorToTaxonomy(error, options);
  return {
    error: mapped.message,
    code: mapped.code,
    category: mapped.category,
    ...(mapped.path ? { path: mapped.path } : {}),
    ...(mapped.details ? { details: mapped.details } : {}),
  };
};

const listTaxonomyCodes = () => Object.keys(ERROR_TAXONOMY);

module.exports = {
  ERROR_TAXONOMY,
  createTaxonomyError,
  mapErrorToTaxonomy,
  toErrorResponse,
  listTaxonomyCodes,
};
