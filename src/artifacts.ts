import { loadKvJson, saveKvJson } from './sqlite';

export interface ArtifactVersion {
  content: string;
  messageId: string;
  createdAt: string;
}

export interface StoredArtifact {
  id: string;
  conversationId: string;
  messageId: string;
  identifier: string;
  type: string;
  title: string;
  content: string;           // always the latest version's content
  versions: ArtifactVersion[]; // full history, oldest → newest
  createdAt: string;
  updatedAt: string;
}

function kvKey(conversationId: string): string {
  return `artifacts.${conversationId}`;
}

export async function listArtifacts(conversationId: string): Promise<StoredArtifact[]> {
  const stored = await loadKvJson<StoredArtifact[]>(kvKey(conversationId));
  return stored ?? [];
}

export async function upsertArtifact(
  conversationId: string,
  artifact: Omit<StoredArtifact, 'conversationId' | 'createdAt' | 'updatedAt' | 'versions'>,
): Promise<StoredArtifact> {
  const all = await listArtifacts(conversationId);
  const now = new Date().toISOString();
  const existing = all.find((a) => a.id === artifact.id);

  let updated: StoredArtifact;
  if (!existing) {
    // First time we see this artifact — start version history
    const firstVersion: ArtifactVersion = {
      content: artifact.content,
      messageId: artifact.messageId,
      createdAt: now,
    };
    updated = { ...artifact, conversationId, versions: [firstVersion], createdAt: now, updatedAt: now };
  } else if (existing.content !== artifact.content) {
    // Content changed — push a new version
    const newVersion: ArtifactVersion = {
      content: artifact.content,
      messageId: artifact.messageId,
      createdAt: now,
    };
    updated = {
      ...existing,
      ...artifact,
      conversationId,
      versions: [...(existing.versions ?? [{ content: existing.content, messageId: existing.messageId, createdAt: existing.createdAt }]), newVersion],
      updatedAt: now,
    };
  } else {
    // Same content — no new version, just refresh metadata
    updated = { ...existing, ...artifact, conversationId, updatedAt: now };
  }

  const next = existing
    ? all.map((a) => (a.id === artifact.id ? updated : a))
    : [...all, updated];
  await saveKvJson(kvKey(conversationId), next);
  return updated;
}

export async function deleteArtifact(conversationId: string, artifactId: string): Promise<void> {
  const all = await listArtifacts(conversationId);
  await saveKvJson(kvKey(conversationId), all.filter((a) => a.id !== artifactId));
}
