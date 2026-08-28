import { createTwoFilesPatch, structuredPatch } from 'diff';
import { errors } from '../../utils/errors.js';
import { assertSafeRepoPath } from '../../utils/repoIdentity.js';

const MAX_FILE_LINES_FOR_FULL_REWRITE = 2500;

/** Unified diff between the original and modified content of one file. */
export function unifiedDiff(filePath, original, modified) {
  return createTwoFilesPatch(`a/${filePath}`, `b/${filePath}`, original, modified, '', '', { context: 3 });
}

export function diffStats(original, modified) {
  const patch = structuredPatch('a', 'b', original, modified, '', '', { context: 0 });
  let additions = 0;
  let deletions = 0;
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) additions += 1;
      else if (line.startsWith('-')) deletions += 1;
    }
  }
  return { additions, deletions };
}

/** Applies line-range edits deterministically (1-indexed, inclusive). */
export function applyLineEdits(original, edits) {
  const lines = original.split('\n');
  const sorted = [...edits].sort((a, b) => a.startLine - b.startLine);

  let previousEnd = 0;
  for (const edit of sorted) {
    if (edit.startLine > edit.endLine) throw errors.patchFailed(`Edit range ${edit.startLine}-${edit.endLine} is inverted.`);
    if (edit.startLine <= previousEnd) throw errors.patchFailed('The AI returned overlapping edits.');
    if (edit.endLine > lines.length) {
      throw errors.patchFailed(`Edit targets line ${edit.endLine} but the file has ${lines.length} lines.`);
    }
    previousEnd = edit.endLine;
  }

  const out = [];
  let cursor = 1;
  for (const edit of sorted) {
    while (cursor < edit.startLine) {
      out.push(lines[cursor - 1]);
      cursor += 1;
    }
    const replacement = edit.replacement.replace(/\r\n/g, '\n');
    if (replacement !== '') out.push(...replacement.split('\n'));
    cursor = edit.endLine + 1;
  }
  while (cursor <= lines.length) {
    out.push(lines[cursor - 1]);
    cursor += 1;
  }
  return out.join('\n');
}

/**
 * Validates one AI-proposed file change against the real current file.
 * Rejects: unknown paths for modifications, creating over an existing file,
 * unchanged content, whole-file wipes, truncated output, and edits that do not
 * apply cleanly. Creating a genuinely new file is allowed.
 */
export function validateFileChange({ proposed, originalFile, allowedPaths, existingPaths }) {
  const path = assertSafeRepoPath(proposed.path);
  const isCreate = proposed.action === 'create';

  if (!isCreate && !allowedPaths.has(path)) {
    throw errors.patchFailed(
      `The AI tried to modify "${path}", which was not part of the reviewed context. CodeWeave refused the change.`,
    );
  }
  if (isCreate && (originalFile || existingPaths?.has(path))) {
    throw errors.patchFailed(`The AI tried to create "${path}", but that file already exists.`);
  }
  if (!isCreate && !originalFile) {
    throw errors.patchFailed(`"${path}" does not exist on this branch, so it cannot be modified.`);
  }
  if (isCreate && !proposed.newContent?.trim()) {
    throw errors.patchFailed(`The AI asked to create "${path}" but provided no content.`);
  }

  const original = originalFile?.content ?? '';
  let modified;

  if (typeof proposed.newContent === 'string' && proposed.newContent.length > 0) {
    modified = proposed.newContent.replace(/\r\n/g, '\n');
    const originalLines = original ? original.split('\n').length : 0;
    if (originalLines > MAX_FILE_LINES_FOR_FULL_REWRITE) {
      throw errors.patchFailed(`"${path}" is too large for a full-file rewrite. Ask for a narrower change.`);
    }
    if (original && modified.length < original.length * 0.35) {
      throw errors.patchFailed(
        `The AI returned a much shorter version of "${path}" (likely truncated). CodeWeave refused to apply it.`,
      );
    }
  } else if (Array.isArray(proposed.edits) && proposed.edits.length > 0) {
    modified = applyLineEdits(original, proposed.edits);
  } else {
    throw errors.patchFailed(`The AI returned no usable content for "${path}".`);
  }

  if (!modified.endsWith('\n') && original.endsWith('\n')) modified += '\n';
  if (modified === original) return null; // no-op, silently dropped

  const stats = diffStats(original, modified);
  if (stats.additions === 0 && stats.deletions === 0) return null;

  return {
    path,
    action: proposed.action === 'create' ? 'create' : 'modify',
    originalContent: original,
    modifiedContent: modified,
    originalSha: originalFile?.sha || '',
    diff: unifiedDiff(path, original, modified),
    additions: stats.additions,
    deletions: stats.deletions,
    rationale: proposed.rationale || '',
  };
}

/**
 * Re-verifies, at accept time, that the file on GitHub is still exactly what
 * the AI saw. Prevents applying a stale patch after someone else pushed.
 */
export function assertBaseUnchanged({ filePath, expectedSha, currentSha, expectedContent, currentContent }) {
  if (expectedSha && currentSha && expectedSha !== currentSha) {
    throw errors.patchFailed(
      `"${filePath}" changed on GitHub after this change was proposed. Re-generate the change so it applies to the current code.`,
    );
  }
  if (expectedContent !== undefined && currentContent !== undefined && expectedContent !== currentContent) {
    throw errors.patchFailed(`"${filePath}" no longer matches the version the AI reviewed. Re-generate the change.`);
  }
  return true;
}
