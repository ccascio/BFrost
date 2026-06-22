import type { ChatArtifact } from '../app-types';

export interface ParsedArtifact {
  identifier: string;
  type: string;
  title: string;
  content: string;
  /** The full matched block, used to strip it from the displayed markdown. */
  raw: string;
}

const ARTIFACT_RE =
  /:::artifact\{([^}]*)\}\s*\n```[^\n]*\n([\s\S]*?)```\s*\n:::/g;

function parseAttrs(attrStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    result[m[1]] = m[2];
  }
  return result;
}

export function parseArtifacts(text: string): ParsedArtifact[] {
  const artifacts: ParsedArtifact[] = [];
  ARTIFACT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ARTIFACT_RE.exec(text)) !== null) {
    const attrs = parseAttrs(m[1]);
    artifacts.push({
      identifier: attrs.identifier ?? 'artifact',
      type: attrs.type ?? 'text/plain',
      title: attrs.title ?? 'Artifact',
      content: m[2],
      raw: m[0],
    });
  }
  return artifacts;
}

/** Strip artifact blocks from markdown so the chat turn only shows prose. */
export function stripArtifacts(text: string): string {
  ARTIFACT_RE.lastIndex = 0;
  return text.replace(ARTIFACT_RE, '').trim();
}

// ── API helpers ──────────────────────────────────────────────────────────────

export async function fetchArtifacts(conversationId: string): Promise<ChatArtifact[]> {
  const res = await fetch(`/api/artifacts/${encodeURIComponent(conversationId)}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { artifacts: ChatArtifact[] };
  return data.artifacts ?? [];
}

export async function saveArtifact(
  conversationId: string,
  artifact: Omit<ChatArtifact, 'conversationId' | 'createdAt' | 'updatedAt' | 'versions'>,
): Promise<ChatArtifact | null> {
  const res = await fetch(`/api/artifacts/${encodeURIComponent(conversationId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(artifact),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { artifact: ChatArtifact };
  return data.artifact;
}

export async function removeArtifact(
  conversationId: string,
  artifactId: string,
): Promise<void> {
  await fetch(
    `/api/artifacts/${encodeURIComponent(conversationId)}/${encodeURIComponent(artifactId)}`,
    { method: 'DELETE' },
  );
}
