const { resolveApiKey } = require('./settingsService');
const {
  validateProtocolPlan,
  DEFAULT_MAX_PYTHON_CODE_LENGTH,
} = require('./protocolValidator');
const { resolveAdapter } = require('./providers/registry');
const {
  safeJsonParse,
  normalizeProviderStreamEvents,
  collectStreamText,
  extractUsageFromEvents,
} = require('./providers/streamNormalization');
const { recordProviderCall } = require('./metricsExporter');

const DEFAULT_SYSTEM_PROMPT =
  'You are an expert Blender add-on planner. Produce a concise implementation plan for scaffold edits and validation steps.';

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const resolveModelName = (settings, requestedModel) => {
  if (settings && typeof settings.llmModel === 'string' && settings.llmModel.trim()) {
    return settings.llmModel.trim();
  }
  if (!requestedModel) return '';
  const modelMap = (settings && settings.modelMap) || {};
  return modelMap[requestedModel] || requestedModel;
};

const resolveRequestConfig = (settings) => {
  const provider = String(settings?.llmProvider || 'openai').toLowerCase();
  const defaultPath =
    provider === 'anthropic'
      ? '/v1/messages'
      : provider === 'gemini'
        ? '/v1beta/models/{model}:generateContent'
        : '/v1/chat/completions';
  const baseUrl = String(
    settings?.llmBaseUrl ||
      (provider === 'anthropic'
        ? 'https://api.z.ai/api/anthropic'
        : provider === 'gemini'
          ? 'https://generativelanguage.googleapis.com'
          : 'https://api.openai.com'),
  ).replace(/\/+$/, '');
  const chatPath = String(settings?.llmChatPath || defaultPath);
  const isAnthropicLike =
    provider === 'anthropic' || /\/v1\/messages$/i.test(chatPath) || /\/api\/anthropic/i.test(baseUrl);
  const isGeminiLike =
    provider === 'gemini' ||
    /generativelanguage\.googleapis\.com/i.test(baseUrl) ||
    /generatecontent/i.test(chatPath);
  const keyHeader = String(
    settings?.llmApiKeyHeader ??
      (isAnthropicLike ? 'x-api-key' : isGeminiLike ? 'x-goog-api-key' : 'Authorization'),
  );
  const keyPrefix = String(settings?.llmApiKeyPrefix ?? (isAnthropicLike || isGeminiLike ? '' : 'Bearer '));
  const url = `${baseUrl}${chatPath.startsWith('/') ? chatPath : `/${chatPath}`}`;
  return {
    provider,
    url,
    keyHeader,
    keyPrefix,
    isAnthropicLike,
    isGeminiLike,
  };
};

const sanitizeErrorText = (input, secret) => {
  let text = String(input || '');
  if (secret) {
    text = text.split(secret).join('[REDACTED]');
  }
  return text;
};

const buildResolvedUrl = (requestConfig, model) => {
  const target = String(requestConfig?.url || '');
  if (!target.includes('{model}')) return target;
  return target.replace('{model}', encodeURIComponent(String(model || '')));
};

const isRetryableError = (error) => {
  if (!error) return false;
  if (error.code === 'PROVIDER_TIMEOUT') return true;
  if (error.code === 'PROVIDER_HTTP_ERROR') {
    return Number.isInteger(error.status) && error.status >= 500;
  }
  const networkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN']);
  return networkCodes.has(String(error.code || '').toUpperCase());
};

