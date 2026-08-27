import { Conversation } from '../../models/Conversation.js';
import { logger } from '../../utils/logger.js';
import { CHAT_SYSTEM_PROMPT, renderChunk, wrapRepositoryContext } from './prompts.js';
import { invokeText } from './groqService.js';
import { citationsFrom, retrieveContext } from './retrieval.js';
import { tokenBudget } from './budget.js';

/**
 * Explains *why* there is no context instead of just refusing — usually the
 * repository indexed very little (a static site, notebooks, mostly binaries).
 */
function noContextAnswer(repositoryDoc) {
  const stats = repositoryDoc.indexStats || {};
  const parts = [
    "I don't have enough repository context to answer this confidently.",
    `CodeWeave has ${stats.chunks ?? 0} indexed snippet(s) from ${stats.filesIndexed ?? 0} file(s)` +
      (stats.filesSkipped ? `, and skipped ${stats.filesSkipped} file(s) that are not parseable source` : '') +
      '.',
  ];
  if ((stats.chunks ?? 0) === 0) {
    parts.push('Nothing in this repository was indexable — check that it contains source files on the indexed branch, then re-index.');
  } else {
    parts.push('Try naming a file or function from this repository, ask about what it does, or re-index if the code changed.');
  }
  return parts.join(' ');
}

async function loadConversation({ userId, repositoryId, conversationId }) {
  if (conversationId) {
    const existing = await Conversation.findOne({ _id: conversationId, userId, repositoryId });
    if (existing) return existing;
  }
  const latest = await Conversation.findOne({ userId, repositoryId }).sort({ updatedAt: -1 });
  if (latest) return latest;
  return Conversation.create({ userId, repositoryId, messages: [], title: 'New conversation' });
}

function historyBlock(messages) {
  const recent = messages.slice(-4);
  if (!recent.length) return '';
  return [
    'EARLIER TURNS IN THIS CONVERSATION (for pronoun/context resolution only):',
    ...recent.map((m) => `${m.role === 'user' ? 'User' : 'CodeWeave'}: ${m.content.slice(0, 700)}`),
  ].join('\n');
}

/**
 * Full RAG turn: hybrid retrieval -> grounded Groq answer -> citations, then
 * persisted to the (user, repository) conversation.
 */
export async function answerQuestion({ repositoryDoc, userId, question, conversationId }) {
  const repositoryId = repositoryDoc._id;
  const conversation = await loadConversation({ userId, repositoryId, conversationId });

  const budget = tokenBudget({ outputShare: 0.3 });
  const retrieval = await retrieveContext({
    repositoryId,
    question,
    limit: 14,
    maxChars: Math.round(budget.inputChars * 0.75),
  });

  if (retrieval.chunks.length === 0) {
    const answer = noContextAnswer(repositoryDoc);
    conversation.messages.push({ role: 'user', content: question });
    conversation.messages.push({ role: 'assistant', content: answer, citations: [], contextChunks: 0 });
    conversation.lastMessageAt = new Date();
    await conversation.save();
    return {
      conversationId: conversation._id.toString(),
      answer,
      citations: [],
      stats: retrieval.stats,
      grounded: false,
    };
  }

  const contextBlock = wrapRepositoryContext([
    `REPOSITORY: ${repositoryDoc.fullName} (branch ${repositoryDoc.indexedBranch || repositoryDoc.defaultBranch}, commit ${(repositoryDoc.lastIndexedCommitSha || '').slice(0, 7)})`,
    retrieval.graphNotes.length
      ? `STRUCTURAL RELATIONSHIPS (from AST analysis):\n${retrieval.graphNotes.map((n) => `- ${n}`).join('\n')}`
      : null,
    `RETRIEVED CODE (${retrieval.chunks.length} chunks):\n${retrieval.chunks.map(renderChunk).join('\n\n')}`,
  ]);

  const userPrompt = [
    historyBlock(conversation.messages),
    contextBlock,
    `QUESTION: ${question}`,
    'Answer using only the context above. Cite files as path:startLine-endLine.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const { text, usage, model } = await invokeText({
    system: CHAT_SYSTEM_PROMPT,
    user: userPrompt,
    temperature: 0.15,
    maxTokens: Math.min(1600, budget.outputTokens),
  });

  const citations = citationsFrom(retrieval.chunks);

  conversation.messages.push({ role: 'user', content: question });
  conversation.messages.push({
    role: 'assistant',
    content: text,
    citations,
    model,
    usage,
    contextChunks: retrieval.chunks.length,
    commitSha: repositoryDoc.lastIndexedCommitSha,
  });
  if (conversation.messages.length <= 2) conversation.title = question.slice(0, 70);
  conversation.lastMessageAt = new Date();
  await conversation.save();

  logger.info(
    { repo: repositoryDoc.fullName, chunks: retrieval.chunks.length, ...retrieval.stats, tokens: usage.totalTokens },
    'RAG answer generated',
  );

  return {
    conversationId: conversation._id.toString(),
    answer: text,
    citations,
    stats: retrieval.stats,
    grounded: true,
    model,
    usage,
  };
}

export async function listConversations({ userId, repositoryId }) {
  const conversations = await Conversation.find({ userId, repositoryId })
    .sort({ updatedAt: -1 })
    .limit(20)
    .select('title lastMessageAt createdAt messages')
    .lean();
  return conversations.map((c) => ({
    id: c._id.toString(),
    title: c.title,
    messageCount: c.messages.length,
    lastMessageAt: c.lastMessageAt,
    createdAt: c.createdAt,
  }));
}

export async function getConversation({ userId, repositoryId, conversationId }) {
  const conversation = conversationId
    ? await Conversation.findOne({ _id: conversationId, userId, repositoryId }).lean()
    : await Conversation.findOne({ userId, repositoryId }).sort({ updatedAt: -1 }).lean();
  if (!conversation) return { id: null, messages: [] };
  return {
    id: conversation._id.toString(),
    title: conversation.title,
    messages: conversation.messages.map((m) => ({
      id: m._id?.toString(),
      role: m.role,
      content: m.content,
      citations: m.citations || [],
      contextChunks: m.contextChunks,
      createdAt: m.createdAt,
    })),
  };
}
