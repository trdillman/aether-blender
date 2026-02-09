export const STARTER_PROMPTS = [
  'Create a Blender add-on that batch-renames selected objects using regex.',
  'Generate a UV helper add-on with a clean panel and undo-safe operators.',
  'Build an add-on that exports scene metrics to JSON with progress feedback.',
];

export const MODEL_OPTIONS = ['GLM 4.7', 'Claude Sonnet', 'Claude Opus'];

export const INITIAL_TRACE = [
  { id: 'planning', label: 'Planning', status: 'idle', duration: null, detail: 'Waiting for prompt.' },
  { id: 'tools', label: 'Tool Calls', status: 'idle', duration: null, detail: 'No tool calls yet.' },
  { id: 'code', label: 'Code Generation', status: 'idle', duration: null, detail: 'No code generated yet.' },
  { id: 'validation', label: 'Validation', status: 'idle', duration: null, detail: 'Validation not started.' },
];

const ACTIVE_RUN_STATUSES = new Set(['queued', 'starting', 'running', 'streaming', 'cancelling']);

export const formatTime = (date = new Date()) =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const isActiveRunStatus = (status) => ACTIVE_RUN_STATUSES.has(String(status || '').toLowerCase());

const cloneInitialTrace = () => INITIAL_TRACE.map((step) => ({ ...step }));

const defaultWelcomeMessage = () => ({
  id: 'welcome',
  role: 'assistant',
  time: formatTime(),
  content:
    'Aether is online. Describe your Blender add-on goal, and I will orchestrate planning, code generation, and validation.',
});

const defaultMessages = () => [defaultWelcomeMessage()];

const canUseLocalStorage = () => {
  if (typeof window === 'undefined') return false;

  try {
    return Boolean(window.localStorage);
  } catch {
    return false;
  }
};

const readStoredMessages = () => {
  if (!canUseLocalStorage()) return defaultMessages();

  try {
    const raw = window.localStorage.getItem('aether_chat_messages');
    if (!raw) return defaultMessages();

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : defaultMessages();
  } catch {
    return defaultMessages();
  }
};

const readStoredDrawerOpen = () => {
  if (!canUseLocalStorage()) return true;

  try {
    return window.localStorage.getItem('aether_drawer_open') !== 'false';
  } catch {
    return true;
  }
};

const sortRunHistory = (runs) =>
  [...runs].sort((a, b) => {
    const aDate = Date.parse(a?.updatedAt || a?.createdAt || 0) || 0;
    const bDate = Date.parse(b?.updatedAt || b?.createdAt || 0) || 0;
    return bDate - aDate;
  });

const withRunningState = (state, runStatus) => ({
  ...state,
  runStatus,
  isRunning: isActiveRunStatus(runStatus),
});

export const createInitialState = () => ({
  messages: readStoredMessages(),
  input: '',
  isRunning: false,
  runStatus: 'idle',
  activeRunId: null,
  runHistory: [],
  drawerOpen: readStoredDrawerOpen(),
  trace: cloneInitialTrace(),
  expandedTraceId: 'planning',
  model: MODEL_OPTIONS[0],
});

const normalizeMessagePayload = (payload, role) => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      id: payload.id || `${role}-${Date.now()}`,
      role,
      content: payload.content || '',
      time: payload.time || formatTime(),
      ...payload,
    };
  }

  return {
    id: `${role}-${Date.now()}`,
    role,
    content: typeof payload === 'string' ? payload : '',
    time: formatTime(),
  };
};

export const chatReducer = (state, action) => {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, input: action.payload ?? '' };

    case 'SET_RUNNING':
      return { ...state, isRunning: Boolean(action.payload) };

    case 'SET_MODEL':
      return { ...state, model: action.payload ?? state.model };

    case 'TOGGLE_DRAWER':
      return { ...state, drawerOpen: !state.drawerOpen };

    case 'SET_DRAWER':
      return { ...state, drawerOpen: Boolean(action.payload) };

    case 'SET_TRACE':
      return { ...state, trace: Array.isArray(action.payload) ? action.payload : state.trace };

    case 'RESET_TRACE':
      return { ...state, trace: cloneInitialTrace() };

    case 'UPDATE_TRACE_STEP': {
      const id = action.payload?.id;
      const patch = action.payload?.patch;
      if (!id || !patch) return state;

      return {
        ...state,
        trace: state.trace.map((step) => (step.id === id ? { ...step, ...patch } : step)),
      };
    }

    case 'SET_EXPANDED_TRACE_ID':
      return { ...state, expandedTraceId: action.payload ?? null };

    case 'SET_MESSAGES':
      return {
        ...state,
        messages: Array.isArray(action.payload) && action.payload.length > 0 ? action.payload : defaultMessages(),
      };

    case 'ADD_USER_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, normalizeMessagePayload(action.payload, 'user')],
      };

    case 'ADD_ASSISTANT_PLACEHOLDER':
      return {
        ...state,
        messages: [...state.messages, normalizeMessagePayload(action.payload, 'assistant')],
      };

    case 'APPEND_ASSISTANT_CONTENT': {
      const id = action.payload?.id;
      const delta = action.payload?.delta;
      if (typeof delta !== 'string') return state;

      return {
        ...state,
        messages: state.messages.map((msg) =>
          msg.id === id && msg.role === 'assistant' ? { ...msg, content: `${msg.content || ''}${delta}` } : msg,
        ),
      };
    }

    case 'UPDATE_ASSISTANT_CONTENT': {
      const id = action.payload?.id;
      const content = action.payload?.content;

      if (typeof content !== 'string') return state;

      if (id) {
        return {
          ...state,
          messages: state.messages.map((msg) =>
            msg.id === id && msg.role === 'assistant' ? { ...msg, content } : msg,
          ),
        };
      }

      let targetFound = false;
      const nextMessages = [...state.messages];

      for (let i = nextMessages.length - 1; i >= 0; i -= 1) {
        if (nextMessages[i].role === 'assistant') {
          nextMessages[i] = { ...nextMessages[i], content };
          targetFound = true;
          break;
        }
      }

      return targetFound ? { ...state, messages: nextMessages } : state;
    }

    case 'SET_RUN_STATUS':
      return withRunningState(state, action.payload ?? 'idle');

    case 'SET_ACTIVE_RUN_ID':
      return { ...state, activeRunId: action.payload ?? null };

    case 'SET_RUN_HISTORY':
      return { ...state, runHistory: sortRunHistory(Array.isArray(action.payload) ? action.payload : []) };

    case 'UPSERT_RUN_HISTORY_ITEM': {
      const item = action.payload;
      if (!item || typeof item !== 'object') return state;

      const previous = state.runHistory.find((run) => run.id === item.id);
      const merged = previous ? { ...previous, ...item } : item;
      const existing = state.runHistory.filter((run) => run.id !== item.id);
      return { ...state, runHistory: sortRunHistory([merged, ...existing]) };
    }

    case 'RESET_MESSAGES':
      return { ...state, messages: defaultMessages() };

    default:
      return state;
  }
};

