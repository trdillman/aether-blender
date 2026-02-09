import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from '../App';
import * as apiClient from '../lib/apiClient';

vi.mock('../lib/apiClient', () => ({
  cancelRun: vi.fn(),
  createPreset: vi.fn(),
  deletePreset: vi.fn(),
  executeActiveBlenderRpc: vi.fn(),
  fetchActiveBlenderSession: vi.fn(),
  fetchPresetById: vi.fn(),
  fetchPresets: vi.fn(),
  fetchRunById: vi.fn(),
  fetchRuns: vi.fn(),
  launchBlenderSession: vi.fn(),
  startRun: vi.fn(),
  stopBlenderSession: vi.fn(),
  subscribeBlenderSessionStream: vi.fn(() => ({ close: vi.fn() })),
  subscribeRunStream: vi.fn(() => ({ close: vi.fn() })),
}));

const configureDefaultApi = () => {
  apiClient.fetchRuns.mockResolvedValue([]);
  apiClient.fetchActiveBlenderSession.mockResolvedValue(null);
  apiClient.fetchPresets.mockResolvedValue([]);
  apiClient.fetchRunById.mockResolvedValue(null);
  apiClient.startRun.mockResolvedValue({
    id: 'run-1',
    status: 'running',
    prompt: 'test',
    model: 'GLM 4.7',
    createdAt: '2026-02-09T00:00:00.000Z',
    updatedAt: '2026-02-09T00:00:00.000Z',
  });
};

describe('Regression Pack (TST-015)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureDefaultApi();
  });

  it('BUG-UI-001: surfaces run-history bootstrap errors instead of failing silently', async () => {
    apiClient.fetchRuns.mockRejectedValueOnce(new Error('backend unavailable'));

    render(<App />);

    expect(await screen.findByText(/failed to load run history: backend unavailable/i)).toBeInTheDocument();
  });

  it('BUG-UI-002: clear-chat is blocked while a run is active', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText('Chat message input'), 'Build test addon');
    await user.click(screen.getByRole('button', { name: /send message/i }));

    await waitFor(() => expect(apiClient.startRun).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    expect(screen.getByText(/stop the active run before clearing the conversation/i)).toBeInTheDocument();
    expect(screen.getByText('Build test addon')).toBeInTheDocument();
  });
});
