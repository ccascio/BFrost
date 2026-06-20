import { useState, useCallback } from 'react';
import type { ChatPromptButton, DashboardState } from '../app-types';
import { CORE_CHAT_PROMPTS } from '../app-types';
import { Dialog } from '../ui';

const TEMPLATES_STORAGE_KEY = 'bfrost:chat-templates';

export interface PromptTemplate {
  id: string;
  label: string;
  prompt: string;
}

function loadTemplates(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PromptTemplate[]) : [];
  } catch {
    return [];
  }
}

function saveTemplates(templates: PromptTemplate[]): void {
  localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
}

export function usePromptTemplates() {
  const [templates, setTemplates] = useState<PromptTemplate[]>(loadTemplates);

  const addTemplate = useCallback((label: string, prompt: string) => {
    const next = [...loadTemplates(), { id: crypto.randomUUID(), label, prompt }];
    saveTemplates(next);
    setTemplates(next);
  }, []);

  const updateTemplate = useCallback((id: string, label: string, prompt: string) => {
    const next = loadTemplates().map((t) => (t.id === id ? { ...t, label, prompt } : t));
    saveTemplates(next);
    setTemplates(next);
  }, []);

  const deleteTemplate = useCallback((id: string) => {
    const next = loadTemplates().filter((t) => t.id !== id);
    saveTemplates(next);
    setTemplates(next);
  }, []);

  return { templates, addTemplate, updateTemplate, deleteTemplate };
}

type ModalMode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; template: PromptTemplate };

export function PromptTemplatesModal({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (prompt: string) => void;
}) {
  const { templates, addTemplate, updateTemplate, deleteTemplate } = usePromptTemplates();
  const [mode, setMode] = useState<ModalMode>({ kind: 'list' });
  const [draftLabel, setDraftLabel] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');

  function openCreate() {
    setDraftLabel('');
    setDraftPrompt('');
    setMode({ kind: 'create' });
  }

  function openEdit(t: PromptTemplate) {
    setDraftLabel(t.label);
    setDraftPrompt(t.prompt);
    setMode({ kind: 'edit', template: t });
  }

  function handleSave() {
    if (!draftLabel.trim() || !draftPrompt.trim()) return;
    if (mode.kind === 'create') {
      addTemplate(draftLabel.trim(), draftPrompt.trim());
    } else if (mode.kind === 'edit') {
      updateTemplate(mode.template.id, draftLabel.trim(), draftPrompt.trim());
    }
    setMode({ kind: 'list' });
  }

  function handleSelect(prompt: string) {
    onSelect(prompt);
    onOpenChange(false);
  }

  function handleClose() {
    setMode({ kind: 'list' });
    onOpenChange(false);
  }

  const isForm = mode.kind === 'create' || mode.kind === 'edit';

  return (
    <Dialog
      open={open}
      onOpenChange={handleClose}
      title={
        isForm
          ? mode.kind === 'create'
            ? 'New template'
            : 'Edit template'
          : 'Prompt templates'
      }
      description={
        !isForm
          ? 'Save frequently used prompts. Click one to fill the chat input.'
          : undefined
      }
      footer={
        isForm ? (
          <div className="pt-form-actions">
            <button type="button" className="ui-button ui-button-default ui-button-sm" onClick={() => setMode({ kind: 'list' })}>
              Cancel
            </button>
            <button
              type="button"
              className="ui-button ui-button-primary ui-button-sm"
              onClick={handleSave}
              disabled={!draftLabel.trim() || !draftPrompt.trim()}
            >
              Save template
            </button>
          </div>
        ) : (
          <div className="pt-form-actions">
            <button type="button" className="ui-button ui-button-default ui-button-sm" onClick={openCreate}>
              + New template
            </button>
          </div>
        )
      }
    >
      {isForm ? (
        <div className="pt-form">
          <label className="pt-field">
            <span className="pt-field-label">Label</span>
            <input
              className="pt-field-input"
              type="text"
              placeholder="e.g. Summarize recent failures"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
            />
          </label>
          <label className="pt-field">
            <span className="pt-field-label">Prompt text</span>
            <textarea
              className="pt-field-input pt-field-textarea"
              placeholder="Enter the full prompt text…"
              rows={4}
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
            />
          </label>
        </div>
      ) : templates.length === 0 ? (
        <p className="pt-empty">No templates yet. Create one to get started.</p>
      ) : (
        <ul className="pt-list">
          {templates.map((t) => (
            <li key={t.id} className="pt-item">
              <button
                type="button"
                className="pt-item-body"
                onClick={() => handleSelect(t.prompt)}
                title={t.prompt}
              >
                <span className="pt-item-label">{t.label}</span>
                <span className="pt-item-prompt">{t.prompt}</span>
              </button>
              <div className="pt-item-actions">
                <button type="button" className="pt-item-action" title="Edit" onClick={() => openEdit(t)}>
                  ✎
                </button>
                <button type="button" className="pt-item-action pt-item-action-delete" title="Delete" onClick={() => deleteTemplate(t.id)}>
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

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
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const chips = prompts.slice(0, 4);
  return (
    <div className="chat-suggestions" aria-label="Quick prompts">
      <button
        type="button"
        className="chat-suggestion-chip chat-suggestion-templates-btn"
        title="Manage prompt templates"
        onClick={() => setTemplatesOpen(true)}
      >
        Templates
      </button>
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
      <PromptTemplatesModal
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onSelect={onSelect}
      />
    </div>
  );
}
