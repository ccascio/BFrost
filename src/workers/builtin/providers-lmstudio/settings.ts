function positiveNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getLmStudioBin(): string {
  return process.env.LMSTUDIO_BIN || '/Applications/LM Studio.app/Contents/Resources/app/.webpack/lms';
}

export function getLmStudioContextLength(): number {
  return positiveNumberEnv('LMSTUDIO_CONTEXT_LENGTH', 16384);
}
