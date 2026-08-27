import { config } from '../../config/env.js';

/**
 * Token budgeting.
 *
 * Groq's free tier enforces a tokens-per-minute ceiling (8k on-demand), which is
 * smaller than the model's 131k context window. Prompts are therefore sized
 * against GROQ_TPM_LIMIT rather than the context window: raise that env var
 * after upgrading the Groq tier and every prompt widens automatically.
 */
const CHARS_PER_TOKEN = 3.6;

export function tokenBudget({ outputShare = 0.35, reserve = 400 } = {}) {
  const limit = Math.max(2000, config.groq.tpmLimit);
  const usable = Math.max(1200, limit - reserve);
  const outputTokens = Math.min(config.groq.maxTokens, Math.round(usable * outputShare));
  const inputTokens = usable - outputTokens;
  return {
    limit,
    inputTokens,
    outputTokens,
    inputChars: Math.round(inputTokens * CHARS_PER_TOKEN),
  };
}

export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN);
}

/**
 * Merges retrieved line ranges into a small set of windows so a large file can
 * be shown as focused excerpts instead of in full.
 */
export function mergeWindows(ranges, { padding = 15, maxWindows = 4, totalLines }) {
  const sorted = ranges
    .map((range) => ({
      start: Math.max(1, range.startLine - padding),
      end: Math.min(totalLines, range.endLine + padding),
    }))
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const window of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && window.start <= previous.end + 6) {
      previous.end = Math.max(previous.end, window.end);
    } else {
      merged.push({ ...window });
    }
  }
  return merged.slice(0, maxWindows);
}

/** Renders file content (or windows of it) with 1-based line numbers. */
export function withLineNumbers(content, windows) {
  const lines = content.split('\n');
  if (!windows?.length) {
    return lines.map((line, index) => `${String(index + 1).padStart(4, ' ')}| ${line}`).join('\n');
  }
  return windows
    .map((window) => {
      const body = lines
        .slice(window.start - 1, window.end)
        .map((line, index) => `${String(window.start + index).padStart(4, ' ')}| ${line}`)
        .join('\n');
      return `--- lines ${window.start}-${window.end} of ${lines.length} ---\n${body}`;
    })
    .join('\n\n');
}
