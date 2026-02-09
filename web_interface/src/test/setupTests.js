import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

class MockEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this._listeners = new Map();
    this.closed = false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type, handler) {
    const handlers = this._listeners.get(type) || [];
    handlers.push(handler);
    this._listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    const handlers = this._listeners.get(type) || [];
    this._listeners.set(
      type,
      handlers.filter((candidate) => candidate !== handler),
    );
  }

  emit(type, payload) {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
    const event = { data };

    if (type === 'message' && typeof this.onmessage === 'function') {
      this.onmessage(event);
    }

    const handlers = this._listeners.get(type) || [];
    handlers.forEach((handler) => handler(event));
  }

  emitError(payload = {}) {
    if (typeof this.onerror === 'function') {
      this.onerror(payload);
    }
  }

  close() {
    this.closed = true;
  }
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

const memoryStorage = (() => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
    removeItem: (key) => {
      store.delete(String(key));
    },
    clear: () => {
      store.clear();
    },
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  configurable: true,
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: memoryStorage,
    configurable: true,
  });
}

global.EventSource = MockEventSource;
global.__mockEventSource = MockEventSource;

beforeEach(() => {
  memoryStorage.clear();
  MockEventSource.instances = [];
});

afterEach(() => {
  cleanup();
});
