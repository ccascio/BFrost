import { useEffect, useRef, useState } from 'react';
import type { ChatArtifact, ChatProject, ChatThread, ChatTurn, DashboardState, DashboardTab } from '../app-types';
import { toAppError } from '../app-types';
import { parseArtifacts, fetchArtifacts, saveArtifact, removeArtifact } from '../app-helpers/artifacts';

export function useChatController({
  activeTab,
  setActiveTab,
  busyKey,
  setBusyKey,
  setError,
  setNotice,
  fetchDashboard,
}: {
  activeTab: DashboardTab;
  setActiveTab: (tab: DashboardTab) => void;
  busyKey: string | null;
  setBusyKey: (key: string | null) => void;
  setError: (error: ReturnType<typeof toAppError> | null) => void;
  setNotice: (notice: string) => void;
  fetchDashboard: (preserveDrafts: boolean) => Promise<void>;
}) {
  const [chatDraft, setChatDraft] = useState('');
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [chatProjects, setChatProjects] = useState<ChatProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [chatArrivingFromOverview, setChatArrivingFromOverview] = useState(false);
  const [chatQuery, setChatQuery] = useState('');
  const [projectComboOpen, setProjectComboOpen] = useState(false);
  const [projectComboQuery, setProjectComboQuery] = useState('');
  const [artifacts, setArtifacts] = useState<ChatArtifact[]>([]);
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [artifactPanelPinned, setArtifactPanelPinned] = useState(false);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const projectComboRef = useRef<HTMLDivElement | null>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = chatLogRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatTurns.length, busyKey === 'dashboard-chat']);

  useEffect(() => {
    if (activeTab !== 'chat') return;
    void loadChatThreads();
    void loadChatProjects();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'chat' || !chatArrivingFromOverview) return;
    const focusTimer = window.setTimeout(() => chatInputRef.current?.focus(), 120);
    const animationTimer = window.setTimeout(() => setChatArrivingFromOverview(false), 720);
    return () => {
      window.clearTimeout(focusTimer);
      window.clearTimeout(animationTimer);
    };
  }, [activeTab, chatArrivingFromOverview]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (projectComboRef.current && !projectComboRef.current.contains(e.target as Node)) {
        setProjectComboOpen(false);
        setProjectComboQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function mintConversationId(): string {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `dashboard-${id}`;
  }

  async function loadChatThreads() {
    try {
      const response = await fetch('/api/chats', { credentials: 'include' });
      if (!response.ok) return;
      const payload = (await response.json()) as { threads: ChatThread[] };
      setChatThreads(payload.threads ?? []);
    } catch {
      // best-effort
    }
  }

  async function loadChatProjects() {
    try {
      const response = await fetch('/api/projects', { credentials: 'include' });
      if (!response.ok) return;
      const payload = (await response.json()) as { projects: ChatProject[] };
      setChatProjects(payload.projects ?? []);
    } catch {
      // best-effort
    }
  }

  async function createChatProject() {
    const name = window.prompt('New project name')?.trim();
    if (!name) return;
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error('Failed to create project');
      const { project } = (await response.json()) as { project: ChatProject };
      await loadChatProjects();
      setActiveProjectId(project.projectId);
      startNewChat();
    } catch (err) {
      setError(toAppError(err));
    }
  }

  function startNewChat() {
    setActiveConversationId(mintConversationId());
    setChatTurns([]);
    setArtifacts([]);
    setArtifactPanelOpen(false);
    setActiveArtifactId(null);
    // keep pinned state — user intent persists across conversations
    setError(null);
    window.requestAnimationFrame(() => chatInputRef.current?.focus());
  }

  async function openChatThread(thread: ChatThread) {
    setBusyKey(`open-chat-${thread.conversationId}`);
    setError(null);
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(thread.conversationId)}`, {
        credentials: 'include',
      });
      const payload = (await response.json()) as
        | { thread: ChatThread; turns: { role: 'user' | 'assistant'; text: string }[] }
        | { error: string };
      if (!response.ok || 'error' in payload) {
        throw new Error('error' in payload ? payload.error : 'Failed to open chat');
      }
      setActiveConversationId(thread.conversationId);
      setActiveProjectId(thread.projectId ?? null);
      setChatTurns(payload.turns.map((turn) => ({ ...turn, createdAt: thread.lastMessageAt })));
      const savedArtifacts = await fetchArtifacts(thread.conversationId);
      setArtifacts(savedArtifacts);
      setArtifactPanelOpen(false);
      setActiveArtifactId(savedArtifacts[0]?.id ?? null);
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function renameChatThread(thread: ChatThread) {
    const title = window.prompt('Rename chat', thread.title)?.trim();
    if (!title || title === thread.title) return;
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(thread.conversationId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error('Rename failed');
      await loadChatThreads();
    } catch (err) {
      setError(toAppError(err));
    }
  }

  async function renameChatProject(project: ChatProject) {
    const name = window.prompt('Rename project', project.name)?.trim();
    if (!name || name === project.name) return;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.projectId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error('Rename failed');
      await loadChatProjects();
    } catch (err) {
      setError(toAppError(err));
    }
  }

  async function deleteChatThread(thread: ChatThread) {
    if (!window.confirm(`Delete chat "${thread.title}"? This cannot be undone.`)) return;
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(thread.conversationId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Delete failed');
      if (activeConversationId === thread.conversationId) {
        setActiveConversationId(null);
        setChatTurns([]);
      }
      await loadChatThreads();
    } catch (err) {
      setError(toAppError(err));
    }
  }

  async function sendDashboardChat() {
    const message = chatDraft.trim();
    if (!message) return;

    const conversationId = activeConversationId ?? mintConversationId();
    if (!activeConversationId) setActiveConversationId(conversationId);

    const userTurn: ChatTurn = { role: 'user', text: message, createdAt: new Date().toISOString() };
    setChatTurns((current) => [...current, userTurn]);
    setChatDraft('');
    setBusyKey('dashboard-chat');
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, conversationId, projectId: activeProjectId ?? undefined }),
      });
      const payload = (await response.json()) as { response: string; dashboard: DashboardState } | { error: string };
      if (!response.ok || 'error' in payload) {
        throw new Error('error' in payload ? payload.error : 'Chat request failed');
      }

      const assistantCreatedAt = new Date().toISOString();
      setChatTurns((current) => [
        ...current,
        { role: 'assistant', text: payload.response, createdAt: assistantCreatedAt },
      ]);

      // Parse and persist any artifacts in the response
      const parsed = parseArtifacts(payload.response);
      if (parsed.length > 0) {
        const messageId = `${conversationId}:${assistantCreatedAt}`;
        const saved: ChatArtifact[] = [];
        for (const p of parsed) {
          const id = `${conversationId}:${p.identifier}`;
          const artifact = await saveArtifact(conversationId, {
            id,
            messageId,
            identifier: p.identifier,
            type: p.type,
            title: p.title,
            content: p.content,
          });
          if (artifact) saved.push(artifact);
        }
        if (saved.length > 0) {
          setArtifacts((prev) => {
            const ids = new Set(saved.map((a) => a.id));
            return [...prev.filter((a) => !ids.has(a.id)), ...saved];
          });
          setActiveArtifactId(saved[saved.length - 1].id);
          setArtifactPanelOpen(true);
        }
      }

      await fetchDashboard(true);
      await loadChatThreads();
      setNotice('Dashboard chat answered.');
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteArtifactFromConversation(artifactId: string) {
    const conversationId = activeConversationId;
    if (!conversationId) return;
    await removeArtifact(conversationId, artifactId);
    setArtifacts((prev) => {
      const next = prev.filter((a) => a.id !== artifactId);
      if (activeArtifactId === artifactId) {
        setActiveArtifactId(next[next.length - 1]?.id ?? null);
      }
      if (next.length === 0) setArtifactPanelOpen(false);
      return next;
    });
  }

  function openArtifact(id: string) {
    setActiveArtifactId(id);
    setArtifactPanelOpen(true);
  }

  function fillChatDraft(prompt: string) {
    setChatDraft(prompt);
    window.requestAnimationFrame(() => chatInputRef.current?.focus());
  }

  function openChatFromOverview() {
    setChatArrivingFromOverview(true);
    setActiveTab('chat');
  }

  return {
    chatDraft,
    setChatDraft,
    chatTurns,
    chatThreads,
    chatProjects,
    activeProjectId,
    setActiveProjectId,
    activeConversationId,
    chatArrivingFromOverview,
    chatQuery,
    setChatQuery,
    projectComboOpen,
    setProjectComboOpen,
    projectComboQuery,
    setProjectComboQuery,
    projectComboRef,
    chatLogRef,
    chatInputRef,
    createChatProject,
    renameChatProject,
    startNewChat,
    openChatThread,
    renameChatThread,
    deleteChatThread,
    sendDashboardChat,
    fillChatDraft,
    openChatFromOverview,
    artifacts,
    artifactPanelOpen,
    setArtifactPanelOpen,
    artifactPanelPinned,
    setArtifactPanelPinned,
    activeArtifactId,
    setActiveArtifactId,
    openArtifact,
    deleteArtifactFromConversation,
  };
}
