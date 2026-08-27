#!/usr/bin/env node
/**
 * Verifies the WRITE half of CodeWeave against a real repository, acting as the
 * GitHub App installation: index -> RAG -> impact -> AI patch -> branch ->
 * commit -> pull request -> AI review posted to GitHub.
 *
 * Usage: node scripts/verifyWriteFlow.js owner/repo
 */
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { getAppOctokit, getInstallationOctokit } from '../src/config/github.js';
import { Repository } from '../src/models/Repository.js';
import { CodeFile } from '../src/models/CodeFile.js';
import { CodeSymbol } from '../src/models/CodeSymbol.js';
import { CodeEdge } from '../src/models/CodeEdge.js';
import { IndexJob } from '../src/models/IndexJob.js';
import { User } from '../src/models/User.js';
import { getRepository } from '../src/services/github/repositories.js';
import { upsertRepository } from '../src/services/repositoryAccess.js';
import { enqueueJob, jobToStatus } from '../src/services/indexing/jobs.js';
import { runWorkerOnce } from '../src/jobs/worker.js';
import { countRepositoryVectors } from '../src/services/qdrant/store.js';
import { answerQuestion } from '../src/services/ai/chat.js';
import { analyzeImpact } from '../src/services/ai/impact.js';
import { generateCodeChange } from '../src/services/codeModification/generateChange.js';
import { applyChange } from '../src/services/codeModification/applyChange.js';
import { reviewPullRequest } from '../src/services/pullRequests/review.js';

const target = process.argv[2];
if (!target?.includes('/')) {
  console.error('Usage: node scripts/verifyWriteFlow.js owner/repo');
  process.exit(1);
}
const [owner, repo] = target.split('/');
const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const step = (n, label) => console.log(`\n[${n}] ${label}\n${'-'.repeat(66)}`);
const pace = async (seconds = 62) => {
  console.log(`  …waiting ${seconds}s so the Groq 8k tokens/minute window clears`);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
};

await connectMongo();

step(1, `Resolve ${target} through the GitHub App installation`);
const app = getAppOctokit();
const { data: installation } = await app.rest.apps.getRepoInstallation({ owner, repo });
const octokit = getInstallationOctokit(installation.id);
const meta = await getRepository(octokit, owner, repo);
// A repo payload fetched with an installation token reports no user-level push
// permission, so the truthful capability for this caller is the installation's
// own `contents` permission. In the product, writes always run with the signed-in
// user's token and permissions come from that user's repo payload instead.
const installationCanWrite = installation.permissions?.contents === 'write';
meta.permissions = {
  ...meta.permissions,
  push: installationCanWrite,
  canWrite: installationCanWrite,
  role: installationCanWrite ? 'write' : meta.permissions.role,
};
console.log(`  installation ${installation.id} | default branch ${meta.defaultBranch} | contents=${installation.permissions?.contents}`);
check('repository metadata read', Boolean(meta.githubRepositoryId), meta.fullName);
check('installation grants contents:write', installationCanWrite, `role=${meta.permissions.role}`);

