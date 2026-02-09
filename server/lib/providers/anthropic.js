const anthropicAdapter = {
  name: 'anthropic',
  usesAnthropicVersionHeader: true,
  buildRequest({ model, prompt, systemPrompt }) {
    return {
      model,
      max_tokens: 1024,
      temperature: 0.2,
      system: String(systemPrompt || ''),
      messages: [
        {
          role: 'user',
          content: String(prompt || ''),
        },
      ],
    };
  },
  extractContent(payload) {
    if (!Array.isArray(payload?.content)) return typeof payload?.content === 'string' ? payload.content : '';
    return payload.content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item.text === 'string') return item.text;
        return '';
      })
      .join('')
      .trim();
  },
  extractUsage(payload) {
    return payload?.usage || null;
  },
  normalizeStreamEvent({ eventName, payload }) {
    if (!payload || typeof payload !== 'object') return null;

    if (payload.type === 'error' || payload.error) {
      return {
        type: 'response.error',
        provider: 'anthropic',
        error: payload.error || payload,
      };
    }

    if (eventName === 'message_start' || payload.type === 'message_start') {
      return {
        type: 'response.start',
        provider: 'anthropic',
      };
    }

    if (eventName === 'content_block_delta' || payload.type === 'content_block_delta') {
      const delta = payload?.delta?.text;
      if (typeof delta === 'string' && delta.length > 0) {
        return {
          type: 'response.output_text.delta',
          provider: 'anthropic',
          delta,
        };
      }
      return null;
    }

    if (eventName === 'message_delta' || payload.type === 'message_delta') {
      if (payload.usage) {
        return {
          type: 'response.usage',
          provider: 'anthropic',
          usage: payload.usage,
        };
      }
      return null;
    }

    if (eventName === 'message_stop' || payload.type === 'message_stop') {
      return {
        type: 'response.completed',
        provider: 'anthropic',
        finishReason: 'stop',
      };
    }

    return null;
  },
};

module.exports = {
  anthropicAdapter,
};
