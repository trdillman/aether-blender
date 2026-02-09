import React from 'react';
import { Bot, User } from 'lucide-react';

const MessageList = ({ messages, isRunning, starterPrompts = [], onSelectStarter }) => {
  const isOnlyWelcome = messages.length === 1;
  const lastMessageId = messages[messages.length - 1]?.id;

  return (
    <>
      {isOnlyWelcome && (
        <div className="rounded-xl border border-dashed border-white/15 bg-[var(--surface-2)]/60 p-4">
          <p className="mb-3 text-sm text-[var(--text-secondary)]">Try one of these prompts:</p>
          <div className="flex flex-wrap gap-2">
            {starterPrompts.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => onSelectStarter?.(suggestion)}
                className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] transition hover:border-cyan-300/40 hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                aria-label={`Use starter prompt: ${suggestion}`}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((message) => (
        <article key={message.id} className="flex gap-3" aria-label={`${message.role} message`}>
          <div
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              message.role === 'assistant' ? 'bg-cyan-400/15 text-cyan-300' : 'bg-indigo-400/15 text-indigo-300'
            }`}
          >
            {message.role === 'assistant' ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <p className="text-xs font-medium text-[var(--text-primary)]">
                {message.role === 'assistant' ? 'Aether' : 'You'}
              </p>
              <span className="text-[11px] text-[var(--text-muted)]">{message.time}</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-sm leading-6 text-[var(--text-secondary)] whitespace-pre-wrap">
              {message.content}
              {isRunning && message.id === lastMessageId && message.role === 'assistant' && (
                <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded bg-cyan-300" />
              )}
            </div>
          </div>
        </article>
      ))}
    </>
  );
};

export default MessageList;
