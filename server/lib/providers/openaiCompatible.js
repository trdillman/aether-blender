const { openAiAdapter } = require('./openai');

const openAiCompatibleAdapter = {
  ...openAiAdapter,
  name: 'openai-compatible',
};

module.exports = {
  openAiCompatibleAdapter,
};
