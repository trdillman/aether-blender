const path = require('path');
const { spawn } = require('child_process');
const { DEFAULT_SETTINGS } = require('./constants');
const { safeParseInt } = require('./utils');

const PROVIDER_PRESETS = {
  anthropic: {
    baseUrl: 'https://api.z.ai/api/anthropic',
    chatPath: '/v1/messages',
    keyHeader: 'x-api-key',
    keyPrefix: '',
    defaultModel: 'GLM-4.7',
  },
  openai: {
    baseUrl: 'https://api.openai.com',
    chatPath: '/v1/chat/completions',
    keyHeader: 'Authorization',
    keyPrefix: 'Bearer ',
    defaultModel: 'gpt-5.2',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com',
    chatPath: '/v1beta/models/{model}:generateContent',
    keyHeader: 'x-goog-api-key',
    keyPrefix: '',
    defaultModel: 'gemini-2.5-pro',
  },
  custom: {
    baseUrl: '',
    chatPath: '/v1/chat/completions',
    keyHeader: 'Authorization',
    keyPrefix: 'Bearer ',
    defaultModel: 'gpt-5.2',
  },
};

const normalizeProviderSettings = (settings) => {
  const next = { ...settings };
  const provider = ['anthropic', 'openai', 'gemini', 'custom'].includes(
    String(next.llmProvider || '').toLowerCase(),
  )
    ? String(next.llmProvider).toLowerCase()
    : 'anthropic';
  const preset = PROVIDER_PRESETS[provider];

  next.llmProvider = provider;
  next.llmUseCustomEndpoint = Boolean(next.llmUseCustomEndpoint);
  next.llmCustomBaseUrl = String(next.llmCustomBaseUrl || '').trim();
  next.llmModel = String(next.llmModel || preset.defaultModel || DEFAULT_SETTINGS.llmModel).trim();
  next.llmBaseUrl =
    next.llmUseCustomEndpoint && next.llmCustomBaseUrl ? next.llmCustomBaseUrl : preset.baseUrl;
  next.llmChatPath = preset.chatPath;
  next.llmApiKeyHeader = preset.keyHeader;
  next.llmApiKeyPrefix = preset.keyPrefix;

  return next;
};

const redactSettings = (settings) => ({
  ...settings,
  serverApiKey: undefined,
  hasServerApiKey: Boolean(settings.serverApiKey),
});

const mergeSettings = (input) => ({
  ...DEFAULT_SETTINGS,
  ...(input || {}),
  modelMap: {
    ...DEFAULT_SETTINGS.modelMap,
    ...((input && input.modelMap) || {}),
  },
});

const normalizeForLaunch = (settings) => {
  const next = normalizeProviderSettings(mergeSettings(settings));

  // Auto-align with Claude Code style auth when token is present and no explicit override was set.
  const hasAnthropicToken = Boolean(process.env.ANTHROPIC_AUTH_TOKEN);
  const looksLikeLegacyOpenAi =
    String(next.llmProvider || '').toLowerCase() === 'openai' &&
    String(next.llmBaseUrl || '').toLowerCase() === 'https://api.openai.com' &&
    String(next.llmChatPath || '').toLowerCase() === '/v1/chat/completions';

  if (hasAnthropicToken && looksLikeLegacyOpenAi) {
    next.llmProvider = 'anthropic';
    next.llmBaseUrl = 'https://api.z.ai/api/anthropic';
    next.llmChatPath = '/v1/messages';
    next.llmApiKeyHeader = 'x-api-key';
    next.llmApiKeyPrefix = '';
    next.anthropicVersion = next.anthropicVersion || '2023-06-01';
    next.modelMap = {
      ...(next.modelMap || {}),
      'GLM 4.7': 'GLM-4.7',
    };
  }

  // Repair legacy bad defaults from earlier server-root path migration.
  if (String(next.workspacePath || '').toLowerCase().endsWith(`${path.sep}server`)) {
    next.workspacePath = path.resolve(next.workspacePath, '..');
  }
  if (String(next.addonOutputPath || '').toLowerCase().endsWith(`${path.sep}server${path.sep}generated_addons`)) {
    next.addonOutputPath = path.resolve(next.addonOutputPath, '..', '..', 'generated_addons');
  }

  return next;
};

