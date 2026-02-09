import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import TopBar from './components/TopBar';
import MessageList from './components/MessageList';
import Composer from './components/Composer';
import AgentDrawer from './components/AgentDrawer';
import {
  cancelRun,
  createPreset,
  deletePreset,
  executeActiveBlenderRpc,
  fetchActiveBlenderSession,
  fetchPresetById,
  fetchPresets,
  fetchRunById,
  fetchRuns,
  launchBlenderSession,
  startRun,
  stopBlenderSession,
  subscribeBlenderSessionStream,
  subscribeRunStream,
} from './lib/apiClient';
import {
  STARTER_PROMPTS,
  MODEL_OPTIONS,
  INITIAL_TRACE,
  formatTime,
  createInitialState,
  chatReducer,
  isActiveRunStatus,
} from './state/chatState';

const TRACE_STEP_IDS = new Set(INITIAL_TRACE.map((step) => step.id));
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'canceled', 'stopped', 'error']);

const normalizeRunStatus = (status) => {
  const value = String(status || '').trim().toLowerCase();
  if (!value) return 'idle';
  if (value === 'canceled') return 'cancelled';
  if (value === 'complete') return 'completed';
  return value;
};

const mapTraceStepId = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (TRACE_STEP_IDS.has(raw)) return raw;

  if (raw.includes('plan')) return 'planning';
  if (raw.includes('tool')) return 'tools';
  if (raw.includes('code') || raw.includes('gen')) return 'code';
  if (raw.includes('valid') || raw.includes('test')) return 'validation';
  return null;
};

const normalizeTraceStatus = (value) => {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return 'idle';
  if (status === 'running' || status === 'started' || status === 'in_progress' || status === 'in-progress') {
    return 'active';
  }
  if (status === 'complete' || status === 'completed' || status === 'success' || status === 'done') {
    return 'done';
  }
  if (status === 'failed' || status === 'error') {
    return 'idle';
  }
  if (status === 'active' || status === 'done' || status === 'idle') {
    return status;
  }

  return 'idle';
};

const formatDuration = (value) => {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (numeric < 1000) return `${numeric}ms`;
  return `${(numeric / 1000).toFixed(1)}s`;
};

const createTraceFromRun = (run) => {
  const next = INITIAL_TRACE.map((step) => ({ ...step }));
  const candidates = Array.isArray(run?.trace)
    ? run.trace
    : Array.isArray(run?.traceSteps)
      ? run.traceSteps
      : Array.isArray(run?.events)
        ? run.events
        : [];

  candidates.forEach((item) => {
    const stepId = mapTraceStepId(item?.stepId || item?.id || item?.phase || item?.step || item?.name);
    if (!stepId) return;

    const idx = next.findIndex((step) => step.id === stepId);
    if (idx < 0) return;

    next[idx] = {
      ...next[idx],
      status: normalizeTraceStatus(item?.status),
      detail: item?.detail || item?.message || item?.summary || next[idx].detail,
      duration: formatDuration(item?.durationMs || item?.duration || item?.elapsed || item?.elapsedMs || next[idx].duration),
      startedAt: item?.startedAt || next[idx].startedAt || null,
      completedAt: item?.completedAt || next[idx].completedAt || null,
    };
  });

  if (run?.steps && typeof run.steps === 'object') {
    Object.values(run.steps).forEach((step) => {
      const stepId = mapTraceStepId(step?.id || step?.stepId || step?.name);
      if (!stepId) return;
      const idx = next.findIndex((entry) => entry.id === stepId);
      if (idx < 0) return;

      next[idx] = {
        ...next[idx],
        status: normalizeTraceStatus(step?.status),
        duration: formatDuration(step?.durationMs || step?.duration),
        startedAt: step?.startedAt || next[idx].startedAt || null,
        completedAt: step?.completedAt || next[idx].completedAt || null,
        detail: step?.error ? `Error: ${step.error}` : next[idx].detail,
      };
    });
  }

  return next;
};

const normalizeMessagesFromRun = (run) => {
  if (!Array.isArray(run?.messages) || run.messages.length === 0) return null;

  const formatted = run.messages
    .filter((msg) => msg && (msg.role === 'assistant' || msg.role === 'user'))
    .map((msg, index) => ({
      id: msg.id || `${msg.role}-${run.id || 'run'}-${index}`,
      role: msg.role,
      content: String(msg.content ?? ''),
      time: msg.time || formatTime(msg.createdAt ? new Date(msg.createdAt) : undefined),
    }));

  return formatted.length > 0 ? formatted : null;
};

