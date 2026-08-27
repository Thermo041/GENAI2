import { errors } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { CodeChange } from '../../models/CodeChange.js';
import { CodeEdge } from '../../models/CodeEdge.js';
import { getFileContent } from '../github/contents.js';
import { getBranchHead } from '../github/repositories.js';
import { retrieveContext } from '../ai/retrieval.js';
import { invokeStructured } from '../ai/groqService.js';
import { codeChangeSchema } from '../ai/schemas.js';
import { CODE_CHANGE_SYSTEM_PROMPT, renderChunk, wrapRepositoryContext } from '../ai/prompts.js';
import { mergeWindows, tokenBudget, withLineNumbers } from '../ai/budget.js';
import { validateFileChange } from './patchValidator.js';

const FULL_FILE_LINE_LIMIT = 260;

/**
 * Generates a reviewable patch. Nothing is written to GitHub here — the result
 * is a stored CodeChange in `proposed` state that the user must accept.
 *
 * Prompt size is derived from the Groq tokens-per-minute budget: small files are
 * sent whole, larger files as focused windows around the retrieved code, so the
 * request fits the configured plan instead of failing with a 413.
 */
export async function generateCodeChange({ repositoryDoc, userId, octokit, meta, instruction, targetFiles = [], branch }) {
  const baseBranch = branch || repositoryDoc.indexedBranch || meta.defaultBranch;
  const head = await getBranchHead(octokit, meta.owner, meta.name, baseBranch);
  const budget = tokenBudget({ outputShare: 0.42 });

  const retrieval = await retrieveContext({
    repositoryId: repositoryDoc._id,
    question: instruction,
    limit: 12,
    maxChars: Math.round(budget.inputChars * 0.5),
    excludeTests: false,
  });

  const ranked = [];
  for (const path of targetFiles) if (!ranked.includes(path)) ranked.push(path);
  for (const chunk of retrieval.chunks) {
    if (!ranked.includes(chunk.filePath) && !chunk.isTest) ranked.push(chunk.filePath);
  }
  if (ranked.length === 0) {
    throw errors.notIndexed(
      'CodeWeave could not find relevant code for that request. Index the repository first, or mention the file you want changed.',
    );
  }

  const maxFiles = Math.max(1, Math.min(4, Math.floor(budget.inputChars / 5000)));
  const candidates = ranked.slice(0, maxFiles);

  // Roughly 65% of the input budget goes to file content, the rest to graph
  // context, the instruction and the schema description.
  let contentBudget = Math.round(budget.inputChars * 0.65);
  const files = [];

  for (const path of candidates) {
    if (contentBudget < 900) break;
    try {
      const file = await getFileContent(octokit, meta.owner, meta.name, path, head.sha);
      if (file.binary || !file.content) continue;

      const lines = file.content.split('\n').length;
      const numberedFull = withLineNumbers(file.content);
      let rendered = numberedFull;
      let windowed = false;

      if (numberedFull.length > contentBudget || lines > FULL_FILE_LINE_LIMIT) {
        const ranges = retrieval.chunks
          .filter((chunk) => chunk.filePath === path)
          .map((chunk) => ({ startLine: chunk.startLine, endLine: chunk.endLine }));
        const windows = mergeWindows(ranges.length ? ranges : [{ startLine: 1, endLine: Math.min(lines, 80) }], {
          padding: 15,
          maxWindows: 3,
          totalLines: lines,
        });
        rendered = withLineNumbers(file.content, windows);
        windowed = true;
        if (rendered.length > contentBudget) rendered = `${rendered.slice(0, contentBudget)}\n... [excerpt truncated]`;
      }

      contentBudget -= rendered.length;
      files.push({ ...file, lines, rendered, windowed });
    } catch (err) {
      logger.debug({ path, err: err.message }, 'Skipped candidate file for change generation');
    }
  }

  if (files.length === 0) throw errors.badRequest('None of the relevant files could be read from GitHub.');

  const importers = await CodeEdge.find({
    repositoryId: repositoryDoc._id,
    type: { $in: ['imports', 'calls'] },
    toFile: { $in: files.map((f) => f.path) },
  })
    .select('fromFile fromSymbol toFile toName line type')
    .limit(24)
    .lean();

  const windowedFiles = files.filter((f) => f.windowed).map((f) => f.path);
  const extraContextRoom = Math.max(0, contentBudget - 600);
  const extraChunks = extraContextRoom > 800
    ? retrieval.chunks.filter((c) => !files.some((f) => f.path === c.filePath)).slice(0, 2)
    : [];

  const context = wrapRepositoryContext([
    `REPOSITORY: ${repositoryDoc.fullName} (branch ${baseBranch}, commit ${head.sha.slice(0, 7)})`,
    `EDITABLE FILES — you may only modify these paths:\n${files
      .map((f) => `- ${f.path} (${f.lines} lines${f.windowed ? ', shown as excerpts' : ''})`)
      .join('\n')}`,
    ...files.map((file) => `${file.windowed ? 'EXCERPTS OF' : 'FULL CONTENT OF'} ${file.path}:\n\`\`\`\n${file.rendered}\n\`\`\``),
    importers.length
      ? `CALLERS / IMPORTERS OF THESE FILES (AST graph) — consider them before changing a signature:\n${importers
          .slice(0, 14)
          .map((e) => `- ${e.fromFile}:${e.line} ${e.fromSymbol || '<module>'} ${e.type === 'imports' ? 'imports' : 'calls'} ${e.toName}`)
          .join('\n')}`
      : null,
    extraChunks.length ? `NEARBY CONTEXT (read-only, do not edit):\n${extraChunks.map(renderChunk).join('\n\n')}` : null,
  ]);

  const editsRule = windowedFiles.length
    ? `These files are shown as excerpts, so you MUST use "edits" (not "newContent") for: ${windowedFiles.join(', ')}.`
    : 'Prefer "edits" for files over 200 lines.';

  const prompt = [
    context,
    `REQUESTED CHANGE: ${instruction}`,
    'Return JSON: { "summary": string, "reasoning": string, "files": [{ "path": string, "action": "modify"|"create", "newContent": string (complete file, no line numbers) OR "edits": [{ "startLine": number, "endLine": number, "replacement": string }], "rationale": string }], "warnings": string[], "callersToReview": string[], "testSuggestion": string }',
    `The "NNNN| " prefixes are display-only line numbers — never include them in newContent or replacement text. ${editsRule} Keep the change minimal and keep "reasoning" under 60 words.`,
  ].join('\n\n');

  const { data, usage, model } = await invokeStructured({
    system: CODE_CHANGE_SYSTEM_PROMPT,
    user: prompt,
    schema: codeChangeSchema,
    temperature: 0.1,
    maxTokens: budget.outputTokens,
    // Generating a patch is a deliberate, one-shot action: waiting for token
    // headroom beats failing the request on a free-tier minute boundary.
    maxWaitMs: 90_000,
  });

  const allowedPaths = new Set(files.map((f) => f.path));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const validated = [];

  for (const proposed of data.files) {
    const result = validateFileChange({ proposed, originalFile: byPath.get(proposed.path), allowedPaths });
    if (result) validated.push(result);
  }

  if (validated.length === 0) {
    throw errors.patchFailed(
      data.summary
        ? `CodeWeave could not safely apply this change. The AI reported: ${data.summary}`
        : 'The AI did not produce any applicable change.',
    );
  }

  const change = await CodeChange.create({
    userId,
    repositoryId: repositoryDoc._id,
    instruction,
    summary: data.summary,
    reasoning: data.reasoning,
    warnings: [...data.warnings, ...(data.testSuggestion ? [`Test suggestion: ${data.testSuggestion}`] : [])],
    impactedSymbols: data.callersToReview,
    files: validated,
    totalAdditions: validated.reduce((sum, f) => sum + f.additions, 0),
    totalDeletions: validated.reduce((sum, f) => sum + f.deletions, 0),
    baseOwner: meta.owner,
    baseRepo: meta.name,
    baseBranch,
    baseCommitSha: head.sha,
    status: 'proposed',
    model,
    contextFiles: files.map((f) => f.path),
  });

  logger.info(
    {
      repo: repositoryDoc.fullName,
      changeId: change._id.toString(),
      files: validated.length,
      windowed: windowedFiles.length,
      tokens: usage?.totalTokens,
    },
    'AI change proposed',
  );

  return change;
}
