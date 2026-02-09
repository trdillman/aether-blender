const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { appendAuditRecord, verifyAuditLogIntegrity } = require('../lib/auditLog');

const createTempAuditPath = async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-audit-'));
  return path.join(tempDir, 'audit.log.jsonl');
};

test('appendAuditRecord writes chained hashes and verifyAuditLogIntegrity passes', async () => {
  const auditPath = await createTempAuditPath();

  const first = await appendAuditRecord({
    eventType: 'test_event_1',
    payload: { a: 1 },
    filePath: auditPath,
  });
  const second = await appendAuditRecord({
    eventType: 'test_event_2',
    payload: { b: 2 },
    filePath: auditPath,
  });
  await appendAuditRecord({
    eventType: 'test_event_3',
    payload: { c: 3 },
    filePath: auditPath,
  });

  assert.equal(second.prevHash, first.hash);

  const verified = await verifyAuditLogIntegrity({ filePath: auditPath });
  assert.equal(verified.ok, true);
  assert.equal(verified.recordCount, 3);
  assert.deepEqual(verified.issues, []);
});

test('verifyAuditLogIntegrity detects tampering', async () => {
  const auditPath = await createTempAuditPath();
  await appendAuditRecord({
    eventType: 'test_event_1',
    payload: { stable: true },
    filePath: auditPath,
  });
  await appendAuditRecord({
    eventType: 'test_event_2',
    payload: { stable: true },
    filePath: auditPath,
  });

  const raw = await fs.readFile(auditPath, 'utf8');
  const lines = raw.trim().split('\n');
  const tampered = JSON.parse(lines[0]);
  tampered.payload = { stable: false };
  lines[0] = JSON.stringify(tampered);
  await fs.writeFile(auditPath, `${lines.join('\n')}\n`, 'utf8');

  const verified = await verifyAuditLogIntegrity({ filePath: auditPath });
  assert.equal(verified.ok, false);
  assert.equal(verified.recordCount, 2);
  assert.ok(Array.isArray(verified.issues));
  assert.ok(verified.issues.length > 0);
  assert.equal(verified.issues[0].line, 1);
  assert.equal(verified.issues[0].code, 'HASH_MISMATCH');
});

test('appendAuditRecord redacts sensitive payload fields and bearer tokens', async () => {
  const auditPath = await createTempAuditPath();
  await appendAuditRecord({
    eventType: 'test_event_sensitive_payload',
    payload: {
      apiKey: 'super-secret-api-key',
      nested: {
        token: 'rpc-token-value',
      },
      authHeader: 'Bearer top-secret-token',
      note: 'api_key=inline-secret',
      safeField: 'still-visible',
    },
    filePath: auditPath,
  });

  const raw = await fs.readFile(auditPath, 'utf8');
  const line = raw.trim().split('\n')[0];
  const parsed = JSON.parse(line);

  assert.equal(parsed.payload.apiKey, '[REDACTED]');
  assert.equal(parsed.payload.nested.token, '[REDACTED]');
  assert.equal(parsed.payload.authHeader, 'Bearer [REDACTED]');
  assert.equal(parsed.payload.note, 'api_key=[REDACTED]');
  assert.equal(parsed.payload.safeField, 'still-visible');
});

test('appendAuditRecord fails closed when existing audit chain integrity is broken', async () => {
  const auditPath = await createTempAuditPath();
  await appendAuditRecord({
    eventType: 'test_event_1',
    payload: { stable: true },
    filePath: auditPath,
  });
  await appendAuditRecord({
    eventType: 'test_event_2',
    payload: { stable: true },
    filePath: auditPath,
  });

  const raw = await fs.readFile(auditPath, 'utf8');
  const lines = raw.trim().split('\n');
  const tampered = JSON.parse(lines[0]);
  tampered.payload = { stable: false };
  lines[0] = JSON.stringify(tampered);
  await fs.writeFile(auditPath, `${lines.join('\n')}\n`, 'utf8');

  await assert.rejects(
    appendAuditRecord({
      eventType: 'test_event_3',
      payload: { stable: true },
      filePath: auditPath,
    }),
    (error) => error && error.code === 'AUDIT_LOG_INTEGRITY_VIOLATION',
  );

  const finalRaw = await fs.readFile(auditPath, 'utf8');
  assert.equal(finalRaw.trim().split('\n').length, 2);
});
