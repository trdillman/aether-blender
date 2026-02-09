import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import TopBar from './TopBar';
import * as apiClient from '../lib/apiClient';

vi.mock('../lib/apiClient', () => ({
  fetchSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

const renderTopBar = () =>
  render(
    <TopBar
      model="GLM 4.7"
      setModel={vi.fn()}
      modelOptions={['GLM 4.7', 'Claude Sonnet']}
      statusLabel="Ready"
      blenderBridgeStatusText="Blender bridge: offline"
      onLaunchBlender={vi.fn()}
      onStopBlender={vi.fn()}
      onTestBridge={vi.fn()}
      blenderSessionActive={false}
      blenderSessionBusy={false}
    />,
  );

describe('TopBar + SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads settings and blocks save when local validation fails', async () => {
    const user = userEvent.setup();
    apiClient.fetchSettings.mockResolvedValue({
      workspacePath: '',
      addonOutputPath: '',
      blenderPath: '',
      timeoutMs: 500,
      llmModel: '',
    });

    renderTopBar();
    await user.click(screen.getByRole('button', { name: /open settings/i }));

    expect(await screen.findByRole('dialog', { name: /settings/i })).toBeInTheDocument();
    expect(await screen.findByText(/validation requires fixes before save/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });
});