const callProvider = async ({
  prompt,
  model,
  settings,
  timeoutMs,
  stream = false,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
  operation = 'provider_call',
  onTraceSpan,
  maxRetries = 0,
}) => {
  const apiKey = resolveApiKey(settings || {});
  if (!apiKey) {
    const error = new Error('No API key configured for provider call.');
    error.code = 'MISSING_API_KEY';
    throw error;
  }

  const requestConfig = resolveRequestConfig(settings || {});
  const { adapter } = resolveAdapter(requestConfig.provider);
  const url = buildResolvedUrl(requestConfig, model);
  const boundedRetries = Math.max(0, Math.min(toInt(maxRetries, 0), 5));
  const startedAt = new Date().toISOString();
  let lastError = null;
  let retriesUsed = 0;

  for (let attempt = 0; attempt <= boundedRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = {
      'Content-Type': 'application/json',
      [requestConfig.keyHeader]: `${requestConfig.keyPrefix}${apiKey}`,
    };
    if (adapter.usesAnthropicVersionHeader || requestConfig.isAnthropicLike) {
      headers['anthropic-version'] = String(settings?.anthropicVersion || '2023-06-01');
    }
    const body = adapter.buildRequest({
      model,
      prompt,
      stream: Boolean(stream),
      systemPrompt,
      settings,
      requestConfig,
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const raw = await response.text();
      const json = safeJsonParse(raw);

      if (!response.ok) {
        const details = sanitizeErrorText(raw || JSON.stringify(json || {}), apiKey);
        const error = new Error(`Provider request failed (${response.status}): ${details}`);
        error.code = 'PROVIDER_HTTP_ERROR';
        error.status = response.status;
        throw error;
      }

      let result;
      if (stream) {
        const streamEvents = normalizeProviderStreamEvents({
          rawText: raw,
          adapter,
        });
        const content = collectStreamText(streamEvents).trim();
        const usage = extractUsageFromEvents(streamEvents);

        if (!content) {
          const error = new Error('Provider returned empty assistant content.');
          error.code = 'EMPTY_PROVIDER_CONTENT';
          throw error;
        }

        result = {
          content,
          usage,
          streamEvents,
        };
      } else {
        const content = adapter.extractContent(json);
        if (!content) {
          const error = new Error('Provider returned empty assistant content.');
          error.code = 'EMPTY_PROVIDER_CONTENT';
          throw error;
        }

        result = {
          content,
          usage: adapter.extractUsage(json),
          streamEvents: [],
        };
      }

      const elapsedMs = Math.max(0, Date.parse(new Date().toISOString()) - Date.parse(startedAt));
      retriesUsed = attempt;
      recordProviderCall({
        provider: requestConfig.provider,
        operation,
        success: true,
        latencyMs: elapsedMs,
        retries: retriesUsed,
      });
      if (typeof onTraceSpan === 'function') {
        await Promise.resolve(onTraceSpan({
          name: `provider.${String(requestConfig.provider || 'unknown').toLowerCase()}.request`,
          component: 'provider',
          status: 'ok',
          startedAt,
          attributes: {
            provider: requestConfig.provider,
            operation,
            model,
            attempts: attempt + 1,
            retries: retriesUsed,
          },
        }));
      }
      return result;
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(`Provider request timed out after ${timeoutMs}ms.`);
        timeoutError.code = 'PROVIDER_TIMEOUT';
        lastError = timeoutError;
      } else {
        lastError = error;
      }
      if (attempt < boundedRetries && isRetryableError(lastError)) {
        retriesUsed = attempt + 1;
        continue;
      }
      retriesUsed = attempt;
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  const elapsedMs = Math.max(0, Date.parse(new Date().toISOString()) - Date.parse(startedAt));
  recordProviderCall({
    provider: requestConfig.provider,
    operation,
    success: false,
    latencyMs: elapsedMs,
    retries: retriesUsed,
  });
  if (typeof onTraceSpan === 'function') {
    await Promise.resolve(onTraceSpan({
      name: `provider.${String(requestConfig.provider || 'unknown').toLowerCase()}.request`,
      component: 'provider',
      status: 'error',
      startedAt,
      attributes: {
        provider: requestConfig.provider,
        operation,
        model,
        attempts: retriesUsed + 1,
        retries: retriesUsed,
      },
      error: lastError && lastError.message ? lastError.message : String(lastError),
    }));
  }
  throw lastError || new Error('Provider call failed.');
};

const generatePlan = async ({ prompt, model, settings, onToolEvent, onTraceSpan, operation }) => {
  const provider = String(settings?.llmProvider || 'openai');
  const resolvedModel = resolveModelName(settings, model || 'default');
  const timeoutMs = Math.max(3000, Math.min(toInt(settings?.timeoutMs, 30000), 60000));
  const maxRetries = Math.max(0, Math.min(toInt(settings?.llmMaxRetries, 1), 5));

  if (typeof onToolEvent === 'function') {
    onToolEvent({
      type: 'tool_called',
      tool: 'llmService.generatePlan',
      provider,
      model: resolvedModel,
      fallback: false,
      reason: 'live_provider_call',
      message: 'Requesting live provider plan generation.',
    });
  }

  const live = await callProvider({
    prompt,
    model: resolvedModel,
    settings,
    timeoutMs,
    operation: operation || 'generate_plan',
    onTraceSpan,
    maxRetries,
  });

  return {
    provider,
    model: resolvedModel,
    usedFallback: false,
    content: live.content,
    usage: live.usage,
  };
};

const generateProtocolPlan = async ({ prompt, model, settings, onToolEvent, onTraceSpan, operation }) => {
  const provider = String(settings?.llmProvider || 'openai');
  const resolvedModel = resolveModelName(settings, model || 'default');
  const timeoutMs = Math.max(3000, Math.min(toInt(settings?.timeoutMs, 30000), 60000));
  const maxRetries = Math.max(0, Math.min(toInt(settings?.llmMaxRetries, 1), 5));
  const maxPythonCodeLength = toInt(
    settings?.pythonCodeMaxLength,
    DEFAULT_MAX_PYTHON_CODE_LENGTH,
  );

  if (typeof onToolEvent === 'function') {
    onToolEvent({
      type: 'tool_called',
      tool: 'llmService.generateProtocolPlan',
      provider,
      model: resolvedModel,
      fallback: false,
      reason: 'live_provider_call',
      message: 'Requesting strict JSON protocol plan generation.',
    });
  }

  const protocolPrompt = [
    'Return ONLY strict JSON for protocol v1. No markdown fences. No extra keys.',
    'Schema: {"version":"1.0","steps":[],"done":true|false,"final_message":"string","meta":{"requires_gate_verification":true|false}}',
    'Step schema: {"id":"step_1","type":"NODE_TREE|GN_OPS|PYTHON","description":"string","payload":{...}}',
    'NODE_TREE payload keys: target, operations.',
    'GN_OPS payload keys: v, target, ops.',
    'PYTHON payload keys: mode, code, timeout_ms. mode defaults to safe if omitted.',
    'Reject unknown fields.',
    `User prompt: ${String(prompt || '').trim()}`,
  ].join('\n');

  const live = await callProvider({
    prompt: protocolPrompt,
    model: resolvedModel,
    settings,
    timeoutMs,
    operation: operation || 'generate_protocol_plan',
    onTraceSpan,
    maxRetries,
  });

  const protocol = validateProtocolPlan(live.content, { maxPythonCodeLength });
  return {
    provider,
    model: resolvedModel,
    usedFallback: false,
    content: live.content,
    protocol,
    usage: live.usage,
  };
};

const sanitizeAddonName = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 'Aether Generated Addon';
  return raw.slice(0, 72);
};

const sanitizeOperatorIdName = (value) => {
  const raw = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  if (!raw.includes('.')) return 'aether.generated_task';
  return raw || 'aether.generated_task';
};

const sanitizeText = (value, fallback, maxLen = 120) => {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return fallback;
  return raw.slice(0, maxLen);
};

const buildFallbackSpec = (prompt) => ({
  addonName: 'Aether Generated Addon',
  panelLabel: 'Aether Swarm',
  operatorLabel: 'Run Generated Task',
  operatorIdName: 'aether.generated_task',
  operatorMessage: sanitizeText(prompt, 'Generated task executed.'),
  summary: sanitizeText(prompt, 'Generate scaffold updates based on prompt.', 240),
});

const normalizeAddonSpec = (raw, prompt) => {
  const fallback = buildFallbackSpec(prompt);
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    addonName: sanitizeAddonName(input.addonName || fallback.addonName),
    panelLabel: sanitizeText(input.panelLabel, fallback.panelLabel, 64),
    operatorLabel: sanitizeText(input.operatorLabel, fallback.operatorLabel, 64),
    operatorIdName: sanitizeOperatorIdName(input.operatorIdName || fallback.operatorIdName),
    operatorMessage: sanitizeText(input.operatorMessage, fallback.operatorMessage, 200),
    summary: sanitizeText(input.summary, fallback.summary, 240),
  };
};

