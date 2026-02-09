import { useEffect, useMemo, useState } from 'react';
import { Play, Settings, Square, Sparkles } from 'lucide-react';
import SettingsModal from './SettingsModal';
import { fetchSettings, saveSettings as persistSettings, updateServerApiKey } from '../lib/apiClient';

const DEFAULT_SETTINGS = {
  apiKeySourceMode: 'env',
  serverApiKey: '',
  llmProvider: 'anthropic',
  llmModel: 'GLM-4.7',
  llmUseCustomEndpoint: false,
  llmCustomBaseUrl: '',
  llmBaseUrl: 'https://api.z.ai/api/anthropic',
  blenderPath: 'blender',
  workspacePath: '',
  addonOutputPath: '',
  runMode: 'headless',
  timeoutMs: 120000,
  logVerbosity: 'normal',
  allowTrustedPythonExecution: false,
};

const PROVIDER_BASE_URLS = {
  anthropic: 'https://api.z.ai/api/anthropic',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
  custom: '',
};

const PROVIDER_DEFAULT_MODELS = {
  anthropic: 'GLM-4.7',
  openai: 'gpt-5.2',
  gemini: 'gemini-2.5-pro',
  custom: 'gpt-5.2',
};

const parseErrorMessages = (payload, fallbackMessage) => {
  if (payload && Array.isArray(payload.errors) && payload.errors.length > 0) {
    return payload.errors.map((item) => String(item));
  }

  if (payload && typeof payload.error === 'string') {
    return [payload.error];
  }

  if (payload && typeof payload.message === 'string') {
    return [payload.message];
  }

  return [fallbackMessage];
};

const buildLocalValidationErrors = (values) => {
  const errors = {};
  if (!String(values.llmProvider || '').trim()) errors.llmProvider = 'Provider is required.';
  if (!String(values.llmModel || '').trim()) errors.llmModel = 'Model is required.';
  if (!String(values.blenderPath || '').trim()) errors.blenderPath = 'Blender path is required.';
  if (!String(values.workspacePath || '').trim()) errors.workspacePath = 'Workspace path is required.';
  if (!String(values.addonOutputPath || '').trim()) errors.addonOutputPath = 'Add-on output path is required.';

  const timeout = Number.parseInt(String(values.timeoutMs || ''), 10);
  if (!Number.isFinite(timeout) || timeout < 1000) {
    errors.timeoutMs = 'Timeout must be at least 1000ms.';
  }

  if (values.llmUseCustomEndpoint && !String(values.llmCustomBaseUrl || '').trim()) {
    errors.llmCustomBaseUrl = 'Custom base URL is required when override is enabled.';
  }

  if (values.apiKeySourceMode === 'server-managed') {
    const hasIncoming = Boolean(String(values.serverApiKey || '').trim());
    if (!hasIncoming && !values.hasServerApiKey) {
      errors.serverApiKey = 'Server-managed API key is required.';
    }
  }

  return errors;
};

