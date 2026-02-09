import { useMemo } from 'react';
import { AlertTriangle, Shield, X } from 'lucide-react';

const INPUT_BASE_CLASS =
  'w-full rounded-lg border border-white/15 bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]';

const INPUT_ERROR_CLASS = 'border-red-400/60 ring-1 ring-red-500/40';

const fieldClass = (hasError) => `${INPUT_BASE_CLASS} ${hasError ? INPUT_ERROR_CLASS : ''}`;

const ErrorText = ({ children }) =>
  children ? (
    <p role="alert" className="text-[11px] text-red-200">
      {children}
    </p>
  ) : null;

const SettingsModal = ({
  isOpen,
  values,
  isLoading,
  isSaving,
  backendErrors,
  localErrors,
  onChange,
  onCancel,
  onSave,
}) => {
  const hasBackendErrors = useMemo(() => Array.isArray(backendErrors) && backendErrors.length > 0, [backendErrors]);
  const localErrorCount = useMemo(
    () => Object.values(localErrors || {}).filter((value) => Boolean(value)).length,
    [localErrors],
  );
  const hasErrors = hasBackendErrors || localErrorCount > 0;

  if (!isOpen) return null;

  const busy = isLoading || isSaving;
  const providerIsCustom = values.llmUseCustomEndpoint;
  const requiresServerKey = values.apiKeySourceMode === 'server-managed';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6" role="presentation">
      <div
        className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[var(--surface-1)] shadow-2xl shadow-black/30"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 id="settings-title" className="text-base font-semibold text-[var(--text-primary)]">
              Settings
            </h2>
            <p className="text-xs text-[var(--text-muted)]">Configure backend runtime and execution policy.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="rounded-lg border border-white/10 bg-[var(--surface-2)] p-2 text-[var(--text-muted)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          {hasErrors ? (
            <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2">
              <p className="mb-1 text-xs font-medium text-red-200">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                Validation requires fixes before save.
              </p>
              <p className="text-[11px] text-red-100">
                {localErrorCount > 0 ? `${localErrorCount} field issue(s). ` : ''}
                {hasBackendErrors ? `${backendErrors.length} backend issue(s).` : ''}
              </p>
              {hasBackendErrors ? (
                <ul className="mt-1 space-y-1">
                  {backendErrors.map((error) => (
                    <li key={error} className="text-xs text-red-100">
                      {error}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5" htmlFor="settings-llm-provider">
              <span className="text-xs text-[var(--text-secondary)]">Provider</span>
              <select
                id="settings-llm-provider"
                className={fieldClass(Boolean(localErrors?.llmProvider))}
                value={values.llmProvider || 'anthropic'}
                onChange={(e) => onChange('llmProvider', e.target.value)}
                disabled={busy}
                aria-invalid={Boolean(localErrors?.llmProvider)}
              >
                <option value="anthropic">Anthropic-compatible (GLM)</option>
                <option value="openai">OpenAI (GPT-5.2)</option>
                <option value="gemini">Gemini</option>
                <option value="custom">Custom</option>
              </select>
              <ErrorText>{localErrors?.llmProvider}</ErrorText>
            </label>

            <label className="space-y-1.5" htmlFor="settings-api-key-mode">
              <span className="text-xs text-[var(--text-secondary)]">API key source mode</span>
              <select
                id="settings-api-key-mode"
                className={fieldClass(Boolean(localErrors?.apiKeySourceMode))}
                value={values.apiKeySourceMode}
                onChange={(e) => onChange('apiKeySourceMode', e.target.value)}
                disabled={busy}
                aria-invalid={Boolean(localErrors?.apiKeySourceMode)}
              >
                <option value="env">env</option>
                <option value="server-managed">server-managed</option>
              </select>
              <ErrorText>{localErrors?.apiKeySourceMode}</ErrorText>
            </label>
          </div>

          <label className="block space-y-1.5" htmlFor="settings-llm-model">
            <span className="text-xs text-[var(--text-secondary)]">Model</span>
            <input
              id="settings-llm-model"
              className={fieldClass(Boolean(localErrors?.llmModel))}
              type="text"
              value={values.llmModel || ''}
              onChange={(e) => onChange('llmModel', e.target.value)}
              disabled={busy}
              aria-invalid={Boolean(localErrors?.llmModel)}
              placeholder={
                values.llmProvider === 'openai'
                  ? 'gpt-5.2'
                  : values.llmProvider === 'gemini'
                    ? 'gemini-2.5-pro'
                    : 'GLM-4.7'
              }
            />
            <ErrorText>{localErrors?.llmModel}</ErrorText>
          </label>

          <div className="space-y-2">
            <label className="flex items-center gap-2" htmlFor="settings-custom-endpoint">
              <input
                id="settings-custom-endpoint"
                type="checkbox"
                checked={Boolean(values.llmUseCustomEndpoint)}
                onChange={(e) => onChange('llmUseCustomEndpoint', e.target.checked)}
                disabled={busy}
              />
              <span className="text-xs text-[var(--text-secondary)]">Override provider base URL</span>
            </label>

            {providerIsCustom ? (
              <label className="block space-y-1.5" htmlFor="settings-custom-base-url">
                <span className="text-xs text-[var(--text-secondary)]">Custom base URL</span>
                <input
                  id="settings-custom-base-url"
                  className={fieldClass(Boolean(localErrors?.llmCustomBaseUrl))}
                  type="text"
                  value={values.llmCustomBaseUrl || ''}
                  onChange={(e) => onChange('llmCustomBaseUrl', e.target.value)}
                  disabled={busy}
                  aria-invalid={Boolean(localErrors?.llmCustomBaseUrl)}
                  placeholder="https://api.example.com"
                />
                <ErrorText>{localErrors?.llmCustomBaseUrl}</ErrorText>
              </label>
            ) : (
              <div className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-3 py-2">
                <p className="text-[11px] text-[var(--text-muted)]">Resolved base URL</p>
                <p className="text-xs text-[var(--text-secondary)]">{values.llmBaseUrl || '(auto)'}</p>
              </div>
            )}
          </div>

          {requiresServerKey ? (
            <div className="space-y-1.5">
              <label className="block space-y-1.5" htmlFor="settings-server-api-key">
                <span className="text-xs text-[var(--text-secondary)]">Server-managed API key</span>
                <input
                  id="settings-server-api-key"
                  className={fieldClass(Boolean(localErrors?.serverApiKey))}
                  type="password"
                  value={values.serverApiKey || ''}
                  onChange={(e) => onChange('serverApiKey', e.target.value)}
                  disabled={busy}
                  aria-invalid={Boolean(localErrors?.serverApiKey)}
                  placeholder="Enter provider API key"
                />
              </label>
              <ErrorText>{localErrors?.serverApiKey}</ErrorText>
              {values.hasServerApiKey ? (
                <p className="text-[11px] text-[var(--text-muted)]">
                  A key is already stored. Leave blank to keep it unchanged.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-3 py-2">
            <p className="text-xs font-medium text-[var(--text-primary)]">
              <Shield className="mr-1 inline h-3.5 w-3.5 text-cyan-300" />
              Execution policy
            </p>
            <label className="mt-2 flex items-center gap-2" htmlFor="settings-allow-trusted-python">
              <input
                id="settings-allow-trusted-python"
                type="checkbox"
                checked={Boolean(values.allowTrustedPythonExecution)}
                onChange={(e) => onChange('allowTrustedPythonExecution', e.target.checked)}
                disabled={busy}
              />
              <span className="text-xs text-[var(--text-secondary)]">
                Allow trusted Python execution (unsafe, explicit opt-in)
              </span>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5" htmlFor="settings-run-mode">
              <span className="text-xs text-[var(--text-secondary)]">Run mode</span>
              <select
                id="settings-run-mode"
                className={fieldClass(Boolean(localErrors?.runMode))}
                value={values.runMode}
                onChange={(e) => onChange('runMode', e.target.value)}
                disabled={busy}
                aria-invalid={Boolean(localErrors?.runMode)}
              >
                <option value="headless">headless</option>
                <option value="gui">gui</option>
              </select>
              <ErrorText>{localErrors?.runMode}</ErrorText>
            </label>

            <label className="space-y-1.5" htmlFor="settings-log-verbosity">
              <span className="text-xs text-[var(--text-secondary)]">Log verbosity</span>
              <select
                id="settings-log-verbosity"
                className={fieldClass(Boolean(localErrors?.logVerbosity))}
                value={values.logVerbosity}
                onChange={(e) => onChange('logVerbosity', e.target.value)}
                disabled={busy}
                aria-invalid={Boolean(localErrors?.logVerbosity)}
              >
                <option value="quiet">quiet</option>
                <option value="normal">normal</option>
                <option value="verbose">verbose</option>
              </select>
              <ErrorText>{localErrors?.logVerbosity}</ErrorText>
            </label>
          </div>

          <label className="block space-y-1.5" htmlFor="settings-blender-path">
            <span className="text-xs text-[var(--text-secondary)]">Blender executable path</span>
            <input
              id="settings-blender-path"
              className={fieldClass(Boolean(localErrors?.blenderPath))}
              type="text"
              value={values.blenderPath}
              onChange={(e) => onChange('blenderPath', e.target.value)}
              disabled={busy}
              aria-invalid={Boolean(localErrors?.blenderPath)}
              placeholder="blender"
            />
            <ErrorText>{localErrors?.blenderPath}</ErrorText>
          </label>

          <label className="block space-y-1.5" htmlFor="settings-workspace-path">
            <span className="text-xs text-[var(--text-secondary)]">Workspace path</span>
            <input
              id="settings-workspace-path"
              className={fieldClass(Boolean(localErrors?.workspacePath))}
              type="text"
              value={values.workspacePath}
              onChange={(e) => onChange('workspacePath', e.target.value)}
              disabled={busy}
              aria-invalid={Boolean(localErrors?.workspacePath)}
              placeholder="/path/to/workspace"
            />
            <ErrorText>{localErrors?.workspacePath}</ErrorText>
          </label>

          <label className="block space-y-1.5" htmlFor="settings-addon-path">
            <span className="text-xs text-[var(--text-secondary)]">Add-on output path</span>
            <input
              id="settings-addon-path"
              className={fieldClass(Boolean(localErrors?.addonOutputPath))}
              type="text"
              value={values.addonOutputPath}
              onChange={(e) => onChange('addonOutputPath', e.target.value)}
              disabled={busy}
              aria-invalid={Boolean(localErrors?.addonOutputPath)}
              placeholder="/path/to/generated_addons"
            />
            <ErrorText>{localErrors?.addonOutputPath}</ErrorText>
          </label>

          <label className="space-y-1.5" htmlFor="settings-timeout-ms">
            <span className="text-xs text-[var(--text-secondary)]">Timeout (ms)</span>
            <input
              id="settings-timeout-ms"
              className={fieldClass(Boolean(localErrors?.timeoutMs))}
              type="number"
              min="1000"
              step="1000"
              value={values.timeoutMs}
              onChange={(e) => onChange('timeoutMs', e.target.value)}
              disabled={busy}
              aria-invalid={Boolean(localErrors?.timeoutMs)}
            />
            <ErrorText>{localErrors?.timeoutMs}</ErrorText>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-5 py-4">
          <p className="text-[11px] text-[var(--text-muted)]" aria-live="polite">
            {isSaving ? 'Saving settings...' : hasErrors ? 'Resolve validation issues to save.' : 'Ready to save.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-white/15 bg-[var(--surface-2)] px-3 py-1.5 text-sm text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              className="rounded-lg bg-cyan-400 px-3 py-1.5 text-sm font-medium text-slate-950 transition enabled:hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={busy || hasErrors}
              aria-disabled={busy || hasErrors}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
