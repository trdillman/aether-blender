import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import Composer from './Composer';

describe('Composer', () => {
  it('submits with Enter and does not submit with Shift+Enter', async () => {
    const user = userEvent.setup();
    const setInput = vi.fn();
    const onSubmit = vi.fn();

    render(<Composer input="Build an addon" setInput={setInput} isRunning={false} onSubmit={onSubmit} />);

    const textbox = screen.getByLabelText('Chat message input');
    await user.type(textbox, '{Shift>}{Enter}{/Shift}');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(textbox, '{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('Build an addon');
  });

  it('invokes stop when active run is in progress', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();

    render(<Composer input="" setInput={vi.fn()} isRunning onSubmit={vi.fn()} onStop={onStop} />);

    await user.click(screen.getByRole('button', { name: /stop current run/i }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
