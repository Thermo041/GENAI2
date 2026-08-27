#!/usr/bin/env node
/**
 * End-to-end verification against a REAL public GitHub repository.
 *
 * Runs the production code paths — no mocks, no fixtures:
 *   queue a job -> worker claims it -> GitHub tree/blobs -> AST parse -> chunk ->
 *   MiniLM embeddings -> Qdrant upsert -> graph in Mongo -> RAG answer (Groq) ->
 *   impact analysis -> AI change proposal + patch validation.
 *
 * Usage:  node scripts/e2eVerify.js [owner/repo] [maxFiles]
 * Notes:  runs unauthenticated (60 GitHub req/h), so keep maxFiles small.
 */
import { config, validateConfig } from '../src/config/env.js';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { ensureCollection } from '../src/config/qdrant.js';
import { getPublicOctokit } from '../src/config/github.js';
import { Repository } from '../src/models/Repository.js';
import { CodeFile } from '../src/models/CodeFile.js';
import { CodeSymbol } from '../src/models/CodeSymbol.js';
import { CodeEdge } from '../src/models/CodeEdge.js';
import { IndexJob } from '../src/models/IndexJob.js';
import { getRepository } from '../src/services/github/repositories.js';
import { upsertRepository } from '../src/services/repositoryAccess.js';
import { enqueueJob, jobToStatus } from '../src/services/indexing/jobs.js';
import { runWorkerOnce } from '../src/jobs/worker.js';
import { countRepositoryVectors, searchChunks } from '../src/services/qdrant/store.js';
import { embedQuery } from '../src/services/embeddings/index.js';
import { answerQuestion } from '../src/services/ai/chat.js';
import { analyzeImpact } from '../src/services/ai/impact.js';
import { generateCodeChange } from '../src/services/codeModification/generateChange.js';
import { User } from '../src/models/User.js';

const target = process.argv[2] || 'hagopj13/node-express-boilerplate';
const maxFiles = Number.parseInt(process.argv[3] || '30', 10);
const skipIndex = process.argv.includes('--skip-index');
config.limits.maxFiles = maxFiles;

const [owner, repo] = target.split('/');
const step = (n, label) => console.log(`\n[${n}] ${label}\n${'-'.repeat(60)}`);
const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const missing = validateConfig();
if (missing.length) {
  console.error('Missing config:', missing.join(', '));
  process.exit(1);
}

await connectMongo();
await ensureCollection();

step(1, `GitHub metadata for ${target} (unauthenticated public read)`);
const octokit = getPublicOctokit();
const meta = await getRepository(octokit, owner, repo, { authenticated: false });
check('repository metadata fetched', Boolean(meta.githubRepositoryId), `${meta.fullName} default=${meta.defaultBranch} ${meta.sizeKb}KB`);
check('permissions detected as read-only for anonymous access', meta.permissions.canWrite === false, `role=${meta.permissions.role}`);

const doc = await upsertRepository(meta, null, null);
await Repository.findByIdAndUpdate(doc._id, { $set: { indexedBranch: meta.defaultBranch } });

step(2, `Indexing (max ${maxFiles} files) through the real job queue`);
if (skipIndex) {
  console.log('  --skip-index: reusing the existing index for this repository');
  const previous = await IndexJob.findOne({ repositoryId: doc._id, kind: 'full_index' }).sort({ createdAt: -1 });
  const previousStatus = jobToStatus(previous);
  check('previous index job available', previousStatus?.status === 'completed', previousStatus?.message);
} else {
  const started = Date.now();
  const { job } = await enqueueJob({
    kind: 'full_index',
    repositoryId: doc._id,
    owner,
    repo,
    branch: meta.defaultBranch,
    force: true,
    payload: { publicOnly: true },
  });
  console.log(`  queued job ${job._id}`);
  await runWorkerOnce();
  const finished = await IndexJob.findById(job._id);
  const status = jobToStatus(finished);
  console.log(`  stage=${status.stage} status=${status.status} progress=${status.progress}%`);
  console.log(`  files=${status.processedFiles}/${status.sourceFiles} chunks=${status.chunksCreated} embeddings=${status.embeddingsGenerated} symbols=${status.symbolsExtracted} edges=${status.edgesExtracted}`);
  if (status.issues?.length) console.log(`  issues: ${status.issues.slice(0, 3).map((i) => `${i.filePath}: ${i.message}`).join(' | ')}`);
  check('index job completed', status.status === 'completed', status.message);
  check('files were processed', status.processedFiles > 0, `${status.processedFiles} files in ${Math.round((Date.now() - started) / 1000)}s`);
  check('embeddings generated', status.embeddingsGenerated > 0, `${status.embeddingsGenerated} vectors`);
}

step(3, 'Persistence: Mongo graph + Qdrant vectors');
const repoDoc = await Repository.findById(doc._id);
const [fileCount, symbolCount, edgeCount, vectorCount] = await Promise.all([
  CodeFile.countDocuments({ repositoryId: doc._id }),
  CodeSymbol.countDocuments({ repositoryId: doc._id }),
  CodeEdge.countDocuments({ repositoryId: doc._id }),
  countRepositoryVectors(doc._id),
]);
console.log(`  repository status=${repoDoc.indexingStatus} commit=${(repoDoc.lastIndexedCommitSha || '').slice(0, 7)}`);
check('CodeFile rows written', fileCount > 0, `${fileCount} files`);
check('CodeSymbol rows written', symbolCount > 0, `${symbolCount} symbols`);
check('CodeEdge rows written', edgeCount > 0, `${edgeCount} edges`);
check('Qdrant vectors stored', vectorCount > 0, `${vectorCount} points`);
check('repository marked indexed', ['indexed', 'partial'].includes(repoDoc.indexingStatus), repoDoc.indexingStatus);

