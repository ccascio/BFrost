import { randomUUID } from 'crypto';
import { loadKvJson, saveKvJsonSync } from './sqlite';

/**
 * Generic project registry. A project is a named grouping that chat threads and
 * worker-owned resources (e.g. uploaded documents) can be scoped to. Core knows
 * only the grouping — it never learns what a worker stores against a projectId.
 *
 * Cleanup of worker-owned data on project deletion is deliberately *not* an
 * event/subscription here: retrieval is always scoped by a live projectId, so a
 * deleted project's rows are simply never queried. Workers reconcile orphans
 * lazily against {@link listProjectIds} (on enable / after writes). This keeps
 * the SDK surface to plain functions rather than a pub/sub commitment.
 */

const PROJECTS_STORE_KEY = 'assistant.projects';
const MAX_NAME_LENGTH = 80;

export interface Project {
  projectId: string;
  name: string;
  createdAt: string;
}

interface PersistedProjectStore {
  version: 1;
  projects: Project[];
}

const projects = new Map<string, Project>();

export async function hydrateProjects(): Promise<void> {
  projects.clear();
  const stored = await loadKvJson<Partial<PersistedProjectStore>>(PROJECTS_STORE_KEY);
  for (const project of stored?.projects ?? []) {
    if (typeof project?.projectId === 'string' && typeof project.name === 'string') {
      projects.set(project.projectId, {
        projectId: project.projectId,
        name: project.name,
        createdAt: project.createdAt ?? new Date().toISOString(),
      });
    }
  }
}

export async function flushProjects(): Promise<void> {
  // Writes are synchronous; nothing to flush.
}

export function listProjects(): Project[] {
  return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Live project ids — workers use this to reconcile and drop orphaned resources. */
export function listProjectIds(): string[] {
  return [...projects.keys()];
}

export function getProject(projectId: string): Project | undefined {
  return projects.get(projectId);
}

export function createProject(name: string): Project {
  const project: Project = {
    projectId: `proj-${randomUUID()}`,
    name: clampName(name) || 'Untitled project',
    createdAt: new Date().toISOString(),
  };
  projects.set(project.projectId, project);
  schedulePersist();
  return project;
}

export function renameProject(projectId: string, name: string): Project | undefined {
  const project = projects.get(projectId);
  if (!project) return undefined;
  project.name = clampName(name) || project.name;
  schedulePersist();
  return project;
}

export function deleteProject(projectId: string): boolean {
  const removed = projects.delete(projectId);
  if (removed) schedulePersist();
  return removed;
}

function clampName(name: string): string {
  const cleaned = name.replace(/\s+/g, ' ').trim();
  return cleaned.length > MAX_NAME_LENGTH ? cleaned.slice(0, MAX_NAME_LENGTH) : cleaned;
}

function schedulePersist(): void {
  try {
    saveKvJsonSync(PROJECTS_STORE_KEY, { version: 1, projects: [...projects.values()] });
  } catch (err) {
    console.warn('[Projects] Failed to persist project registry:', err);
  }
}
