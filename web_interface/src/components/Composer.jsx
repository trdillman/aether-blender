import React, { useEffect, useRef } from 'react';
import { Paperclip, SendHorizonal, Square } from 'lucide-react';

const Composer = ({ input, setInput, isRunning, onSubmit, onStop, onAttach }) => {
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [input]);

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (isRunning) {
        onStop?.();
        return;
      }

      if (input.trim()) {
        onSubmit?.(input);
      }
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[var(--surface-2)] p-3 shadow-inner shadow-black/20">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message Aether..."
        className="max-h-56 min-h-[44px] w-full resize-none bg-transparent px-1 text-sm leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus-visible:ring-2 focus-visible:ring-cyan-400/60"
        aria-label="Chat message input"
      />
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onAttach?.()}
            className="rounded-lg border border-white/10 bg-black/20 p-2 text-[var(--text-muted)] transition hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-cyan-400/60"
            aria-label="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <span className="text-xs text-[var(--text-muted)]">Enter to send, Shift+Enter for newline</span>
        </div>
        <button
          onClick={() => {
            if (isRunning) {
              onStop?.();
              return;
            }
            onSubmit?.(input);
          }}
          disabled={!isRunning && !input.trim()}
          className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 transition enabled:hover:bg-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-45"
          aria-label={isRunning ? 'Stop current run' : 'Send message'}
          aria-pressed={isRunning}
        >
          {isRunning ? (
            <span className="inline-flex items-center gap-1.5">
              <Square className="h-3.5 w-3.5" /> Stop
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <SendHorizonal className="h-3.5 w-3.5" /> Send
            </span>
          )}
        </button>
      </div>
    </div>
  );
};

export default Composer;