const doc = await upsertRepository(meta, null, null);
await Repository.findByIdAndUpdate(doc._id, { $set: { indexedBranch: meta.defaultBranch } });
const verifyUser = await User.findOneAndUpdate(
  { githubId: -1 },
  { $set: { login: 'codeweave-verification', name: 'Verification Script' } },
  { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
);

step(2, 'Index through the real job queue');
const { job } = await enqueueJob({
  kind: 'full_index',
  repositoryId: doc._id,
  owner,
  repo,
  branch: meta.defaultBranch,
  force: true,
  payload: { installationId: installation.id },
});
await runWorkerOnce({ force: true });
const status = jobToStatus(await IndexJob.findById(job._id));
console.log(`  ${status.status} | files=${status.processedFiles} chunks=${status.chunksCreated} symbols=${status.symbolsExtracted} edges=${status.edgesExtracted}`);
check('index completed', status.status === 'completed', status.message);

const [files, symbols, edges, vectors] = await Promise.all([
  CodeFile.countDocuments({ repositoryId: doc._id }),
  CodeSymbol.countDocuments({ repositoryId: doc._id }),
  CodeEdge.countDocuments({ repositoryId: doc._id }),
  countRepositoryVectors(doc._id),
]);
check('graph + vectors persisted', files > 0 && symbols > 0 && edges > 0 && vectors > 0, `files=${files} symbols=${symbols} edges=${edges} vectors=${vectors}`);

const routes = await CodeFile.find({ repositoryId: doc._id, 'routes.0': { $exists: true } }).select('filePath routes').lean();
const routeCount = routes.reduce((sum, f) => sum + f.routes.length, 0);
check('HTTP routes extracted', routeCount >= 4, `${routeCount} routes in ${routes.map((r) => r.filePath).join(', ')}`);

const chain = await CodeEdge.findOne({ repositoryId: doc._id, type: 'calls', toName: 'createUser', toFile: { $ne: '' } }).lean();
check('controller → service call resolved', Boolean(chain), chain ? `${chain.fromFile}:${chain.line} ${chain.fromSymbol} → ${chain.toFile} (confidence ${chain.confidence})` : 'not found');
const testEdge = await CodeEdge.findOne({ repositoryId: doc._id, type: 'tests' }).lean();
check('test coverage edge found', Boolean(testEdge), testEdge ? `${testEdge.fromFile} tests ${testEdge.toName}` : 'none');

step(3, 'RAG answer with citations');
const answer = await answerQuestion({
  repositoryDoc: await Repository.findById(doc._id),
  userId: verifyUser._id,
  question: 'How does creating a user work, from the HTTP route down to the database?',
});
console.log(`  ${answer.answer.slice(0, 420).replace(/\n/g, '\n  ')}`);
console.log(`  citations: ${answer.citations.map((c) => `${c.filePath}:${c.startLine}-${c.endLine}`).join(', ')}`);
check('grounded answer with citations', answer.grounded && answer.citations.length > 0, `${answer.stats.returned} chunks`);
const indexed = new Set((await CodeFile.find({ repositoryId: doc._id }).select('filePath').lean()).map((f) => f.filePath));
check('every citation resolves to an indexed file', answer.citations.every((c) => indexed.has(c.filePath)));

await pace();
step(4, 'Impact analysis on createUser');
const impact = await analyzeImpact({ repositoryDoc: await Repository.findById(doc._id), symbolName: 'createUser', explain: true });
console.log(`  risk=${impact.riskLevel} callers=${impact.counts.directCallers} importers=${impact.counts.importers} routes=${impact.counts.routes} tests=${impact.counts.tests}`);
for (const item of impact.impacts.slice(0, 5)) console.log(`   - ${item.severity.padEnd(6)} ${item.filePath} :: ${item.reasons.join('; ')}`);
console.log(`  call paths: ${impact.callPaths.slice(0, 3).join(' | ')}`);
check('impact found the real callers', impact.counts.directCallers > 0 || impact.impacts.length > 0, `${impact.impacts.length} affected files`);
check('impact explanation generated', impact.explanation.length > 80);

await pace();
step(5, 'AI change proposal');
const change = await generateCodeChange({
  repositoryDoc: await Repository.findById(doc._id),
  userId: verifyUser._id,
  octokit,
  meta,
  instruction: 'Reject credit amounts that are negative or zero before they are applied to a user balance.',
  targetFiles: [],
  branch: meta.defaultBranch,
});
console.log(`  summary: ${change.summary}`);
for (const file of change.files) {
  console.log(`   - ${file.path} +${file.additions}/-${file.deletions}`);
  console.log(file.diff.split('\n').slice(4, 14).map((l) => `      ${l}`).join('\n'));
}
check('validated patch produced', change.files.length > 0 && change.status === 'proposed', `${change.files.length} file(s)`);

step(6, 'Apply: branch → commit → pull request (real writes)');
const applied = await applyChange({
  change,
  octokit,
  meta,
  viewerLogin: owner,
  createPr: true,
});
console.log(`  branch : ${applied.head.owner}/${applied.head.repo}:${applied.branch}`);
console.log(`  commit : ${applied.commit.sha.slice(0, 7)} — ${applied.commit.url}`);
console.log(`  PR     : #${applied.pullRequest?.number} ${applied.pullRequest?.url}`);
check('branch created and committed', Boolean(applied.commit.sha) && applied.branch !== meta.defaultBranch, applied.branch);
check('default branch untouched', applied.branch !== meta.defaultBranch && applied.change.baseBranch === meta.defaultBranch);
check('pull request opened', Boolean(applied.pullRequest?.number), `#${applied.pullRequest?.number}`);
check('change status is pr_open', applied.change.status === 'pr_open', applied.change.statusMessage);
check('no fork was used (direct write access)', applied.viaFork === false);

await pace();
step(7, `AI review of PR #${applied.pullRequest.number} (posted to GitHub)`);
const { review } = await reviewPullRequest({
  repositoryDoc: await Repository.findById(doc._id),
  octokit,
  meta,
  number: applied.pullRequest.number,
  userId: verifyUser._id,
  trigger: 'manual',
  postToGithub: true,
  force: true,
});
console.log(`  verdict=${review.verdict} risk=${review.riskLevel} findings=${review.findings.length}`);
for (const finding of review.findings.slice(0, 4)) {
  console.log(`   - ${finding.severity}/${finding.confidence} ${finding.filePath}:${finding.line} — ${finding.title}`);
}
check('review generated', review.summary.length > 40, `${review.filesReviewed} file(s) reviewed`);
check('review published to GitHub', review.postedToGithub === true, review.githubCommentUrl);

step(8, 'Summary');
const failed = results.filter((r) => !r.pass);
console.log(`  ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log(`  failed: ${failed.map((f) => f.label).join(' | ')}`);
console.log(`\n  Open the pull request: ${applied.pullRequest?.url}`);

await disconnectMongo();
process.exit(failed.length ? 1 : 0);
