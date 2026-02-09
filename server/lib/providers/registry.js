const { openAiAdapter } = require('./openai');
const { anthropicAdapter } = require('./anthropic');
const { geminiAdapter } = require('./gemini');
const { openAiCompatibleAdapter } = require('./openaiCompatible');

const ADAPTERS = {
  openai: openAiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  custom: openAiCompatibleAdapter,
  'openai-compatible': openAiCompatibleAdapter,
};

const resolveProviderKey = (provider) => {
  const normalized = String(provider || 'openai').trim().toLowerCase();
  if (ADAPTERS[normalized]) return normalized;
  return 'openai-compatible';
};

const resolveAdapter = (provider) => {
  const providerKey = resolveProviderKey(provider);
  return {
    providerKey,
    adapter: ADAPTERS[providerKey] || openAiCompatibleAdapter,
  };
};

module.exports = {
  ADAPTERS,
  resolveProviderKey,
  resolveAdapter,
};