const validatePathExists = (label, value, errors) => {
  if (!value || typeof value !== 'string') {
    errors.push(`${label} is required.`);
    return;
  }

  const normalized = path.resolve(value);
  try {
    require('fs').accessSync(normalized);
  } catch {
    errors.push(`${label} does not exist: ${normalized}`);
  }
};

const checkBlenderExecutable = async (blenderPath, timeoutMs = 10000) => {
  return new Promise((resolve) => {
    const child = spawn(blenderPath, ['--version'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';

    const timeout = setTimeout(() => {
      child.kill();
      resolve({ ok: false, message: `Timed out running \`${blenderPath} --version\`.` });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      err += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({ ok: false, message: error.message });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ ok: true, message: out.trim() || err.trim() || 'OK' });
      } else {
        resolve({ ok: false, message: err.trim() || out.trim() || `Exit code ${code}` });
      }
    });
  });
};

const normalizeIncomingSettings = (input, currentSettings) => {
  const merged = normalizeProviderSettings(mergeSettings({ ...currentSettings, ...(input || {}) }));

  merged.timeoutMs = safeParseInt(merged.timeoutMs, DEFAULT_SETTINGS.timeoutMs);
  merged.runMode = merged.runMode === 'gui' ? 'gui' : 'headless';
  merged.logVerbosity = ['quiet', 'normal', 'verbose'].includes(merged.logVerbosity)
    ? merged.logVerbosity
    : 'normal';
  merged.allowTrustedPythonExecution = merged.allowTrustedPythonExecution === true;
  merged.apiKeySourceMode = merged.apiKeySourceMode === 'server-managed' ? 'server-managed' : 'env';
  merged.workspacePath = path.resolve(merged.workspacePath);
  merged.addonOutputPath = path.resolve(merged.addonOutputPath);
  return merged;
};

const validateSettings = async (settings) => {
  const errors = [];

  validatePathExists('Workspace path', settings.workspacePath, errors);
  validatePathExists('Add-on output path', settings.addonOutputPath, errors);

  if (!settings.timeoutMs || settings.timeoutMs < 1000) {
    errors.push('Timeout must be at least 1000ms.');
  }

  if (!settings.blenderPath || typeof settings.blenderPath !== 'string') {
    errors.push('Blender executable path is required.');
  }

  if (!settings.llmProvider || typeof settings.llmProvider !== 'string') {
    errors.push('LLM provider is required.');
  }

  if (!String(settings.llmModel || '').trim()) {
    errors.push('LLM model is required.');
  }

  if (settings.llmUseCustomEndpoint && !String(settings.llmCustomBaseUrl || '').trim()) {
    errors.push('Custom base URL is required when endpoint override is enabled.');
  }

  if (settings.apiKeySourceMode === 'server-managed' && !String(settings.serverApiKey || '').trim()) {
    errors.push('Server-managed API key is required when apiKeySourceMode is server-managed.');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const blenderCheck = await checkBlenderExecutable(settings.blenderPath, Math.min(settings.timeoutMs, 15000));
  if (!blenderCheck.ok) {
    errors.push(`Blender executable check failed: ${blenderCheck.message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    blenderInfo: blenderCheck.message,
  };
};

const resolveApiKey = (settings) => {
  if (settings.apiKeySourceMode === 'server-managed') {
    return String(settings.serverApiKey || '').trim();
  }

  return (
    process.env.LLM_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.OPENAI_API_KEY ||
    process.env.ZHIPU_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    ''
  );
};

module.exports = {
  mergeSettings,
  normalizeForLaunch,
  redactSettings,
  normalizeIncomingSettings,
  validateSettings,
  checkBlenderExecutable,
  resolveApiKey,
};
