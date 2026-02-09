const MODEL_ENV_BY_LABEL = {
  'GLM 4.7': 'VITE_LLM_MODEL_GLM47',
  'Claude Sonnet': 'VITE_LLM_MODEL_CLAUDE_SONNET',
  'Claude Opus': 'VITE_LLM_MODEL_CLAUDE_OPUS',
};

const DEFAULT_MODEL_BY_LABEL = {
  'GLM 4.7': 'glm-4.7',
  'Claude Sonnet': 'claude-sonnet-4-5',
  'Claude Opus': 'claude-opus-4-1',
};

const PROVIDER_PRESETS = {
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/paas',
    chatPath: '/v4/chat/completions',
    keyHeader: 'Authorization',
    keyPrefix: 'Bearer ',
  },
  openai: {
    baseUrl: 'https://api.openai.com',
    chatPath: '/v1/chat/completions',
    keyHeader: 'Authorization',
    keyPrefix: 'Bearer ',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api',
    chatPath: '/v1/chat/completions',
    keyHeader: 'Authorization',
    keyPrefix: 'Bearer ',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    chatPath: '/chat/completions',
    keyHeader: 'Authorization',
    keyPrefix: 'Bearer ',
  },
  custom: {
    baseUrl: '',
    chatPath: '/v1/chat/completions',
    keyHeader: 'Authorization',
    keyPrefix: 'Bearer ',
  },
};
const ZHIPU_CODING_URL = 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions';

const PROVIDER_ALIASES = {
  glm47: 'zhipu',
  glm4_7: 'zhipu',
  glm: 'zhipu',
  google: 'gemini',
};

const rawProviderName = (import.meta.env.VITE_LLM_PROVIDER || 'zhipu').toLowerCase();
const providerName = PROVIDER_ALIASES[rawProviderName] || rawProviderName;
const providerPreset = PROVIDER_PRESETS[providerName] || PROVIDER_PRESETS.custom;
const PROVIDER_KEY_ENV_BY_NAME = {
  zhipu: 'VITE_LLM_API_KEY_ZHIPU',
  openai: 'VITE_LLM_API_KEY_OPENAI',
  gemini: 'VITE_LLM_API_KEY_GEMINI',
  openrouter: 'VITE_LLM_API_KEY_OPENROUTER',
  custom: 'VITE_LLM_API_KEY_CUSTOM',
};

const providerKeyEnv = PROVIDER_KEY_ENV_BY_NAME[providerName];
const API_KEY =
  import.meta.env.VITE_LLM_API_KEY ||
  (providerKeyEnv ? import.meta.env[providerKeyEnv] : undefined);
const API_BASE_URL =
  import.meta.env.VITE_LLM_BASE_URL || import.meta.env.VITE_LLM_API_BASE_URL || providerPreset.baseUrl;
const API_PATH =
  import.meta.env.VITE_LLM_CHAT_PATH || import.meta.env.VITE_LLM_API_PATH || providerPreset.chatPath;
const API_KEY_HEADER =
  import.meta.env.VITE_LLM_KEY_HEADER || import.meta.env.VITE_LLM_API_KEY_HEADER || providerPreset.keyHeader;
const API_KEY_PREFIX =
  import.meta.env.VITE_LLM_KEY_PREFIX || import.meta.env.VITE_LLM_API_KEY_PREFIX || providerPreset.keyPrefix;

const resolveModelId = (modelLabel) => {
  const envKey = MODEL_ENV_BY_LABEL[modelLabel];
  const envModel = envKey ? import.meta.env[envKey] : undefined;
  return envModel || DEFAULT_MODEL_BY_LABEL[modelLabel] || modelLabel;
};

const normalizeMessages = (messages) =>
  messages
    .filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant'))
    .map((msg) => ({
      role: msg.role,
      content: String(msg.content ?? ''),
    }));

const parseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const requestCompletion = async ({ requestUrl, payload, signal }) => {
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [API_KEY_HEADER]: `${API_KEY_PREFIX}${API_KEY}`,
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let details = '';
    try {
      details = await response.text();
    } catch {
      details = '';
    }

    const parsed = parseJson(details);
    const err = new Error(`LLM request failed (${response.status}). ${details}`.trim());
    err.status = response.status;
    err.details = details;
    err.parsed = parsed;
    throw err;
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('LLM returned an empty response.');
  }

  return content;
};

export const generateAssistantReply = async ({ modelLabel, messages, signal }) => {
  if (!API_BASE_URL || !API_KEY) {
    throw new Error(
      'LLM not configured. Set VITE_LLM_PROVIDER (glm47|zhipu|openai|gemini|openrouter|custom) and VITE_LLM_API_KEY in web_interface/.env.',
    );
  }

  const requestUrl = `${String(API_BASE_URL).replace(/\/+$/, '')}${API_PATH}`;
  const payload = {
    model: resolveModelId(modelLabel),
    messages: normalizeMessages(messages),
    temperature: 0.2,
    stream: false,
  };

  try {
    return await requestCompletion({ requestUrl, payload, signal });
  } catch (error) {
    const zhipuInsufficientBalance =
      providerName === 'zhipu' &&
      error?.status === 429 &&
      (error?.parsed?.error?.code === '1113' || String(error?.details || '').includes('"code":"1113"'));

    if (zhipuInsufficientBalance) {
      return requestCompletion({ requestUrl: ZHIPU_CODING_URL, payload, signal });
    }

    throw error;
  }
};
