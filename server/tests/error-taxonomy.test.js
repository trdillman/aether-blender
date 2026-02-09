const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTaxonomyError,
  mapErrorToTaxonomy,
  toErrorResponse,
  listTaxonomyCodes,
} = require('../lib/errorTaxonomy');

test('createTaxonomyError returns typed error with mapped defaults', () => {
  const error = createTaxonomyError('PROTOCOL_VERSION_MISMATCH', {
    message: 'Unsupported protocol version "9.9".',
  });
  assert.equal(error.code, 'PROTOCOL_VERSION_MISMATCH');
  assert.equal(error.statusCode, 400);
  assert.equal(error.category, 'protocol');
});

test('mapErrorToTaxonomy maps unknown code to internal fallback', () => {
  const error = new Error('unexpected');
  error.code = 'WHATEVER_UNKNOWN';

  const mapped = mapErrorToTaxonomy(error);
  assert.equal(mapped.code, 'WHATEVER_UNKNOWN');
  assert.equal(mapped.statusCode, 500);
  assert.equal(mapped.category, 'internal');
});

test('mapErrorToTaxonomy maps protocol-prefixed codes as protocol category', () => {
  const error = new Error('bad payload');
  error.code = 'PROTOCOL_PAYLOAD_INVALID';

  const mapped = mapErrorToTaxonomy(error);
  assert.equal(mapped.statusCode, 400);
  assert.equal(mapped.category, 'protocol');
});

test('toErrorResponse includes stable envelope fields', () => {
  const error = createTaxonomyError('RPC_COMMAND_UNSUPPORTED');
  const response = toErrorResponse(error);
  assert.equal(response.code, 'RPC_COMMAND_UNSUPPORTED');
  assert.equal(response.category, 'security');
  assert.ok(typeof response.error === 'string' && response.error.length > 0);
});

test('listTaxonomyCodes includes protocol mismatch code', () => {
  const codes = listTaxonomyCodes();
  assert.ok(codes.includes('PROTOCOL_VERSION_MISMATCH'));
});
