export const PERMISSION_INFO: Record<string, { label: string; description: string }> = {
  'network:http': {
    label: 'HTTP network access',
    description: 'Can make outbound HTTP requests (unencrypted). Only needed for local or legacy endpoints.',
  },
  'network:https': {
    label: 'HTTPS network access',
    description: 'Can make outbound HTTPS requests to the internet.',
  },
  'storage:worker-kv': {
    label: 'Worker key-value storage',
    description: 'Can read and write its own namespaced key-value store inside BFrost.',
  },
  'filesystem:scoped-read': {
    label: 'Scoped filesystem read',
    description: 'Can read files within a specific folder you approve at install time.',
  },
  'filesystem:scoped-write': {
    label: 'Scoped filesystem write',
    description: 'Can create or modify files within a specific folder you approve at install time.',
  },
  'filesystem:workspace-read': {
    label: 'Workspace filesystem read',
    description: 'Can read any file in the configured workspace directory.',
  },
  'operator-notify': {
    label: 'Operator notifications',
    description: 'Can send you notifications via configured channels (e.g. Telegram).',
  },
  'local-process': {
    label: 'Local process execution',
    description: 'Can spawn shell commands or subprocesses on this machine.',
  },
};

export interface StoreWorkerListing {
  id: string;
  name: string;
  tagline: string;
  author: string;
  category: string;
  tags: string[];
  trust: string;
  latestVersion: string;
  bfrostEngine: string;
  permissions: string[];
  capabilities: {
    jobs: string[];
    tools: string[];
    channels: string[];
    providers: string[];
    itemProduces: string[];
    itemConsumes: string[];
  };
  downloadCount: number;
  updatedAt: string;
  builtIn?: boolean;
}

export interface StoreWorkerVersion {
  version: string;
  bfrostEngine: string;
  releaseUrl?: string;
  bundleUrl?: string;
  bundleSha256?: string;
  bundleSizeBytes?: number;
  changelog?: string;
  publishedAt: string;
  yanked: boolean;
  yankReason?: string;
}

export interface StoreWorkerDetail extends StoreWorkerListing {
  description: string;
  repoUrl: string;
  readmeUrl?: string;
  license: string;
  versions: StoreWorkerVersion[];
}
