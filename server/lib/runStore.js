const { DATA_DIR, RUNS_FILE, SETTINGS_FILE, DEFAULT_SETTINGS } = require('./constants');
const { ensureDir, readJson, writeJson } = require('./fsUtils');
const { mergeSettings, normalizeIncomingSettings, normalizeForLaunch } = require('./settingsService');

let initialized = false;
let runsCache = [];
let settingsCache = mergeSettings(DEFAULT_SETTINGS);

const clone = (value) => JSON.parse(JSON.stringify(value));

const normalizeRun = (run) => {
  if (!run || typeof run !== 'object') return null;
  const id = run.id != null ? String(run.id) : '';
  if (!id) return null;
  return {
    ...run,
    id,
  };
};

const ensureInitialized = async () => {
  if (initialized) return;
  await ensureDir(DATA_DIR);

  const persistedRuns = await readJson(RUNS_FILE, []);
  runsCache = Array.isArray(persistedRuns)
    ? persistedRuns.map(normalizeRun).filter(Boolean)
    : [];

  const persistedSettings = await readJson(SETTINGS_FILE, DEFAULT_SETTINGS);
  settingsCache = normalizeForLaunch(mergeSettings(persistedSettings));
  await writeJson(SETTINGS_FILE, settingsCache);
  await writeJson(RUNS_FILE, runsCache);

  initialized = true;
};

const persistRuns = async () => {
  await writeJson(RUNS_FILE, runsCache);
};

const persistSettings = async () => {
  await writeJson(SETTINGS_FILE, settingsCache);
};

const listRuns = async () => {
  await ensureInitialized();
  return clone(runsCache);
};

const getRun = async (id) => {
  await ensureInitialized();
  const normalizedId = String(id);
  const found = runsCache.find((run) => run.id === normalizedId);
  return found ? clone(found) : null;
};

const createOrUpsertRun = async (runInput) => {
  await ensureInitialized();
  const normalized = normalizeRun(runInput);
  if (!normalized) {
    throw new Error('Run must include a non-empty id.');
  }

  const idx = runsCache.findIndex((run) => run.id === normalized.id);
  if (idx === -1) {
    runsCache.unshift(normalized);
  } else {
    runsCache[idx] = {
      ...runsCache[idx],
      ...normalized,
    };
  }

  await persistRuns();
  return clone(normalized);
};

const patchRun = async (id, patch) => {
  await ensureInitialized();
  const normalizedId = String(id);
  const idx = runsCache.findIndex((run) => run.id === normalizedId);
  if (idx === -1) return null;

  const next = {
    ...runsCache[idx],
    ...(patch || {}),
    id: normalizedId,
  };
  runsCache[idx] = next;
  await persistRuns();
  return clone(next);
};

const getSettings = async () => {
  await ensureInitialized();
  return clone(settingsCache);
};

const putSettings = async (incoming) => {
  await ensureInitialized();
  settingsCache = normalizeIncomingSettings(incoming, settingsCache);
  await persistSettings();
  return clone(settingsCache);
};

module.exports = {
  ensureInitialized,
  listRuns,
  getRun,
  createOrUpsertRun,
  patchRun,
  getSettings,
  putSettings,
};
