// Chat tab — dashboard assistant: threads, projects, message history. Extracted
// from App.tsx (CODE_ROADMAP Phase 1.2). Prop-driven.
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Button, Dialog, ArtifactPanel } from '../ui';
import { Markdown } from '../Markdown';
import { ChatWelcome, ChatSuggestions, HelpTip, StatusPill, buildChatPromptButtons, formatTime, formatRelativeTime } from '../app-helpers';
import { parseArtifacts, stripArtifacts } from '../app-helpers/artifacts';
import type { ChatArtifact, DashboardState, ChatThread, ChatProject, ChatTurn } from '../app-types';
import type { WorkerDashboardViewDefinition } from '../workers/types';

export interface ChatTabProps {
  dashboard: DashboardState;
  dashboardViews: WorkerDashboardViewDefinition[];
  busyKey: string | null;
  chatDraft: string;
  setChatDraft: Dispatch<SetStateAction<string>>;
  chatTurns: ChatTurn[];
  chatThreads: ChatThread[];
  chatProjects: ChatProject[];
  activeProjectId: string | null;
  setActiveProjectId: Dispatch<SetStateAction<string | null>>;
  activeConversationId: string | null;
  chatArrivingFromOverview: boolean;
  /** Conversation model override; null follows the platform default. */
  chatModelAlias: string | null;
  setChatModelAlias: Dispatch<SetStateAction<string | null>>;
  /** Conversation reasoning override; null follows the platform default. */
  chatReasoningLevel: string | null;
  setChatReasoningLevel: Dispatch<SetStateAction<string | null>>;
  chatQuery: string;
  setChatQuery: Dispatch<SetStateAction<string>>;
  projectComboOpen: boolean;
  setProjectComboOpen: Dispatch<SetStateAction<boolean>>;
  projectComboQuery: string;
  setProjectComboQuery: Dispatch<SetStateAction<string>>;
  projectComboRef: RefObject<HTMLDivElement | null>;
  chatLogRef: RefObject<HTMLDivElement | null>;
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  createChatProject: () => void | Promise<void>;
  renameChatProject: (project: ChatProject) => void | Promise<void>;
  startNewChat: () => void;
  openChatThread: (thread: ChatThread) => void | Promise<void>;
  renameChatThread: (thread: ChatThread) => void | Promise<void>;
  deleteChatThread: (thread: ChatThread) => void | Promise<void>;
  sendDashboardChat: () => void | Promise<void>;
  fillChatDraft: (prompt: string) => void;
  artifacts: ChatArtifact[];
  artifactPanelOpen: boolean;
  setArtifactPanelOpen: Dispatch<SetStateAction<boolean>>;
  artifactPanelPinned: boolean;
  setArtifactPanelPinned: Dispatch<SetStateAction<boolean>>;
  activeArtifactId: string | null;
  setActiveArtifactId: Dispatch<SetStateAction<string | null>>;
  openArtifact: (id: string) => void;
  deleteArtifactFromConversation: (id: string) => void | Promise<void>;
}

