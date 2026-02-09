const { extractTextFromOpenAiMessage } = require('./openai');

const extractGeminiText = (payload) => {
  if (payload?.choices?.[0]?.message?.content != null) {
    return extractTextFromOpenAiMessage(payload.choices[0].message.content);
  }

  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      return '';
    })
    .join('')
    .trim();
};

const extractGeminiDelta = (payload) => {
  if (typeof payload?.choices?.[0]?.delta?.content === 'string') {
    return payload.choices[0].delta.content;
  }
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      return '';
    })
    .join('');
};

const extractGeminiUsage = (payload) => {
  if (payload?.usage) return payload.usage;
  if (!payload?.usageMetadata) return null;
  return {
    prompt_tokens: payload.usageMetadata.promptTokenCount || null,
    completion_tokens: payload.usageMetadata.candidatesTokenCount || null,
    total_tokens: payload.usageMetadata.totalTokenCount || null,
  };
};

const isNativeGeminiEndpoint = (requestConfig) => /:generatecontent/i.test(String(requestConfig?.url || ''));

const geminiAdapter = {
  name: 'gemini',
  buildRequest({ model, prompt, stream, systemPrompt, requestConfig }) {
    if (isNativeGeminiEndpoint(requestConfig)) {
      return {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${String(systemPrompt || '').trim()}\n\n${String(prompt || '').trim()}`.trim(),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
        },
      };
    }

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
    return extractGeminiText(payload);
  },
  extractUsage(payload) {
    return extractGeminiUsage(payload);
  },
  normalizeStreamEvent({ payload }) {
    if (!payload || typeof payload !== 'object') return null;

    if (payload.error) {
      return {
        type: 'response.error',
        provider: 'gemini',
        error: payload.error,
      };
    }

    const events = [];
    const delta = extractGeminiDelta(payload);
    if (delta) {
      events.push({
        type: 'response.output_text.delta',
        provider: 'gemini',
        delta,
      });
    }

    const usage = extractGeminiUsage(payload);
    if (usage) {
      events.push({
        type: 'response.usage',
        provider: 'gemini',
        usage,
      });
    }

    const finishReason = payload?.choices?.[0]?.finish_reason || payload?.candidates?.[0]?.finishReason || null;
    if (finishReason) {
      events.push({
        type: 'response.completed',
        provider: 'gemini',
        finishReason: String(finishReason),
      });
    }

    return events.length > 0 ? events : null;
  },
};

module.exports = {
  geminiAdapter,
  isNativeGeminiEndpoint,
};
