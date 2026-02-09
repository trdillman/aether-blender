const extractTextFromOpenAiMessage = (value) => {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item.text === 'string') return item.text;
      return '';
    })
    .join('')
    .trim();
};

const getOpenAiDeltaText = (payload) => {
  const delta = payload?.choices?.[0]?.delta;
  if (!delta) return '';
  if (typeof delta.content === 'string') return delta.content;
  if (Array.isArray(delta.content)) {
    return delta.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  return '';
};

const openAiAdapter = {
  name: 'openai',
  buildRequest({ model, prompt, stream, systemPrompt }) {
    return {
      model,
      messages: [
        { role: 'system', content: String(systemPrompt || '') },
        { role: 'user', content: String(prompt || '') },
      ],
      temperature: 0.2,
      stream: Boolean(stream),
    };
  },
  extractContent(payload) {
    const direct = payload?.choices?.[0]?.message?.content;
    return extractTextFromOpenAiMessage(direct);
  },
  extractUsage(payload) {
    return payload?.usage || null;
  },
  normalizeStreamEvent({ payload }) {
    if (!payload || typeof payload !== 'object') return null;

    if (payload.error) {
      return {
        type: 'response.error',
        provider: 'openai',
        error: payload.error,
      };
    }

    const events = [];
    const delta = getOpenAiDeltaText(payload);
    if (delta) {
      events.push({
        type: 'response.output_text.delta',
        provider: 'openai',
        delta,
      });
    }

    if (payload.usage) {
      events.push({
        type: 'response.usage',
        provider: 'openai',
        usage: payload.usage,
      });
    }

    if (payload?.choices?.[0]?.finish_reason) {
      events.push({
        type: 'response.completed',
        provider: 'openai',
        finishReason: payload.choices[0].finish_reason,
      });
    }

    return events.length > 0 ? events : null;
  },
};

module.exports = {
  openAiAdapter,
  extractTextFromOpenAiMessage,
};