export function ChatTab(props: ChatTabProps) {
  const {
    dashboard, dashboardViews, busyKey, chatDraft, setChatDraft, chatTurns, chatThreads,
    chatProjects, activeProjectId, setActiveProjectId, activeConversationId, chatArrivingFromOverview,
    chatModelAlias, setChatModelAlias, chatReasoningLevel, setChatReasoningLevel,
    chatQuery, setChatQuery, projectComboOpen, setProjectComboOpen, projectComboQuery,
    setProjectComboQuery, projectComboRef, chatLogRef, chatInputRef, createChatProject,
    renameChatProject, startNewChat, openChatThread, renameChatThread, deleteChatThread,
    sendDashboardChat, fillChatDraft,
    artifacts, artifactPanelOpen, setArtifactPanelOpen, artifactPanelPinned, setArtifactPanelPinned,
    activeArtifactId, setActiveArtifactId, openArtifact, deleteArtifactFromConversation,
  } = props;
  // This conversation can diverge from the platform default, so everything here that
  // names a model reads the selection rather than `dashboard.defaultModel`.
  const activeModel =
    dashboard.models.find((model) => model.alias === chatModelAlias) ?? dashboard.defaultModel;
  const reasoningLevels = activeModel.reasoningLevels ?? [];
  // Mirrors the backend's `resolveReasoningLevel`: explicit choice, then the platform
  // default, then the vendor's medium/first level.
  const activeReasoningLevel =
    reasoningLevels.find((level) => level === chatReasoningLevel)
    ?? reasoningLevels.find((level) => level === dashboard.defaultReasoningLevel)
    ?? reasoningLevels.find((level) => level === 'medium')
    ?? reasoningLevels[0];
  return (
        <section className={`panel tab-page chat-page${chatArrivingFromOverview ? ' chat-page-arriving' : ''}`}>
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Assistant</p>
              <h2>Dashboard chat <HelpTip>Type naturally to ask about your queue, schedules, or workers — or give plain-language commands. Pick the model and reasoning level right in the composer: the choice sticks to this conversation from the next message on, and leaves the platform default your scheduled jobs use untouched. All messages stay on your machine.</HelpTip></h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {artifacts.length > 0 && (
                <button
                  type="button"
                  className="chat-artifacts-toggle"
                  onClick={() => setArtifactPanelOpen((o) => !o)}
                  title="View artifacts"
                >
                  ⬜ Artifacts {artifacts.length > 1 ? `(${artifacts.length})` : ''}
                </button>
              )}
              <StatusPill tone={
                dashboard.workers.find(
                  (w) => w.kind === 'provider' && w.id.endsWith(`.${activeModel.provider}`)
                )?.healthState === 'healthy' ? 'good' : 'warning'
              }>
                {activeModel.alias}
              </StatusPill>
            </div>
          </div>

          {/* Floating (sheet) artifact panel — only when not pinned */}
          {!artifactPanelPinned && (
            <ArtifactPanel
              open={artifactPanelOpen}
              onOpenChange={setArtifactPanelOpen}
              pinned={false}
              onPinChange={(v) => { setArtifactPanelPinned(v); if (v) setArtifactPanelOpen(false); }}
              artifacts={artifacts}
              activeId={activeArtifactId}
              onSelectId={setActiveArtifactId}
              onDelete={(id) => void deleteArtifactFromConversation(id)}
            />
          )}

          <div className="chat-workspace">
            <aside className="chat-history">
              <p className="sidebar-section-label">Projects</p>
              <div className="chat-history-project" ref={projectComboRef}>
                {(() => {
                  const q = projectComboQuery.toLowerCase();
                  const filteredProjects = chatProjects.filter((p) =>
                    p.name.toLowerCase().includes(q),
                  );
                  const selectedName = activeProjectId
                    ? (chatProjects.find((p) => p.projectId === activeProjectId)?.name ?? '')
                    : 'All chats';
                  return (
                    <div className="project-combobox">
                      <input
                        className="project-combobox-input"
                        type="text"
                        placeholder="Search projects…"
                        title="Scope chats and document search to a project"
                        value={projectComboOpen ? projectComboQuery : selectedName}
                        onFocus={() => {
                          setProjectComboOpen(true);
                          setProjectComboQuery('');
                        }}
                        onChange={(e) => {
                          setProjectComboQuery(e.target.value);
                          setProjectComboOpen(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setProjectComboOpen(false);
                            setProjectComboQuery('');
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                      />
                      {projectComboOpen && (
                        <ul className="project-combobox-dropdown">
                          {'all chats'.includes(q) && (
                            <li
                              className={`project-combobox-option${activeProjectId === null ? ' active' : ''}`}
                              onMouseDown={() => {
                                setActiveProjectId(null);
                                setProjectComboOpen(false);
                                setProjectComboQuery('');
                              }}
                            >
                              All chats
                            </li>
                          )}
                          {filteredProjects.map((p) => (
                            <li
                              key={p.projectId}
                              className={`project-combobox-option${activeProjectId === p.projectId ? ' active' : ''}`}
                            >
                              <span
                                className="project-combobox-option-name"
                                onMouseDown={() => {
                                  setActiveProjectId(p.projectId);
                                  setProjectComboOpen(false);
                                  setProjectComboQuery('');
                                }}
                              >
                                {p.name}
                              </span>
                              <button
                                type="button"
                                className="project-combobox-option-rename"
                                title="Rename project"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  void renameChatProject(p);
                                }}
                              >
                                ✎
                              </button>
                            </li>
                          ))}
                          <li
                            className="project-combobox-option project-combobox-new"
                            onMouseDown={() => {
                              setProjectComboOpen(false);
                              void createChatProject();
                            }}
                          >
                            + New project…
                          </li>
                        </ul>
                      )}
                    </div>
                  );
                })()}
              </div>
              {(() => {
                const filesView = dashboardViews.find((v) => v.kind === 'project-files-sidebar');
                return activeProjectId && filesView
                  ? filesView.render?.({ activeProjectId }) ?? null
                  : null;
              })()}
              <p className="sidebar-section-label">Chats</p>
              <button type="button" className="chat-history-new" onClick={startNewChat}>
                + New chat
              </button>
              {chatThreads.length > 0 && (
                <input
                  className="chat-history-filter"
                  type="search"
                  placeholder="Filter chats…"
                  value={chatQuery}
                  onChange={(e) => setChatQuery(e.target.value)}
                />
              )}
              <div className="chat-history-list">
                {(() => {
                  const q = chatQuery.toLowerCase();
                  const visible = (activeProjectId
                    ? chatThreads.filter((thread) => thread.projectId === activeProjectId)
                    : chatThreads
                  ).filter((thread) => !q || thread.title.toLowerCase().includes(q));
                  if (visible.length === 0) {
                    return <p className="chat-history-empty">No saved chats yet.</p>;
                  }
                  return visible.map((thread) => (
                    <div
                      key={thread.conversationId}
                      className={`chat-history-item${
                        thread.conversationId === activeConversationId ? ' active' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="chat-history-open"
                        onClick={() => void openChatThread(thread)}
                        disabled={busyKey === `open-chat-${thread.conversationId}`}
                      >
                        <span className="chat-history-title">{thread.title}</span>
                        <span className="chat-history-time">{formatRelativeTime(thread.lastMessageAt)}</span>
                      </button>
                      <div className="chat-history-actions">
                        <button type="button" title="Rename" onClick={() => void renameChatThread(thread)}>
                          ✎
                        </button>
                        <button type="button" title="Delete" onClick={() => void deleteChatThread(thread)}>
                          ✕
                        </button>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </aside>

            <div className={`chat-main${artifactPanelPinned && artifacts.length > 0 ? ' chat-main-split' : ''}`}>
          <div className="chat-content">
          <div className="chat-log" ref={chatLogRef}>
            {chatTurns.length === 0 ? (
              <ChatWelcome prompts={buildChatPromptButtons(dashboard)} onSelect={fillChatDraft} />
            ) : null}
            {chatTurns.map((turn, index) => {
              const turnArtifacts = turn.role === 'assistant' ? parseArtifacts(turn.text) : [];
              const prose = turnArtifacts.length > 0 ? stripArtifacts(turn.text) : turn.text;
              return (
                <div className={`chat-turn ${turn.role}`} key={`${turn.createdAt}-${index}`}>
                  <div className="chat-turn-meta">
                    <span className="chat-turn-role">{turn.role === 'user' ? 'You' : 'Assistant'}</span>
                    <span className="chat-turn-time">{formatTime(turn.createdAt)}</span>
                  </div>
                  {turn.role === 'assistant' ? (
                    <>
                      {prose ? <Markdown source={prose} className="chat-turn-body" /> : null}
                      {turnArtifacts.length > 0 && (
                        <div className="chat-turn-artifacts">
                          {turnArtifacts.map((a) => {
                            const savedId = activeConversationId
                              ? `${activeConversationId}:${a.identifier}`
                              : null;
                            return (
                              <button
                                key={a.identifier}
                                type="button"
                                className="chat-artifact-chip"
                                onClick={() => savedId && openArtifact(savedId)}
                              >
                                <span className="chat-artifact-chip-icon">⬜</span>
                                <span className="chat-artifact-chip-title">{a.title}</span>
                                <span className="chat-artifact-chip-type">{a.type}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="chat-turn-body chat-turn-body-user">{turn.text}</div>
                  )}
                </div>
              );
            })}
            {busyKey === 'dashboard-chat' ? (
              <div className="chat-turn assistant chat-turn-pending">
                <div className="chat-turn-meta">
                  <span className="chat-turn-role">Assistant</span>
                  <span className="chat-turn-time">…</span>
                </div>
                <div className="chat-turn-body">
                  <span className="chat-typing"><i /><i /><i /></span>
                </div>
              </div>
            ) : null}
          </div>

          <ChatSuggestions
            prompts={buildChatPromptButtons(dashboard)}
            onSelect={fillChatDraft}
          />

          <form
            className={`chat-composer${chatArrivingFromOverview ? ' chat-composer-arriving' : ''}`}
            onSubmit={(event) => {
              event.preventDefault();
              if (busyKey !== 'dashboard-chat' && chatDraft.trim().length > 0) {
                void sendDashboardChat();
              }
            }}
          >
            <div className="chat-composer-body">
              <textarea
                ref={chatInputRef}
                className="chat-composer-input"
                placeholder="Send a message — ⌘/Ctrl + Enter to send"
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && busyKey !== 'dashboard-chat') {
                    event.preventDefault();
                    void sendDashboardChat();
                  }
                }}
                rows={2}
              />
              <div className="chat-composer-controls">
                <select
                  className="chat-composer-select"
                  value={activeModel.alias}
                  aria-label="Model for this conversation"
                  title="Model used for this conversation — the platform default is left unchanged"
                  onChange={(event) => {
                    setChatModelAlias(event.target.value);
                    // Levels are vendor-specific; let the new model resolve its own.
                    setChatReasoningLevel(null);
                  }}
                >
                  {dashboard.models.length > 0 ? (
                    dashboard.models.map((model) => (
                      <option key={model.alias} value={model.alias}>
                        {model.label}
                      </option>
                    ))
                  ) : (
                    <option value={activeModel.alias}>{activeModel.label}</option>
                  )}
                </select>
                {reasoningLevels.length > 0 && activeReasoningLevel ? (
                  <select
                    className="chat-composer-select"
                    value={activeReasoningLevel}
                    aria-label="Reasoning level for this conversation"
                    title="Reasoning effort for this conversation"
                    onChange={(event) => setChatReasoningLevel(event.target.value)}
                  >
                    {reasoningLevels.map((level) => (
                      <option key={level} value={level}>
                        {level} reasoning
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
            <button
              className="primary chat-composer-send"
              type="submit"
              disabled={busyKey === 'dashboard-chat' || chatDraft.trim().length === 0}
            >
              {busyKey === 'dashboard-chat' ? 'Thinking…' : 'Send'}
            </button>
          </form>
          </div>{/* end chat-content */}

          {/* Pinned artifact panel — inline split */}
          {artifactPanelPinned && artifacts.length > 0 && (
            <ArtifactPanel
              open={true}
              onOpenChange={(v) => { if (!v) { setArtifactPanelPinned(false); setArtifactPanelOpen(false); } }}
              pinned={true}
              onPinChange={(v) => { setArtifactPanelPinned(v); if (!v) setArtifactPanelOpen(false); }}
              artifacts={artifacts}
              activeId={activeArtifactId}
              onSelectId={setActiveArtifactId}
              onDelete={(id) => void deleteArtifactFromConversation(id)}
            />
          )}
            </div>{/* end chat-main */}
          </div>
        </section>
  );
}
