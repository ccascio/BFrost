import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { config } from './config';

const execFileAsync = promisify(execFile);

function tempPath(ext: string): string {
  return join(tmpdir(), `bfrost-${randomBytes(6).toString('hex')}${ext}`);
}

async function convertToWav(oggBuffer: Buffer): Promise<string> {
  const oggPath = tempPath('.ogg');
  const wavPath = tempPath('.wav');

  await writeFile(oggPath, oggBuffer);
  try {
    await execFileAsync('ffmpeg', [
      '-i', oggPath,
      '-ar', '16000',
      '-ac', '1',
      '-f', 'wav',
      '-y', wavPath,
    ]);
  } finally {
    await unlink(oggPath).catch(() => {});
  }

  return wavPath;
}

export async function transcribeAudio(oggBuffer: Buffer): Promise<string> {
  const wavPath = await convertToWav(oggBuffer);

  try {
    const { stdout } = await execFileAsync('whisper-cli', [
      '-m', config.whisperModelPath,
      '-f', wavPath,
      '--no-timestamps',
      '--language', 'auto',
    ], { maxBuffer: 1024 * 1024 });

    // whisper-cli outputs metadata to stderr; stdout has the transcription
    return stdout.trim();
  } finally {
    await unlink(wavPath).catch(() => {});
  }
}
