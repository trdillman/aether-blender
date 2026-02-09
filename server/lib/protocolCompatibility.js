const { createTaxonomyError } = require('./errorTaxonomy');

const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['1.0']);
const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];
const PROTOCOL_CAPABILITIES = Object.freeze([
  'run.lifecycle',
  'sse.stream',
  'protocol.validation',
  'blender.rpc',
  'audit.log',
]);
const SUPPORTED_PROVIDERS = Object.freeze(['anthropic', 'openai', 'custom']);

const normalizeVersion = (value) => {
  if (value == null) return '';
  return String(value).trim();
};

const evaluateProtocolHandshake = ({ requestedVersion } = {}) => {
  const normalizedVersion = normalizeVersion(requestedVersion);
  const versionToUse = normalizedVersion || DEFAULT_PROTOCOL_VERSION;

  const base = {
    ok: true,
    requestedVersion: normalizedVersion || null,
    selectedVersion: versionToUse,
    supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
    capabilities: PROTOCOL_CAPABILITIES,
    providers: SUPPORTED_PROVIDERS,
  };

  if (SUPPORTED_PROTOCOL_VERSIONS.includes(versionToUse)) {
    return base;
  }

  return {
    ...base,
    ok: false,
    selectedVersion: null,
    mismatch: {
      reason: 'unsupported_protocol_version',
      requestedVersion: versionToUse,
      supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
    },
  };
};

const assertHandshakeCompatible = ({ requestedVersion } = {}) => {
  const result = evaluateProtocolHandshake({ requestedVersion });
  if (result.ok) {
    return result;
  }

  throw createTaxonomyError('PROTOCOL_VERSION_MISMATCH', {
    message: `Unsupported protocol version "${result.mismatch.requestedVersion}".`,
    details: result.mismatch,
  });
};

module.exports = {
  SUPPORTED_PROTOCOL_VERSIONS,
  DEFAULT_PROTOCOL_VERSION,
  PROTOCOL_CAPABILITIES,
  SUPPORTED_PROVIDERS,
  evaluateProtocolHandshake,
  assertHandshakeCompatible,
};
