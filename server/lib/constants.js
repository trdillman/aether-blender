const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const RUNS_FILE = path.join(DATA_DIR, 'runs.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'audit.log.jsonl');

const AUDIT_EVENT_TYPES = {
  AUTH_FAILURE: 'auth_failure',
  RPC_COMMAND_BLOCKED: 'rpc_command_blocked',
  EXEC_PYTHON_SAFE_BLOCKED: 'exec_python_safe_blocked',
  GATE_FAILURE: 'gate_failure',
  RUN_TERMINAL_STATE: 'run_terminal_state',
};

const DEFAULT_SETTINGS = {
  apiKeySourceMode: 'env',
  serverApiKey: '',
  blenderPath: 'blender',
  workspacePath: REPO_ROOT,
  addonOutputPath: path.join(REPO_ROOT, 'generated_addons'),
  runMode: 'headless',
  timeoutMs: 120000,
  logVerbosity: 'normal',
  llmProvider: 'anthropic',
  llmModel: 'GLM-4.7',
  llmUseCustomEndpoint: false,
  llmCustomBaseUrl: '',
  llmBaseUrl: 'https://api.z.ai/api/anthropic',
  llmChatPath: '/v1/messages',
  llmApiKeyHeader: 'x-api-key',
  llmApiKeyPrefix: '',
  anthropicVersion: '2023-06-01',
  modelMap: {
    'GLM 4.7': 'GLM-4.7',
    'Claude Sonnet': 'GLM-4.7',
    'Claude Opus': 'GLM-4.7',
  },
};

const TRACE_STEPS = [
  { id: 'planning', label: 'Planning' },
  { id: 'tools', label: 'Tool Calls' },
  { id: 'code', label: 'Code Generation' },
  { id: 'validation', label: 'Validation' },
];

module.exports = {
  DATA_DIR,
  RUNS_FILE,
  SETTINGS_FILE,
  PRESETS_FILE,
  AUDIT_LOG_FILE,
  DEFAULT_SETTINGS,
  REPO_ROOT,
  TRACE_STEPS,
  AUDIT_EVENT_TYPES,
};
