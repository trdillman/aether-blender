const fs = require('fs/promises');
const crypto = require('crypto');
const path = require('path');
const { ensureDir } = require('./fsUtils');
const { AUDIT_LOG_FILE, AUDIT_EVENT_TYPES } = require('./constants');

let appendQueue = Promise.resolve();

const REDACTION_TOKEN = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(api[-_]?key|token|secret|authorization|password)/i;
const BEARER_PATTERN = /\b(Bearer\s+)([A-Za-z0-9._~+\-/=]+)/gi;
const KEY_VALUE_TEXT_PATTERN = /\b((?:api[-_]?key|token|secret|password)\s*[:=]\s*)([^\s,;]+)/gi;

const normalizeLines = (raw) =>
  String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const readLines = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return normalizeLines(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

const hashRecord = (recordWithoutHash) =>
  crypto.createHash('sha256').update(JSON.stringify(recordWithoutHash)).digest('hex');

const redactTextSecrets = (input) =>
  String(input || '')
    .replace(BEARER_PATTERN, (_, prefix) => `${prefix}${REDACTION_TOKEN}`)
    .replace(KEY_VALUE_TEXT_PATTERN, (_, prefix) => `${prefix}${REDACTION_TOKEN}`);

const redactSensitivePayload = (value, parentKey = '') => {
  if (value == null) {
    return value;
  }

  if (typeof value === 'string') {
    if (parentKey && SENSITIVE_KEY_PATTERN.test(parentKey)) {
      return REDACTION_TOKEN;
    }
    return redactTextSecrets(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitivePayload(item));
  }

  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = redactSensitivePayload(item, key);
    }
    return output;
  }

  return value;
};

const parseLine = (line, index) => {
  try {
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Record is not an object.');
    }
    return parsed;
  } catch (error) {
    const err = new Error(`Invalid audit log JSON at line ${index + 1}: ${error.message}`);
    err.code = 'AUDIT_RECORD_PARSE_ERROR';
    err.line = index + 1;
    throw err;
  }
};

const verifyAuditLogLines = (lines) => {
  if (!lines.length) {
    return {
      ok: true,
      recordCount: 0,
      issues: [],
    };
  }

  const issues = [];
  let previousHash = null;

  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseLine(lines[i], i);
    const expectedPrevHash = previousHash;
    const actualPrevHash = parsed.prevHash == null ? null : String(parsed.prevHash);
    if (actualPrevHash !== expectedPrevHash) {
      issues.push({
        line: i + 1,
        code: 'PREV_HASH_MISMATCH',
        expected: expectedPrevHash,
        actual: actualPrevHash,
      });
      break;
    }

    const {
      hash,
      ...base
    } = parsed;
    const expectedHash = hashRecord(base);
    const actualHash = typeof hash === 'string' ? hash : null;
    if (actualHash !== expectedHash) {
      issues.push({
        line: i + 1,
        code: 'HASH_MISMATCH',
        expected: expectedHash,
        actual: actualHash,
      });
      break;
    }

    previousHash = actualHash;
  }

  return {
    ok: issues.length === 0,
    recordCount: lines.length,
    issues,
  };
};

const appendAuditRecord = async ({
  eventType,
  payload,
  actor,
  source,
  timestamp,
  filePath = AUDIT_LOG_FILE,
} = {}) => {
  if (!eventType || typeof eventType !== 'string') {
    throw new Error('eventType is required for audit log records.');
  }

  const op = async () => {
    await ensureDir(path.dirname(filePath));
    const lines = await readLines(filePath);
    const integrity = verifyAuditLogLines(lines);
    if (!integrity.ok) {
      const issue = integrity.issues[0] || {};
      const error = new Error(
        `Audit log integrity check failed before append at line ${issue.line || '?'} (${issue.code || 'UNKNOWN'}).`,
      );
      error.code = 'AUDIT_LOG_INTEGRITY_VIOLATION';
      error.integrity = integrity;
      throw error;
    }

    const previous = lines.length ? parseLine(lines[lines.length - 1], lines.length - 1) : null;
    const prevHash = previous && typeof previous.hash === 'string' ? previous.hash : null;

    const baseRecord = {
      timestamp: timestamp || new Date().toISOString(),
      eventType: String(eventType),
      payload: payload && typeof payload === 'object' ? redactSensitivePayload(payload) : {},
      actor: actor == null ? 'system' : String(actor),
      source: source == null ? 'server' : String(source),
      prevHash,
    };
    const hash = hashRecord(baseRecord);
    const fullRecord = {
      ...baseRecord,
      hash,
    };

    await fs.appendFile(filePath, `${JSON.stringify(fullRecord)}\n`, 'utf8');
    return fullRecord;
  };

  appendQueue = appendQueue.then(op, op);
  return appendQueue;
};

const verifyAuditLogIntegrity = async ({ filePath = AUDIT_LOG_FILE } = {}) => {
  const lines = await readLines(filePath);
  return verifyAuditLogLines(lines);
};

module.exports = {
  appendAuditRecord,
  verifyAuditLogIntegrity,
  AUDIT_EVENT_TYPES,
};
