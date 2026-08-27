import { describe, expect, it } from 'vitest';
import { applyLineEdits, diffStats, unifiedDiff, validateFileChange, assertBaseUnchanged } from '../src/services/codeModification/patchValidator.js';
import { suggestBranchName, suggestCommitMessage, buildPullRequestBody } from '../src/services/codeModification/applyChange.js';

const original = `export function processPayment(amount) {
  const charge = createCharge(amount);
  return charge;
}
`;

describe('applyLineEdits', () => {
  it('replaces an inclusive line range', () => {
    const result = applyLineEdits(original, [{ startLine: 2, endLine: 2, replacement: '  if (amount <= 0) throw new Error("invalid");\n  const charge = createCharge(amount);' }]);
    expect(result).toContain('if (amount <= 0)');
    expect(result).toContain('return charge;');
  });

  it('supports deletion with an empty replacement', () => {
    const result = applyLineEdits(original, [{ startLine: 2, endLine: 2, replacement: '' }]);
    expect(result).not.toContain('createCharge');
  });

  it('rejects overlapping, inverted and out-of-range edits', () => {
    expect(() => applyLineEdits(original, [{ startLine: 2, endLine: 3, replacement: 'x' }, { startLine: 3, endLine: 4, replacement: 'y' }])).toThrow(/overlapping/);
    expect(() => applyLineEdits(original, [{ startLine: 3, endLine: 1, replacement: 'x' }])).toThrow(/inverted/);
    expect(() => applyLineEdits(original, [{ startLine: 1, endLine: 99, replacement: 'x' }])).toThrow(/has 5 lines|line 99/);
  });
});

describe('diffStats and unifiedDiff', () => {
  it('counts real additions and deletions', () => {
    const modified = original.replace('  const charge', '  if (amount <= 0) throw new Error("invalid");\n  const charge');
    expect(diffStats(original, modified)).toEqual({ additions: 1, deletions: 0 });
  });

  it('produces a unified diff with hunk headers and file paths', () => {
    const modified = original.replace('return charge;', 'return charge.id;');
    const diff = unifiedDiff('src/payment.js', original, modified);
    expect(diff).toContain('a/src/payment.js');
    expect(diff).toContain('@@');
    expect(diff).toContain('+  return charge.id;');
  });
});

describe('validateFileChange', () => {
  const originalFile = { path: 'src/payment.js', content: original, sha: 'sha-1', lines: 5 };
  const allowedPaths = new Set(['src/payment.js']);

  it('accepts a full-content rewrite and computes the diff', () => {
    const result = validateFileChange({
      proposed: { path: 'src/payment.js', action: 'modify', newContent: original.replace('return charge;', 'return charge.id;'), rationale: 'return id' },
      originalFile,
      allowedPaths,
    });
    expect(result).toMatchObject({ path: 'src/payment.js', action: 'modify', originalSha: 'sha-1', additions: 1, deletions: 1 });
    expect(result.diff).toContain('@@');
  });

  it('accepts line-range edits', () => {
    const result = validateFileChange({
      proposed: { path: 'src/payment.js', edits: [{ startLine: 2, endLine: 2, replacement: '  const charge = createCharge(Math.abs(amount));' }] },
      originalFile,
      allowedPaths,
    });
    expect(result.modifiedContent).toContain('Math.abs(amount)');
  });

  it('refuses paths outside the reviewed context', () => {
    expect(() =>
      validateFileChange({
        proposed: { path: 'src/secrets.js', newContent: 'stolen' },
        originalFile: undefined,
        allowedPaths,
      }),
    ).toThrow(/not part of the reviewed context/);
  });

  it('refuses path traversal in AI output', () => {
    expect(() => validateFileChange({ proposed: { path: '../../etc/passwd', newContent: 'x' }, originalFile, allowedPaths })).toThrow();
  });

  it('refuses modifying a file that does not exist and creating one that does', () => {
    expect(() => validateFileChange({ proposed: { path: 'src/payment.js', newContent: 'x'.repeat(200) }, originalFile: undefined, allowedPaths })).toThrow(/does not exist/);
    expect(() => validateFileChange({ proposed: { path: 'src/payment.js', action: 'create', newContent: 'x' }, originalFile, allowedPaths })).toThrow(/already exists/);
  });

  it('refuses suspiciously truncated rewrites', () => {
    expect(() =>
      validateFileChange({
        proposed: { path: 'src/payment.js', newContent: 'export function processPayment() {}' },
        originalFile: { ...originalFile, content: original.repeat(4) },
        allowedPaths,
      }),
    ).toThrow(/truncated/);
  });

  it('drops no-op changes instead of committing them', () => {
    expect(validateFileChange({ proposed: { path: 'src/payment.js', newContent: original }, originalFile, allowedPaths })).toBeNull();
  });

  it('refuses output with neither content nor edits', () => {
    expect(() => validateFileChange({ proposed: { path: 'src/payment.js' }, originalFile, allowedPaths })).toThrow(/no usable content/);
  });
});

describe('assertBaseUnchanged', () => {
  it('passes when the file is byte-identical', () => {
    expect(assertBaseUnchanged({ filePath: 'a.js', expectedSha: 'x', currentSha: 'x', expectedContent: 'a', currentContent: 'a' })).toBe(true);
  });

  it('fails when the blob sha moved', () => {
    expect(() => assertBaseUnchanged({ filePath: 'a.js', expectedSha: 'x', currentSha: 'y' })).toThrow(/changed on GitHub/);
  });

  it('fails when the content differs even if shas are absent', () => {
    expect(() => assertBaseUnchanged({ filePath: 'a.js', expectedContent: 'a', currentContent: 'b' })).toThrow(/no longer matches/);
  });
});

describe('branch, commit and PR text', () => {
  it('builds a namespaced, git-safe branch name', () => {
    const name = suggestBranchName('Add validation for negative payment amounts!!');
    expect(name).toMatch(/^codeweave\/[a-z0-9-]+$/);
    expect(name.length).toBeLessThan(80);
  });

  it('never suggests the default branch', () => {
    expect(suggestBranchName('main')).not.toBe('main');
  });

  it('builds a one-line commit subject', () => {
    const message = suggestCommitMessage({ summary: 'Added validation for negative payment amounts\nextra detail', instruction: 'x' });
    expect(message).not.toContain('\n');
    expect(message.length).toBeLessThanOrEqual(68);
    expect(message[0]).toBe(message[0].toUpperCase());
  });

  it('builds a PR body that lists files and marks fork provenance', () => {
    const body = buildPullRequestBody(
      {
        summary: 'Validate amounts',
        instruction: 'add validation',
        reasoning: 'because',
        warnings: ['no tests added'],
        impactedSymbols: ['orderService.createOrder'],
        files: [{ path: 'src/payment.js', additions: 3, deletions: 1 }],
      },
      { viaFork: true, upstream: 'amit/chat-app' },
    );
    expect(body).toContain('## Summary');
    expect(body).toContain('`src/payment.js` (+3 / -1)');
    expect(body).toContain('orderService.createOrder');
    expect(body).toContain('amit/chat-app');
    expect(body).toContain('CodeWeave');
  });
});