const generateAddonSpec = async ({ prompt, model, settings, onToolEvent, onTraceSpan, operation }) => {
  const provider = String(settings?.llmProvider || 'openai');
  const resolvedModel = resolveModelName(settings, model || 'default');
  const timeoutMs = Math.max(3000, Math.min(toInt(settings?.timeoutMs, 30000), 60000));
  const maxRetries = Math.max(0, Math.min(toInt(settings?.llmMaxRetries, 1), 5));

  if (typeof onToolEvent === 'function') {
    onToolEvent({
      type: 'tool_called',
      tool: 'llmService.generateAddonSpec',
      provider,
      model: resolvedModel,
      fallback: false,
      reason: 'live_provider_call',
      message: 'Requesting prompt-specific addon spec.',
    });
  }

  const schemaPrompt = [
    'Return ONLY valid JSON with this shape:',
    '{',
    '  "addonName": string,',
    '  "panelLabel": string,',
    '  "operatorLabel": string,',
    '  "operatorIdName": "aether.some_name",',
    '  "operatorMessage": string,',
    '  "summary": string',
    '}',
    'No markdown fences. No extra keys.',
    `User prompt: ${String(prompt || '').trim()}`,
  ].join('\n');

  const live = await callProvider({
    prompt: schemaPrompt,
    model: resolvedModel,
    settings,
    timeoutMs,
    operation: operation || 'generate_addon_spec',
    onTraceSpan,
    maxRetries,
  });

  const parsed = safeJsonParse(live.content);
  return {
    provider,
    model: resolvedModel,
    usedFallback: false,
    content: live.content,
    spec: normalizeAddonSpec(parsed, prompt),
  };
};

const healthCache = {
  expiresAt: 0,
  value: null,
};

const pingProvider = async ({ settings, model }) => {
  const now = Date.now();
  if (healthCache.value && now < healthCache.expiresAt) {
    return healthCache.value;
  }

  const provider = String(settings?.llmProvider || 'openai');
  const resolvedModel = resolveModelName(settings, model || 'GLM 4.7');

  try {
    await callProvider({
      prompt: 'Respond with: ok',
      model: resolvedModel,
      settings,
      timeoutMs: 8000,
      operation: 'provider_ping',
      maxRetries: 0,
    });

    healthCache.value = {
      ok: true,
      provider,
      model: resolvedModel,
      message: 'LLM provider ping succeeded.',
    };
    healthCache.expiresAt = now + 60000;
    return healthCache.value;
  } catch (error) {
    healthCache.value = {
      ok: false,
      provider,
      model: resolvedModel,
      message: error?.message || 'LLM provider ping failed.',
    };
    healthCache.expiresAt = now + 15000;
    return healthCache.value;
  }
};

module.exports = {
  generatePlan,
  generateProtocolPlan,
  generateAddonSpec,
  resolveModelName,
  pingProvider,
  callProvider,
  resolveRequestConfig,
};
