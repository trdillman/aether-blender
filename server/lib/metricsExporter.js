const clone = (value) => JSON.parse(JSON.stringify(value));

const createSeriesEntry = () => ({
  count: 0,
  success: 0,
  failure: 0,
  retries: 0,
  totalLatencyMs: 0,
  minLatencyMs: null,
  maxLatencyMs: null,
});

const providerSeries = new Map();
const executorSeries = new Map();

const toLatency = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

const keyFor = (...parts) => parts.map((part) => String(part || '')).join('::');

const mutateSeries = (bucket, key, updater) => {
  if (!bucket.has(key)) {
    bucket.set(key, createSeriesEntry());
  }
  const entry = bucket.get(key);
  updater(entry);
  bucket.set(key, entry);
};

const applySample = (entry, { success, latencyMs, retries }) => {
  const normalizedLatency = toLatency(latencyMs);
  const normalizedRetries = Number.isInteger(retries) && retries > 0 ? retries : 0;
  entry.count += 1;
  entry.retries += normalizedRetries;
  entry.totalLatencyMs += normalizedLatency;
  if (success) {
    entry.success += 1;
  } else {
    entry.failure += 1;
  }
  entry.minLatencyMs =
    entry.minLatencyMs == null ? normalizedLatency : Math.min(entry.minLatencyMs, normalizedLatency);
  entry.maxLatencyMs =
    entry.maxLatencyMs == null ? normalizedLatency : Math.max(entry.maxLatencyMs, normalizedLatency);
};

const recordProviderCall = ({ provider, operation, success, latencyMs, retries = 0 }) => {
  const providerKey = String(provider || 'unknown');
  const operationKey = String(operation || 'unknown');
  mutateSeries(providerSeries, keyFor(providerKey, operationKey), (entry) => {
    applySample(entry, { success: Boolean(success), latencyMs, retries });
  });
};

const recordExecutorCall = ({ executorType, success, latencyMs, retries = 0 }) => {
  const executorKey = String(executorType || 'unknown');
  mutateSeries(executorSeries, keyFor(executorKey), (entry) => {
    applySample(entry, { success: Boolean(success), latencyMs, retries });
  });
};

const mapSeriesForSnapshot = (bucket, mapper) =>
  [...bucket.entries()]
    .map(([key, entry]) => mapper(key, entry))
    .sort((a, b) => JSON.stringify(a.labels).localeCompare(JSON.stringify(b.labels)));

const snapshot = () => ({
  generatedAt: new Date().toISOString(),
  providers: mapSeriesForSnapshot(providerSeries, (key, entry) => {
    const [provider, operation] = key.split('::');
    return {
      labels: {
        provider,
        operation,
      },
      ...clone(entry),
    };
  }),
  executors: mapSeriesForSnapshot(executorSeries, (key, entry) => {
    const [executorType] = key.split('::');
    return {
      labels: {
        executorType,
      },
      ...clone(entry),
    };
  }),
});

const resetMetrics = () => {
  providerSeries.clear();
  executorSeries.clear();
};

module.exports = {
  recordProviderCall,
  recordExecutorCall,
  snapshot,
  resetMetrics,
};
