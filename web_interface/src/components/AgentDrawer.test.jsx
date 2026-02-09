import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import AgentDrawer from './AgentDrawer';

const baseProps = {
  drawerOpen: true,
  setDrawerOpen: vi.fn(),
  trace: [
    { id: 'planning', label: 'Planning', status: 'idle', detail: 'Waiting for prompt.', duration: null },
    { id: 'tools', label: 'Tool Calls', status: 'idle', detail: 'No tool calls yet.', duration: null },
  ],
  expandedTraceId: 'planning',
  setExpandedTraceId: vi.fn(),
  runStatus: 'idle',
  activeRun: null,
  presets: [],
  presetsBusy: false,
  onCreatePreset: vi.fn(),
  onDeletePreset: vi.fn(),
  onExportPreset: vi.fn(),
  onImportPresetFile: vi.fn(),
  onLoadPreset: vi.fn(),
};

describe('AgentDrawer', () => {
  it('shows timeline details and toggles trace expansion', async () => {
    const user = userEvent.setup();
    const setExpandedTraceId = vi.fn();
    render(<AgentDrawer {...baseProps} setExpandedTraceId={setExpandedTraceId} />);

    expect(screen.getByText('Run status')).toBeInTheDocument();
    expect(screen.getByText('Duration: pending')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /planning/i }));
    expect(setExpandedTraceId).toHaveBeenCalled();
  });

  it('blocks preset creation when active run has no protocol payload', async () => {
    const user = userEvent.setup();
    render(<AgentDrawer {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /presets/i }));
    expect(screen.getByText(/run must include protocol data/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });
});