const TopBar = ({
  model,
  setModel,
  modelOptions,
  statusLabel,
  onOpenSettings,
  onLaunchBlender,
  onStopBlender,
  onTestBridge,
  blenderSessionActive,
  blenderSessionBusy,
  blenderBridgeStatusText,
}) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsValues, setSettingsValues] = useState(DEFAULT_SETTINGS);
  const [backendErrors, setBackendErrors] = useState([]);

  const localErrors = useMemo(() => buildLocalValidationErrors(settingsValues), [settingsValues]);

  useEffect(() => {
    if (!isSettingsOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !isSavingSettings) {
        setIsSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSettingsOpen, isSavingSettings]);

  const openSettings = async () => {
    onOpenSettings?.();
    setIsSettingsOpen(true);
    setBackendErrors([]);
    setIsLoadingSettings(true);

    try {
      const data = (await fetchSettings()) || {};
      updateServerApiKey(data.serverApiKey);
      setSettingsValues((current) => ({ ...current, ...data }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load settings.';
      setBackendErrors([message]);
    } finally {
      setIsLoadingSettings(false);
    }
  };

  const handleSaveSettings = async () => {
    if (Object.keys(localErrors).length > 0) return;
    setIsSavingSettings(true);
    setBackendErrors([]);

    try {
      const payload = { ...settingsValues };
      if (
        payload.apiKeySourceMode === 'server-managed' &&
        !String(payload.serverApiKey || '').trim() &&
        payload.hasServerApiKey
      ) {
        delete payload.serverApiKey;
      }

      const result = await persistSettings(payload);
      if (!result || result.valid === false) {
        setBackendErrors(parseErrorMessages(result, 'Validation failed.'));
        return;
      }
      const updatedSettings = (result && result.settings) || {};
      updateServerApiKey(updatedSettings.serverApiKey);
      setSettingsValues((current) => ({ ...current, ...updatedSettings }));
      setIsSettingsOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save settings.';
      setBackendErrors([message]);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleSettingChange = (field, value) => {
    setSettingsValues((current) => {
      const next = {
        ...current,
        [field]:
          field === 'timeoutMs'
            ? Number.parseInt(String(value), 10) || 0
            : field === 'llmUseCustomEndpoint' || field === 'allowTrustedPythonExecution'
              ? Boolean(value)
              : value,
      };

      if (field === 'llmProvider') {
        const provider = String(value || 'anthropic');
        if (!String(next.llmModel || '').trim()) {
          next.llmModel = PROVIDER_DEFAULT_MODELS[provider] || next.llmModel;
        }
        if (!next.llmUseCustomEndpoint) {
          next.llmBaseUrl = PROVIDER_BASE_URLS[provider] || '';
        }
      }

      if (field === 'llmUseCustomEndpoint' && !Boolean(value)) {
        next.llmBaseUrl = PROVIDER_BASE_URLS[next.llmProvider || 'anthropic'] || '';
      }

      if (field === 'llmCustomBaseUrl' && next.llmUseCustomEndpoint) {
        next.llmBaseUrl = String(value || '');
      }

      return next;
    });
  };

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[var(--surface-1)]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-400/15 text-cyan-300">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Aether Swarm</p>
              <p className="text-xs text-[var(--text-muted)]">Workspace: Blender Add-on Studio</p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs sm:gap-3">
            <label htmlFor="model-select" className="sr-only">
              Model
            </label>
            <select
              id="model-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-2.5 py-1.5 text-[var(--text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
              aria-label="Select model"
            >
              {modelOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
            <span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2.5 py-1 text-emerald-300">
              {statusLabel}
            </span>
            <span className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-2.5 py-1 text-cyan-200">
              {blenderBridgeStatusText || 'Blender bridge: offline'}
            </span>
            <button
              onClick={() => onTestBridge?.()}
              disabled={blenderSessionBusy}
              className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-2.5 py-1.5 text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Test Blender bridge"
              title="Test Blender bridge (ping + get_context)"
            >
              Test Bridge
            </button>
            <button
              onClick={() => {
                if (blenderSessionActive) {
                  onStopBlender?.();
                } else {
                  onLaunchBlender?.();
                }
              }}
              disabled={blenderSessionBusy}
              className="rounded-lg border border-white/10 bg-[var(--surface-2)] p-2 text-[var(--text-muted)] transition hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={blenderSessionActive ? 'Stop Blender quick test' : 'Launch Blender quick test'}
              title={blenderSessionActive ? 'Stop Blender quick test' : 'Launch Blender quick test'}
              aria-pressed={blenderSessionActive}
            >
              {blenderSessionActive ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button
              onClick={openSettings}
              className="rounded-lg border border-white/10 bg-[var(--surface-2)] p-2 text-[var(--text-muted)] transition hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-cyan-400/60"
              aria-label="Open settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <SettingsModal
        isOpen={isSettingsOpen}
        values={settingsValues}
        isLoading={isLoadingSettings}
        isSaving={isSavingSettings}
        backendErrors={backendErrors}
        localErrors={localErrors}
        onChange={handleSettingChange}
        onCancel={() => {
          if (!isSavingSettings) setIsSettingsOpen(false);
        }}
        onSave={handleSaveSettings}
      />
    </>
  );
};

export default TopBar;
