const safeJsonParse = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const parseSseFrames = (rawText) => {
  const text = String(rawText || '');
  if (!text.trim()) return [];

  const lines = text.split(/\r?\n/);
  const frames = [];
  let eventName = '';
  let dataLines = [];

  const flush = () => {
    if (eventName || dataLines.length > 0) {
      frames.push({
        event: eventName || 'message',
        data: dataLines.join('\n').trim(),
      });
    }
    eventName = '';
    dataLines = [];
  };

  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
      continue;
    }
    dataLines.push(line.trim());
  }

  flush();
  return frames;
};

const normalizeProviderStreamEvents = ({ rawText, adapter }) => {
  const frames = parseSseFrames(rawText);
  const normalized = [];

  const pushEvent = (event) => {
    if (!event || typeof event !== 'object') return;
    if (typeof event.type !== 'string' || !event.type.trim()) return;
    normalized.push(event);
  };

  for (const frame of frames) {
    const rawData = frame.data || '';
    if (!rawData) continue;
    if (rawData === '[DONE]') {
      pushEvent({
        type: 'response.completed',
        provider: adapter?.name || 'unknown',
        finishReason: 'stop',
      });
      continue;
    }

    const payload = safeJsonParse(rawData);
    const events = adapter?.normalizeStreamEvent
      ? adapter.normalizeStreamEvent({
          eventName: frame.event,
          payload,
          rawData,
        })
      : null;

    if (!events) continue;
    if (Array.isArray(events)) {
      for (const event of events) {
        pushEvent(event);
      }
      continue;
    }
    pushEvent(events);
  }

  return normalized;
};

const collectStreamText = (events) =>
  events
    .filter((event) => event.type === 'response.output_text.delta' && typeof event.delta === 'string')
    .map((event) => event.delta)
    .join('');

const extractUsageFromEvents = (events) => {
  for (let idx = events.length - 1; idx >= 0; idx -= 1) {
    const event = events[idx];
    if (event.type === 'response.usage' && event.usage && typeof event.usage === 'object') {
      return event.usage;
    }
  }
  return null;
};

module.exports = {
  safeJsonParse,
  parseSseFrames,
  normalizeProviderStreamEvents,
  collectStreamText,
  extractUsageFromEvents,
};
