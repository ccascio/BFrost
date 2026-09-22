import { promises as fs } from 'fs';
import path from 'path';
import { withDebugTimingAsync } from './debug';

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  return withDebugTimingAsync('fs.write-json-atomic', async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
    );

    try {
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(tmpPath, filePath);
    } catch (err) {
      try {
        await fs.unlink(tmpPath);
      } catch {
        // Best effort cleanup.
      }
      throw err;
    }
  });
}
