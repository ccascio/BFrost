import { promises as fs } from 'fs';

export async function upsertEnvValue(filePath: string, key: string, value: string): Promise<void> {
  let content = '';

  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  const escapedValue = escapeEnvValue(value);
  const line = `${key}=${escapedValue}`;
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm');

  if (pattern.test(content)) {
    content = content.replace(pattern, line);
  } else {
    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    content += line + '\n';
  }

  await fs.writeFile(filePath, content, 'utf8');
}

function escapeEnvValue(value: string): string {
  if (/[\s#"']/u.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