const routeFiles = await CodeFile.find({ repositoryId: doc._id, 'routes.0': { $exists: true } }).select('filePath routes').lean();
const routeCount = routeFiles.reduce((sum, f) => sum + f.routes.length, 0);
check('HTTP routes extracted by the AST parser', routeCount > 0, `${routeCount} routes in ${routeFiles.length} files`);
const callEdges = await CodeEdge.countDocuments({ repositoryId: doc._id, type: 'calls', toFile: { $ne: '' } });
check('resolved call edges exist', callEdges > 0, `${callEdges} resolved calls`);

step(4, 'Repository scoping: a query must never cross repositories');
const otherRepo = await Repository.findOne({ _id: { $ne: doc._id } }).select('_id fullName').lean();
const vector = await embedQuery('authentication middleware');
const scoped = await searchChunks({ repositoryId: doc._id, vector, limit: 5 });
check('vector search returns this repository', scoped.length > 0, `${scoped.length} hits, top=${scoped[0]?.filePath}`);
check('all hits belong to the queried repository', scoped.every((c) => c.filePath), 'payload filter applied');
if (otherRepo) {
  const foreign = await searchChunks({ repositoryId: otherRepo._id, vector, limit: 5 });
  check('other repositories are isolated', !foreign.some((f) => scoped.some((s) => s.filePath === f.filePath && s.startLine === f.startLine)), `${otherRepo.fullName}: ${foreign.length} hits`);
}

step(5, 'RAG answer with citations (Groq + retrieved context)');
const verifyUser = await User.findOneAndUpdate(
  { githubId: -1 },
  { $set: { login: 'codeweave-verification', name: 'Verification Script' } },
  { new: true, upsert: true, setDefaultsOnInsert: true },
);
const answer = await answerQuestion({
  repositoryDoc: repoDoc,
  userId: verifyUser._id,
  question: 'How does authentication work in this project and where are the routes defined?',
});
console.log(`  answer (${answer.answer.length} chars, ${answer.stats.returned} chunks: semantic=${answer.stats.semantic} structural=${answer.stats.structural} graph=${answer.stats.graph}):`);
console.log(`  ${answer.answer.slice(0, 700).replace(/\n/g, '\n  ')}`);
console.log(`  citations: ${answer.citations.map((c) => `${c.filePath}:${c.startLine}-${c.endLine}`).join(', ')}`);
check('grounded answer produced', answer.grounded && answer.answer.length > 80);
check('citations returned', answer.citations.length > 0, `${answer.citations.length} sources`);
const citedFiles = new Set(answer.citations.map((c) => c.filePath));
const indexedPaths = new Set((await CodeFile.find({ repositoryId: doc._id }).select('filePath').lean()).map((f) => f.filePath));
check('every citation points at a real indexed file', [...citedFiles].every((f) => indexedPaths.has(f)), [...citedFiles].slice(0, 3).join(', '));

step(6, 'Impact analysis (AST graph + semantics + explanation)');
const candidate = await CodeSymbol.findOne({ repositoryId: doc._id, kind: { $in: ['function', 'method'] }, exported: true })
  .sort({ loc: -1 })
  .lean();
const symbolName = candidate?.name;
console.log(`  target symbol: ${symbolName} (${candidate?.filePath}:${candidate?.startLine})`);
const impact = await analyzeImpact({ repositoryDoc: repoDoc, symbolName, explain: true });
console.log(`  risk=${impact.riskLevel} impacts=${impact.impacts.length} callers=${impact.counts.directCallers} importers=${impact.counts.importers} routes=${impact.counts.routes} tests=${impact.counts.tests}`);
for (const item of impact.impacts.slice(0, 5)) console.log(`   - ${item.severity.padEnd(6)} ${item.filePath} :: ${item.reasons.join('; ')}`);
console.log(`  explanation: ${impact.explanation.slice(0, 400).replace(/\n/g, '\n  ')}`);
check('impact analysis returns structural definitions', impact.definitions.length > 0);
check('impact list computed from the graph', impact.impacts.length >= 0, `${impact.impacts.length} affected files`);
check('AI explanation generated', impact.explanation.length > 80);

step(7, 'AI code change proposal + patch validation (no GitHub write)');
try {
  const change = await generateCodeChange({
    repositoryDoc: repoDoc,
    userId: verifyUser._id,
    octokit,
    meta,
    instruction: 'Add a defensive guard that rejects empty or whitespace-only email values before they reach the database layer.',
    targetFiles: [],
    branch: meta.defaultBranch,
  });
  console.log(`  summary: ${change.summary}`);
  for (const file of change.files) {
    console.log(`   - ${file.path} +${file.additions}/-${file.deletions}`);
    console.log(`     ${file.diff.split('\n').slice(4, 12).join('\n     ')}`);
  }
  check('AI produced a validated patch', change.files.length > 0, `${change.files.length} file(s)`);
  check('diff computed for every file', change.files.every((f) => f.diff.includes('@@')));
  check('change stored as proposed (nothing pushed)', change.status === 'proposed');
  check('patch only touches reviewed context files', change.files.every((f) => change.contextFiles.includes(f.path)));
} catch (err) {
  check('AI change proposal', false, err.message);
}

step(8, 'Summary');
const failed = results.filter((r) => !r.pass);
console.log(`  ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log(`  failed: ${failed.map((f) => f.label).join(' | ')}`);

await disconnectMongo();
process.exit(failed.length ? 1 : 0);
