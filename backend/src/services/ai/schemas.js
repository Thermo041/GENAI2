import { z } from 'zod';

/**
 * Models routinely emit `null` for fields they have nothing to say about, and
 * `.optional()` alone rejects null. These helpers accept null/undefined and
 * normalise to a usable default so a cosmetic gap never fails a whole response.
 */
const text = (max, fallback = '') =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => value ?? fallback);

const list = (item, max) =>
  z
    .array(item)
    .max(max)
    .nullish()
    .transform((value) => value ?? []);

const count = (fallback = 0) =>
  z
    .number()
    .int()
    .min(0)
    .nullish()
    .transform((value) => value ?? fallback);

/** Structured contract for AI-generated code changes. Validated before anything
 *  touches GitHub — an AI response that does not fit this shape is rejected. */
export const codeChangeSchema = z.object({
  summary: z.string().min(1).max(500),
  reasoning: text(2000),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(400),
        action: z.enum(['modify', 'create']).nullish().transform((value) => value ?? 'modify'),
        newContent: z.string().nullish(),
        edits: z
          .array(
            z.object({
              startLine: z.number().int().min(1),
              endLine: z.number().int().min(1),
              replacement: z.string(),
            }),
          )
          .nullish(),
        rationale: text(600),
      }),
    )
    .max(6),
  warnings: list(z.string().max(300), 10),
  callersToReview: list(z.string().max(200), 20),
  testSuggestion: text(800),
});

export const prReviewSchema = z.object({
  summary: z.string().min(1).max(1500),
  verdict: z.enum(['approve', 'comment', 'request_changes']),
  riskLevel: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  findings: z
    .array(
      z.object({
        severity: z.enum(['HIGH', 'MEDIUM', 'LOW']),
        confidence: z.enum(['CONFIRMED', 'LIKELY', 'POSSIBLE', 'INSUFFICIENT_CONTEXT']),
        category: text(60, 'correctness'),
        filePath: text(400),
        line: count(0),
        title: z.string().max(160),
        issue: z.string().max(1200),
        recommendation: z.string().max(1200),
      }),
    )
    .max(25),
  testGaps: list(z.string().max(300), 10),
  breakingChanges: list(z.string().max(300), 10),
});

export const overviewSchema = z.object({
  summary: z.string().max(2000),
  architecture: text(2500),
  entryPoints: list(z.string().max(300), 12),
  importantDirectories: list(z.object({ path: text(300), purpose: text(300) }), 14),
  frameworks: list(z.string().max(80), 20),
  databases: list(z.string().max(80), 10),
});