const normalizeRunHistoryItem = (run) => {
  if (!run || typeof run !== 'object') return null;

  return {
    id: run.id,
    status: normalizeRunStatus(run.status),
    model: run.model,
    prompt: run.prompt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
};

const pickLatestRun = (runs) => {
  if (!Array.isArray(runs) || runs.length === 0) return null;

  return [...runs].sort((a, b) => {
    const aTime = Date.parse(a?.updatedAt || a?.createdAt || 0) || 0;
    const bTime = Date.parse(b?.updatedAt || b?.createdAt || 0) || 0;
    return bTime - aTime;
  })[0];
};

const mergeRunSnapshots = (previous, next) => {
  if (!previous) return next;
  if (!next) return previous;
  if (previous.id && next.id && previous.id !== next.id) return next;

  return {
    ...previous,
    ...next,
    steps: {
      ...(previous.steps && typeof previous.steps === 'object' ? previous.steps : {}),
      ...(next.steps && typeof next.steps === 'object' ? next.steps : {}),
    },
    artifacts: Array.isArray(next.artifacts)
      ? next.artifacts
      : Array.isArray(previous.artifacts)
        ? previous.artifacts
        : [],
    events: Array.isArray(next.events) ? next.events : Array.isArray(previous.events) ? previous.events : [],
    protocol: next.protocol || previous.protocol || null,
  };
};

const extractEventType = (event) =>
  String(event?.type || event?.kind || event?.payload?.type || event?.payload?.event || '').toLowerCase();

const extractAssistantDelta = (payload, eventType) => {
  if (!payload || typeof payload !== 'object') return null;

  if (eventType.includes('assistant.delta')) {
    return String(payload.delta ?? payload.token ?? payload.text ?? '');
  }

  if (payload.type === 'assistant_delta') {
    return String(payload.delta ?? payload.token ?? payload.text ?? '');
  }

  return null;
};

const extractAssistantMessage = (payload, eventType) => {
  if (!payload || typeof payload !== 'object') return null;

  if (eventType.includes('assistant.message') || payload.type === 'assistant_message') {
    const value = payload.content ?? payload.message ?? payload.text;
    return typeof value === 'string' ? value : null;
  }

  return null;
};

const extractTracePatch = (payload) => {
  if (!payload || typeof payload !== 'object') return null;

  const stepId = mapTraceStepId(payload.stepId || payload.phase || payload.step || payload.id || payload.stage);
  if (!stepId) return null;

  const patch = {};
  const nextStatus = normalizeTraceStatus(payload.status);
  if (nextStatus) patch.status = nextStatus;

  const detail = payload.detail || payload.message || payload.summary;
  if (detail) patch.detail = detail;

  const duration = payload.durationMs || payload.duration || payload.elapsed || payload.elapsedMs;
  if (duration) patch.duration = formatDuration(duration);
  if (payload.timestamp && payload.type === 'step_started') patch.startedAt = payload.timestamp;
  if (payload.timestamp && payload.type === 'step_completed') patch.completedAt = payload.timestamp;

  if (!patch.status && !patch.detail && !patch.duration) return null;
  return { id: stepId, patch };
};

const extractLogSummary = (payload, eventType) => {
  if (!payload || typeof payload !== 'object') return null;

  const type = String(payload.type || payload.event || eventType || '').toLowerCase();
  const summary = payload.summary || payload.log || payload.message;
  const line = typeof payload.line === 'string' ? payload.line : null;
  if (type.includes('blender_log') && line && line.trim()) {
    return line.trim();
  }

  if (typeof summary !== 'string' || !summary.trim()) return null;
  if (
    type.includes('log') ||
    type.includes('trace') ||
    type.includes('status') ||
    type.includes('step') ||
    type.includes('event')
  ) {
    return summary.trim();
  }

  return null;
};

const humanizeStatus = (status, isRunning) => {
  if (isRunning) return 'Generating';

  const normalized = normalizeRunStatus(status);
  if (normalized === 'idle') return 'Ready';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const isRunningBlenderSessionStatus = (status) => String(status || '').toLowerCase() === 'running';

const App = () => {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);
  const [blenderSession, setBlenderSession] = useState({
    id: null,
    status: 'idle',
    rpcReady: false,
    busy: false,
  });
  const [activeRun, setActiveRun] = useState(null);
  const [presets, setPresets] = useState([]);
  const [presetsBusy, setPresetsBusy] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesRef = useRef(state.messages);
  const runStatusRef = useRef(state.runStatus);
  const streamRef = useRef(null);
  const blenderStreamRef = useRef(null);
  const startControllerRef = useRef(null);
  const cancelControllerRef = useRef(null);
  const loadControllerRef = useRef(null);
  const activeAssistantIdRef = useRef(null);
  const loggedSummariesRef = useRef(new Set());

  useEffect(() => {
    messagesRef.current = state.messages;
  }, [state.messages]);

  useEffect(() => {
    runStatusRef.current = state.runStatus;
  }, [state.runStatus]);

  useEffect(() => {
    localStorage.setItem('aether_chat_messages', JSON.stringify(state.messages));
  }, [state.messages]);

  useEffect(() => {
    localStorage.setItem('aether_drawer_open', String(state.drawerOpen));
  }, [state.drawerOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages]);

  const cleanupStream = () => {
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
  };

  const cleanupBlenderStream = () => {
    if (blenderStreamRef.current) {
      blenderStreamRef.current.close();
      blenderStreamRef.current = null;
    }
  };

  const syncBlenderSession = (nextSession, { busy } = {}) => {
    setBlenderSession((current) => {
      if (!nextSession || typeof nextSession !== 'object') {
        return {
          id: null,
          status: 'idle',
          rpcReady: false,
          busy: typeof busy === 'boolean' ? busy : current.busy,
        };
      }

      return {
        id: nextSession.id || current.id || null,
        status: String(nextSession.status || current.status || 'idle'),
        rpcReady: Boolean(nextSession.rpcReady),
        busy: typeof busy === 'boolean' ? busy : current.busy,
      };
    });
  };

  const cleanupControllers = () => {
    if (startControllerRef.current) {
      startControllerRef.current.abort();
      startControllerRef.current = null;
    }
    if (cancelControllerRef.current) {
      cancelControllerRef.current.abort();
      cancelControllerRef.current = null;
    }
    if (loadControllerRef.current) {
      loadControllerRef.current.abort();
      loadControllerRef.current = null;
    }
  };

  const refreshRunDetails = async (runId, { signal } = {}) => {
    if (!runId) return;
    try {
      const detailed = await fetchRunById(runId, { signal });
      if (detailed) {
        hydrateRun(detailed, { replaceMessages: false });
      }
    } catch {
      // Keep UI responsive even when detail fetch fails.
    }
  };

  const loadPresets = async ({ signal } = {}) => {
    try {
      const items = await fetchPresets({ signal });
      setPresets(Array.isArray(items) ? items : []);
    } catch {
      // Non-blocking for chat flow.
    }
  };

  const hydrateRun = (run, { replaceMessages = true } = {}) => {
    if (!run || typeof run !== 'object') return;
    setActiveRun((current) => mergeRunSnapshots(current, run));

    const historyItem = normalizeRunHistoryItem(run);
    if (historyItem?.id) {
      dispatch({ type: 'UPSERT_RUN_HISTORY_ITEM', payload: historyItem });
      dispatch({ type: 'SET_ACTIVE_RUN_ID', payload: historyItem.id });
    }

    if (run.model && MODEL_OPTIONS.includes(run.model)) {
      dispatch({ type: 'SET_MODEL', payload: run.model });
    }

    const nextStatus = normalizeRunStatus(run.status);
    dispatch({ type: 'SET_RUN_STATUS', payload: nextStatus });

    const nextTrace = createTraceFromRun(run);
    dispatch({ type: 'SET_TRACE', payload: nextTrace });

    if (replaceMessages) {
      const fromRun = normalizeMessagesFromRun(run);
      if (fromRun?.length) {
        dispatch({ type: 'SET_MESSAGES', payload: fromRun });
      }
    }
  };

  const ensureAssistantMessage = () => {
    const existingId = activeAssistantIdRef.current;
    if (existingId) return existingId;

    const assistantId = `assistant-${Date.now()}`;
    activeAssistantIdRef.current = assistantId;

    dispatch({
      type: 'ADD_ASSISTANT_PLACEHOLDER',
      payload: {
        id: assistantId,
        role: 'assistant',
        content: '',
        time: formatTime(),
      },
    });

    return assistantId;
  };

  const appendSummary = (summary) => {
    if (!summary || typeof summary !== 'string') return;
    if (loggedSummariesRef.current.has(summary)) return;

    loggedSummariesRef.current.add(summary);
    const assistantId = ensureAssistantMessage();

    dispatch({
      type: 'APPEND_ASSISTANT_CONTENT',
      payload: {
        id: assistantId,
        delta: `${messagesRef.current.find((msg) => msg.id === assistantId)?.content ? '\n' : ''}- ${summary}`,
      },
    });
  };

  const finalizeRunStatus = (status) => {
    const normalized = normalizeRunStatus(status);
    dispatch({ type: 'SET_RUN_STATUS', payload: normalized });

    if (TERMINAL_STATUSES.has(normalized)) {
      const assistantId = activeAssistantIdRef.current;
      const assistantMessage = assistantId ? messagesRef.current.find((msg) => msg.id === assistantId) : null;
      const hasAssistantContent = Boolean(assistantMessage && String(assistantMessage.content || '').trim());

      if (assistantId && !hasAssistantContent) {
        const fallback =
          normalized === 'completed'
            ? 'Run completed. Check trace/logs for detailed step output.'
            : normalized === 'cancelled' || normalized === 'canceled'
              ? 'Run cancelled.'
              : 'Run finished with an error. Check trace/logs for details.';
        if (assistantMessage) {
          dispatch({
            type: 'UPDATE_ASSISTANT_CONTENT',
            payload: { id: assistantId, content: fallback },
          });
        } else {
          dispatch({
            type: 'ADD_ASSISTANT_PLACEHOLDER',
            payload: {
              id: assistantId,
              role: 'assistant',
              content: fallback,
              time: formatTime(),
            },
          });
        }
      }

      cleanupStream();
      activeAssistantIdRef.current = null;
    }
  };

  const attachRunStream = (runId) => {
    if (!runId) return;

    cleanupStream();

    streamRef.current = subscribeRunStream(runId, {
      onEvent: (event) => {
        const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
        const eventType = extractEventType(event);
        setActiveRun((current) => {
          const next = current && current.id ? { ...current } : { id: runId, events: [], artifacts: [], steps: {} };
          if (payload.stepId && payload && typeof payload === 'object') {
            const stepId = String(payload.stepId);
            next.steps = {
              ...(next.steps || {}),
              [stepId]: {
                ...(next.steps?.[stepId] || {}),
                id: stepId,
                status: payload.status || next.steps?.[stepId]?.status || 'running',
                startedAt: payload.type === 'step_started' ? payload.timestamp : next.steps?.[stepId]?.startedAt,
                completedAt: payload.type === 'step_completed' ? payload.timestamp : next.steps?.[stepId]?.completedAt,
                durationMs: payload.durationMs ?? next.steps?.[stepId]?.durationMs ?? null,
                error:
                  payload.type === 'run_failed' || eventType.includes('error')
                    ? payload.error || payload.message || next.steps?.[stepId]?.error || null
                    : next.steps?.[stepId]?.error || null,
              },
            };
          }
          if (Array.isArray(next.events)) {
            next.events = [...next.events, { ...payload, _eventType: eventType, _timestamp: new Date().toISOString() }];
          }
          if (payload.protocol && typeof payload.protocol === 'object') {
            next.protocol = payload.protocol;
          }
          return next;
        });

        const runSnapshot = payload.run || payload.data?.run;
        if (runSnapshot && typeof runSnapshot === 'object') {
          hydrateRun(runSnapshot, { replaceMessages: true });
        }

        const runStatus = normalizeRunStatus(payload.status || payload.runStatus || payload.state);
        if (runStatus && runStatus !== 'idle') {
          finalizeRunStatus(runStatus);
          dispatch({
            type: 'UPSERT_RUN_HISTORY_ITEM',
            payload: {
              id: runId,
              status: runStatus,
              updatedAt: payload.updatedAt || new Date().toISOString(),
            },
          });
        }

        const tracePatch = extractTracePatch(payload);
        if (tracePatch) {
          dispatch({ type: 'UPDATE_TRACE_STEP', payload: tracePatch });
          dispatch({ type: 'SET_EXPANDED_TRACE_ID', payload: tracePatch.id });
        }

        const assistantMessage = extractAssistantMessage(payload, eventType);
        if (assistantMessage !== null) {
          const assistantId = ensureAssistantMessage();
          dispatch({ type: 'UPDATE_ASSISTANT_CONTENT', payload: { id: assistantId, content: assistantMessage } });
        }

        const delta = extractAssistantDelta(payload, eventType);
        if (delta) {
          const assistantId = ensureAssistantMessage();
          dispatch({ type: 'APPEND_ASSISTANT_CONTENT', payload: { id: assistantId, delta } });
        }

        const summary = extractLogSummary(payload, eventType);
        if (summary) appendSummary(summary);

        if (
          eventType.includes('done') ||
          eventType.includes('complete') ||
          eventType.includes('run_completed') ||
          eventType.includes('run_failed')
        ) {
          finalizeRunStatus(payload.status || 'completed');
          refreshRunDetails(runId);
        }

        if (eventType.includes('error')) {
          finalizeRunStatus(payload.status || 'failed');
          const message = payload.message || payload.error?.message || 'Run failed while streaming.';
          appendSummary(message);
        }
      },
      onError: () => {
        if (!isActiveRunStatus(runStatusRef.current)) return;
        appendSummary('Stream disconnected. Attempting to preserve current run state.');
      },
    });
  };

  const attachBlenderSessionStream = (sessionId) => {
    if (!sessionId) return;

    cleanupBlenderStream();
    blenderStreamRef.current = subscribeBlenderSessionStream(sessionId, {
      onEvent: (event) => {
        const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
        const eventType = String(payload.type || event?.type || event?.kind || '').toLowerCase();

        if (payload.session && typeof payload.session === 'object') {
          syncBlenderSession(payload.session);
          return;
        }

        if (!eventType) return;

        if (eventType === 'blender_rpc_ready') {
          setBlenderSession((current) => ({ ...current, rpcReady: true }));
          return;
        }

        if (eventType === 'blender_rpc_error') {
          setBlenderSession((current) => ({ ...current, rpcReady: false }));
          return;
        }

        if (
          eventType === 'blender_started' ||
          eventType === 'blender_stopping' ||
          eventType === 'blender_stopped' ||
          eventType === 'blender_exited' ||
          eventType === 'blender_failed'
        ) {
          setBlenderSession((current) => {
            const status = String(payload.status || eventType.replace('blender_', ''));
            const isTerminal = ['stopped', 'completed', 'exited', 'failed'].includes(status.toLowerCase());
            return {
              ...current,
              status,
              rpcReady: isTerminal ? false : current.rpcReady,
            };
          });
        }
      },
    });
  };

  useEffect(() => {
    const controller = new AbortController();
    loadControllerRef.current = controller;

    const loadHistory = async () => {
      try {
        const [runs, activeBlenderSession] = await Promise.all([
          fetchRuns({ signal: controller.signal }),
          fetchActiveBlenderSession({ signal: controller.signal }),
        ]);
        await loadPresets({ signal: controller.signal });
        const history = runs.map(normalizeRunHistoryItem).filter(Boolean);
        dispatch({ type: 'SET_RUN_HISTORY', payload: history });

        const latest = pickLatestRun(runs);
        if (!latest) return;

        hydrateRun(latest, { replaceMessages: true });
        refreshRunDetails(latest.id, { signal: controller.signal });

        const status = normalizeRunStatus(latest.status);
        if (isActiveRunStatus(status) && latest.id) {
          attachRunStream(latest.id);
        }

        if (activeBlenderSession?.id) {
          syncBlenderSession(activeBlenderSession, { busy: false });
          if (isRunningBlenderSessionStatus(activeBlenderSession.status)) {
            attachBlenderSessionStream(activeBlenderSession.id);
          }
        } else {
          syncBlenderSession(null, { busy: false });
        }
      } catch (error) {
        if (controller.signal.aborted) return;

        const message = error instanceof Error ? error.message : 'Unknown error.';
        dispatch({
          type: 'ADD_ASSISTANT_PLACEHOLDER',
          payload: {
            id: `assistant-load-error-${Date.now()}`,
            role: 'assistant',
            content: `Failed to load run history: ${message}`,
            time: formatTime(),
          },
        });
      } finally {
        if (loadControllerRef.current === controller) {
          loadControllerRef.current = null;
        }
      }
    };

    loadHistory();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(
    () => () => {
      cleanupStream();
      cleanupBlenderStream();
      cleanupControllers();
      activeAssistantIdRef.current = null;
      loggedSummariesRef.current.clear();
    },
    [],
  );

  const statusLabel = useMemo(() => humanizeStatus(state.runStatus, state.isRunning), [state.runStatus, state.isRunning]);
  const blenderBridgeStatusText = useMemo(() => {
    if (blenderSession.busy) return 'Blender bridge: busy';
    if (!blenderSession.id || !isRunningBlenderSessionStatus(blenderSession.status)) return 'Blender bridge: offline';
    if (blenderSession.rpcReady) return 'Blender bridge: ready';
    return 'Blender bridge: starting';
  }, [blenderSession.busy, blenderSession.id, blenderSession.rpcReady, blenderSession.status]);

  const appendAssistantInfo = (content) => {
    dispatch({
      type: 'ADD_ASSISTANT_PLACEHOLDER',
      payload: {
        id: `assistant-info-${Date.now()}`,
        role: 'assistant',
        content,
        time: formatTime(),
      },
    });
  };

  const onLaunchBlender = async () => {
    setBlenderSession((current) => ({ ...current, busy: true }));
    try {
      const session = await launchBlenderSession({ mode: 'gui' });
      syncBlenderSession(session, { busy: false });
      if (session?.id) {
        attachBlenderSessionStream(session.id);
      }
      appendAssistantInfo(`Blender launched (${session?.id || 'unknown session'}).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown launch error.';
      setBlenderSession((current) => ({ ...current, busy: false }));
      appendAssistantInfo(`Blender launch failed: ${message}`);
    }
  };

  const onStopBlender = async () => {
    if (!blenderSession.id) return;
    setBlenderSession((current) => ({ ...current, busy: true }));
    try {
      const session = await stopBlenderSession(blenderSession.id);
      cleanupBlenderStream();
      syncBlenderSession(session, { busy: false });
      appendAssistantInfo(`Blender stopped (${session?.id || blenderSession.id}).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown stop error.';
      setBlenderSession((current) => ({ ...current, busy: false }));
      appendAssistantInfo(`Blender stop failed: ${message}`);
    }
  };

  const onTestBridge = async () => {
    if (blenderSession.busy) return;

    setBlenderSession((current) => ({ ...current, busy: true }));
    try {
      const pingResponse = await executeActiveBlenderRpc({
        command: 'ping',
        payload: {},
        timeoutMs: 5000,
      });
      const pingSessionId = pingResponse?.sessionId || blenderSession.id || 'active';
      appendAssistantInfo(`Bridge ping OK (${pingSessionId}).`);

      const contextResponse = await executeActiveBlenderRpc({
        command: 'get_context',
        payload: {},
        timeoutMs: 10000,
      });
      const context = contextResponse?.result || {};
      const blenderVersion = context?.blenderVersion || 'unknown';
      const mode = context?.isBackground ? 'headless' : 'gui';
      appendAssistantInfo(`Bridge context OK (Blender ${blenderVersion}, ${mode}).`);
      if (pingSessionId) {
        setBlenderSession((current) => ({ ...current, id: pingSessionId, status: 'running', rpcReady: true, busy: false }));
      } else {
        setBlenderSession((current) => ({ ...current, rpcReady: true, busy: false }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown RPC error.';
      setBlenderSession((current) => ({ ...current, busy: false }));
      appendAssistantInfo(`Bridge test failed: ${message}`);
    }
  };

  const stopGeneration = async () => {
    if (!state.activeRunId || !state.isRunning) return;

    if (startControllerRef.current) {
      startControllerRef.current.abort();
      startControllerRef.current = null;
    }

    const controller = new AbortController();
    cancelControllerRef.current = controller;

    dispatch({ type: 'SET_RUN_STATUS', payload: 'cancelling' });

    try {
      const cancelledRun = await cancelRun(state.activeRunId, { signal: controller.signal });
      hydrateRun(cancelledRun, { replaceMessages: false });
      finalizeRunStatus(cancelledRun?.status || 'cancelled');
      refreshRunDetails(cancelledRun?.id || state.activeRunId);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : 'Unknown cancel error.';
        appendAssistantInfo(`Cancel request failed: ${message}`);
      }
    } finally {
      if (cancelControllerRef.current === controller) {
        cancelControllerRef.current = null;
      }
    }
  };

  const clearConversation = () => {
    if (state.isRunning) {
      appendAssistantInfo('Stop the active run before clearing the conversation.');
      return;
    }

    cleanupStream();
    dispatch({ type: 'RESET_MESSAGES' });
    dispatch({ type: 'RESET_TRACE' });
    dispatch({ type: 'SET_EXPANDED_TRACE_ID', payload: 'planning' });
    dispatch({ type: 'SET_RUN_STATUS', payload: 'idle' });
    dispatch({ type: 'SET_ACTIVE_RUN_ID', payload: null });
    setActiveRun(null);
    activeAssistantIdRef.current = null;
    loggedSummariesRef.current.clear();
  };

  const submitPrompt = async (promptText) => {
    const safePromptText = typeof promptText === 'string' ? promptText : '';
    const trimmed = safePromptText.trim();
    if (!trimmed || state.isRunning) return;

    loggedSummariesRef.current.clear();

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      time: formatTime(),
    };

    const assistantId = `assistant-${Date.now()}`;
    activeAssistantIdRef.current = assistantId;

    dispatch({ type: 'ADD_USER_MESSAGE', payload: userMessage });
    dispatch({
      type: 'ADD_ASSISTANT_PLACEHOLDER',
      payload: {
        id: assistantId,
        role: 'assistant',
        content: '',
        time: formatTime(),
      },
    });
    dispatch({ type: 'SET_INPUT', payload: '' });
    dispatch({ type: 'SET_RUN_STATUS', payload: 'starting' });
    dispatch({ type: 'SET_TRACE', payload: INITIAL_TRACE.map((step) => ({ ...step })) });
    dispatch({ type: 'SET_EXPANDED_TRACE_ID', payload: 'planning' });

    if (startControllerRef.current) {
      startControllerRef.current.abort();
    }

    const controller = new AbortController();
    startControllerRef.current = controller;

    try {
      const run = await startRun({
        prompt: trimmed,
        model: state.model,
        messages: [...messagesRef.current, userMessage].map((msg) => ({ role: msg.role, content: msg.content })),
        signal: controller.signal,
      });

      hydrateRun(run, { replaceMessages: false });
      if (run?.id) {
        dispatch({ type: 'SET_ACTIVE_RUN_ID', payload: run.id });
        attachRunStream(run.id);
        refreshRunDetails(run.id);
      }

      const startStatus = normalizeRunStatus(run?.status || 'running');
      finalizeRunStatus(startStatus);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : 'Unknown run start error.';
        dispatch({ type: 'SET_RUN_STATUS', payload: 'failed' });
        dispatch({
          type: 'UPDATE_ASSISTANT_CONTENT',
          payload: {
            id: assistantId,
            content: `Request failed: ${message}`,
          },
        });
      }
    } finally {
      if (startControllerRef.current === controller) {
        startControllerRef.current = null;
      }
    }
  };

  const handleCreatePreset = async (nameInput) => {
    if (!activeRun?.protocol || presetsBusy) return;
    const fallbackName = `Preset ${new Date().toLocaleString()}`;
    const name = String(nameInput || '').trim() || fallbackName;

    setPresetsBusy(true);
    try {
      const created = await createPreset({
        name,
        description: activeRun?.prompt ? `From run prompt: ${activeRun.prompt}` : '',
        sourceRunId: activeRun?.id || null,
        protocol: activeRun.protocol,
      });
      if (created) {
        setPresets((current) => [created, ...current.filter((item) => item.id !== created.id)]);
        appendAssistantInfo(`Preset saved: ${created.name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown preset save error.';
      appendAssistantInfo(`Preset save failed: ${message}`);
    } finally {
      setPresetsBusy(false);
    }
  };

  const handleDeletePreset = async (presetId) => {
    if (!presetId || presetsBusy) return;
    setPresetsBusy(true);
    try {
      await deletePreset(presetId);
      setPresets((current) => current.filter((item) => item.id !== presetId));
      appendAssistantInfo('Preset deleted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown preset delete error.';
      appendAssistantInfo(`Preset delete failed: ${message}`);
    } finally {
      setPresetsBusy(false);
    }
  };

  const handleExportPreset = async (presetId) => {
    if (!presetId) return;
    try {
      const preset = await fetchPresetById(presetId);
      const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${String(preset.name || preset.id || 'preset').replace(/\s+/g, '_')}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      appendAssistantInfo(`Preset exported: ${preset.name || preset.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown preset export error.';
      appendAssistantInfo(`Preset export failed: ${message}`);
    }
  };

  const handleImportPresetFile = async (file) => {
    if (!file) return;
    setPresetsBusy(true);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const created = await createPreset({
        name: parsed.name || file.name.replace(/\.json$/i, ''),
        description: parsed.description || 'Imported preset',
        protocol: parsed.protocol || parsed,
        metadata: parsed.metadata || { imported: true },
      });
      setPresets((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      appendAssistantInfo(`Preset imported: ${created.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown preset import error.';
      appendAssistantInfo(`Preset import failed: ${message}`);
    } finally {
      setPresetsBusy(false);
    }
  };

  const handleLoadPreset = async (presetId) => {
    if (!presetId) return;
    try {
      const preset = await fetchPresetById(presetId);
      setActiveRun((current) =>
        mergeRunSnapshots(current, {
          id: current?.id || state.activeRunId || 'preset-preview',
          protocol: preset.protocol || null,
        }),
      );
      appendAssistantInfo(`Preset loaded into inspector: ${preset.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown preset load error.';
      appendAssistantInfo(`Preset load failed: ${message}`);
    }
  };

  return (
    <div className="app-shell min-h-screen">
      <div className="background-orb background-orb-1" />
      <div className="background-orb background-orb-2" />

      <TopBar
        model={state.model}
        setModel={(value) => dispatch({ type: 'SET_MODEL', payload: value })}
        modelOptions={MODEL_OPTIONS}
        statusLabel={statusLabel}
        blenderBridgeStatusText={blenderBridgeStatusText}
        onLaunchBlender={onLaunchBlender}
        onStopBlender={onStopBlender}
        onTestBridge={onTestBridge}
        blenderSessionActive={Boolean(blenderSession.id && isRunningBlenderSessionStatus(blenderSession.status))}
        blenderSessionBusy={blenderSession.busy}
      />

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-4 pb-5 pt-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex min-h-[calc(100vh-120px)] flex-col rounded-2xl border border-white/10 bg-[var(--surface-1)]/95 shadow-2xl shadow-black/25">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <h1 className="text-sm font-semibold text-[var(--text-primary)]">Conversation</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={clearConversation}
                className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                aria-label="Clear conversation"
              >
                Clear Chat
              </button>
              <button
                onClick={() => dispatch({ type: 'TOGGLE_DRAWER' })}
                className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-cyan-400/60 lg:hidden"
                aria-label={state.drawerOpen ? 'Hide run inspector' : 'Show run inspector'}
                aria-expanded={state.drawerOpen}
              >
                {state.drawerOpen ? 'Hide Trace' : 'Show Trace'}
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
            <MessageList
              messages={state.messages}
              isRunning={state.isRunning}
              starterPrompts={STARTER_PROMPTS}
              onSelectStarter={submitPrompt}
            />
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-white/10 px-4 py-4 sm:px-6">
            <Composer
              input={state.input}
              setInput={(value) => dispatch({ type: 'SET_INPUT', payload: value })}
              isRunning={state.isRunning}
              onSubmit={submitPrompt}
              onStop={stopGeneration}
              onAttach={() =>
                appendAssistantInfo('File attachments are not wired yet. Paste requirements directly in the prompt for now.')
              }
            />
          </div>
        </section>

        <AgentDrawer
          drawerOpen={state.drawerOpen}
          setDrawerOpen={() => dispatch({ type: 'TOGGLE_DRAWER' })}
          trace={state.trace}
          expandedTraceId={state.expandedTraceId}
          setExpandedTraceId={(value) => dispatch({ type: 'SET_EXPANDED_TRACE_ID', payload: value })}
          runStatus={state.runStatus}
          activeRun={activeRun}
          presets={presets}
          presetsBusy={presetsBusy}
          onCreatePreset={handleCreatePreset}
          onDeletePreset={handleDeletePreset}
          onExportPreset={handleExportPreset}
          onImportPresetFile={handleImportPresetFile}
          onLoadPreset={handleLoadPreset}
        />
      </main>
    </div>
  );
};

export default App;



