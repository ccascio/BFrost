import { useState } from 'react';
import type { ChatPromptButton, DashboardState } from '../app-types';
import { CORE_CHAT_PROMPTS } from '../app-types';

export function buildChatPromptButtons(dashboard: DashboardState): ChatPromptButton[] {
  const core = CORE_CHAT_PROMPTS.map((prompt) => ({
    ...prompt,
    id: `core:${prompt.label}`,
  }));
  const workerPrompts = dashboard.workers
    .filter((worker) => worker.enabled && !worker.missing)
    .flatMap((worker) =>
      (worker.chatPrompts ?? []).map((prompt) => ({
        ...prompt,
        id: `${worker.id}:${prompt.label}`,
        source: worker.displayName ?? worker.name,
      })),
    );
  return [...core, ...workerPrompts];
}

export function ChatWelcome({
  prompts,
  onSelect,
}: {
  prompts: ChatPromptButton[];
  onSelect: (prompt: string) => void;
}) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredPrompts = normalizedQuery
    ? prompts.filter((example) =>
        [
          example.label,
          example.description,
          example.source ?? '',
          example.prompt,
        ].some((value) => value.toLowerCase().includes(normalizedQuery)),
      )
    : prompts;

  return (
    <div className="chat-empty" role="note">
      <p className="chat-empty-kicker">Welcome to dashboard chat</p>
      <h3>Ask freely, or hand work to a worker.</h3>
      <p>
        Ask open questions about BFrost, your queue, your schedules, or your models - or ask a worker
        to do something, in plain language.
      </p>
      <p className="footnote" style={{ marginTop: '0.75rem' }}>
        Try one of these:
      </p>
      <div className="chat-prompt-search">
        <input
          type="search"
          aria-label="Filter example requests"
          placeholder="Filter example requests"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span>{filteredPrompts.length} shown</span>
      </div>
      <div className="chat-empty-prompts">
        {filteredPrompts.map((example, index) => (
          <button
            key={example.id}
            type="button"
            className="chat-empty-prompt"
            title={example.prompt}
            style={{ animationDelay: `${Math.min(index, 18) * 32}ms` }}
            onClick={() => onSelect(example.prompt)}
          >
            <span>{example.label}</span>
            <small>{example.source ? `${example.source}: ${example.description}` : example.description}</small>
          </button>
        ))}
        {filteredPrompts.length === 0 ? (
          <p className="empty-state chat-prompt-empty">No matching example requests.</p>
        ) : null}
      </div>
    </div>
  );
}

export function ChatSuggestions({
  prompts,
  onSelect,
}: {
  prompts: ChatPromptButton[];
  onSelect: (prompt: string) => void;
}) {
  const chips = prompts.slice(0, 4);
  if (chips.length === 0) return null;
  return (
    <div className="chat-suggestions" aria-label="Quick prompts">
      {chips.map((p) => (
        <button
          key={p.id}
          type="button"
          className="chat-suggestion-chip"
          title={p.prompt}
          onClick={() => onSelect(p.prompt)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
