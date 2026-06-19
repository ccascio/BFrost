// Chat tab — dashboard assistant: threads, projects, message history. Extracted
// from App.tsx (CODE_ROADMAP Phase 1.2). Prop-driven.
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Button, Dialog } from '../ui';
import { Markdown } from '../Markdown';
import { ChatWelcome, ChatSuggestions, HelpTip, StatusPill, buildChatPromptButtons, formatTime, formatRelativeTime } from '../app-helpers';
import type { DashboardState, ChatThread, ChatProject, ChatTurn } from '../app-types';
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
}

export function ChatTab(props: ChatTabProps) {
  const {
    dashboard, dashboardViews, busyKey, chatDraft, setChatDraft, chatTurns, chatThreads,
    chatProjects, activeProjectId, setActiveProjectId, activeConversationId, chatArrivingFromOverview,
    chatQuery, setChatQuery, projectComboOpen, setProjectComboOpen, projectComboQuery,
    setProjectComboQuery, projectComboRef, chatLogRef, chatInputRef, createChatProject,
    renameChatProject, startNewChat, openChatThread, renameChatThread, deleteChatThread,
    sendDashboardChat, fillChatDraft,
  } = props;
  return (
        <section className={`panel tab-page chat-page${chatArrivingFromOverview ? ' chat-page-arriving' : ''}`}>
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Assistant</p>
              <h2>Dashboard chat <HelpTip>Type naturally to ask about your queue, schedules, or workers — or give plain-language commands. The assistant uses the same AI model you have configured in Settings. All messages stay on your machine.</HelpTip></h2>
            </div>
            <StatusPill tone={
              dashboard.workers.find(
                (w) => w.kind === 'provider' && w.id.endsWith(`.${dashboard.defaultModel.provider}`)
              )?.healthState === 'healthy' ? 'good' : 'warning'
            }>
              {dashboard.defaultModel.alias}
            </StatusPill>
          </div>

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

            <div className="chat-main">
          <div className="chat-log" ref={chatLogRef}>
            {chatTurns.length === 0 ? (
              <ChatWelcome prompts={buildChatPromptButtons(dashboard)} onSelect={fillChatDraft} />
            ) : null}
            {chatTurns.map((turn, index) => (
              <div className={`chat-turn ${turn.role}`} key={`${turn.createdAt}-${index}`}>
                <div className="chat-turn-meta">
                  <span className="chat-turn-role">{turn.role === 'user' ? 'You' : 'Assistant'}</span>
                  <span className="chat-turn-time">{formatTime(turn.createdAt)}</span>
                </div>
                {turn.role === 'assistant' ? (
                  <Markdown source={turn.text} className="chat-turn-body" />
                ) : (
                  <div className="chat-turn-body chat-turn-body-user">{turn.text}</div>
                )}
              </div>
            ))}
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

          {chatTurns.length > 0 ? (
            <ChatSuggestions
              prompts={buildChatPromptButtons(dashboard)}
              onSelect={fillChatDraft}
            />
          ) : null}

          <form
            className={`chat-composer${chatArrivingFromOverview ? ' chat-composer-arriving' : ''}`}
            onSubmit={(event) => {
              event.preventDefault();
              if (busyKey !== 'dashboard-chat' && chatDraft.trim().length > 0) {
                void sendDashboardChat();
              }
            }}
          >
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
            <button
              className="primary chat-composer-send"
              type="submit"
              disabled={busyKey === 'dashboard-chat' || chatDraft.trim().length === 0}
            >
              {busyKey === 'dashboard-chat' ? 'Thinking…' : 'Send'}
            </button>
          </form>
            </div>
          </div>
        </section>
  );
}
