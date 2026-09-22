import { z } from 'zod';

/**
 * Schema helper for model-authored prose fields. Length caps on LLM output are
 * advisory — a model that writes 700 characters instead of 600 produced a
 * verbose answer, not an invalid one — so overruns are truncated (with an
 * ellipsis), never rejected. Rejecting throws away an otherwise-valid
 * structured response and forces a full re-run for a cosmetic overflow.
 *
 * Generic platform utility: knows nothing about any specific worker.
 */
export function clippedString(maxChars: number): z.ZodEffects<z.ZodString, string, string> {
  return z
    .string()
    .min(1)
    .transform((value) =>
      value.length > maxChars ? `${value.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…` : value,
    );
}
