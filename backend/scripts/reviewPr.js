#!/usr/bin/env node
/**
 * Runs (or re-runs) the AI review of one pull request as the GitHub App
 * installation and publishes it to GitHub.
 *
 * Usage: node scripts/reviewPr.js owner/repo 1
 */
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { getAppOctokit, getInstallationOctokit } from '../src/config/github.js';
import { Repository } from '../src/models/Repository.js';
import { getRepository } from '../src/services/github/repositories.js';
import { reviewPullRequest } from '../src/services/pullRequests/review.js';

const [target, numberArg] = process.argv.slice(2);
if (!target?.includes('/') || !numberArg) {
  console.error('Usage: node scripts/reviewPr.js owner/repo <pr-number>');
  process.exit(1);
}
const [owner, repo] = target.split('/');
const number = Number.parseInt(numberArg, 10);

await connectMongo();
const app = getAppOctokit();
const { data: installation } = await app.rest.apps.getRepoInstallation({ owner, repo });
const octokit = getInstallationOctokit(installation.id);
const meta = await getRepository(octokit, owner, repo);
const doc = await Repository.findOne({ owner, name: repo });
if (!doc) {
  console.error(`${target} is not tracked by CodeWeave yet — index it first.`);
  process.exit(1);
}

console.log(`Reviewing ${target}#${number} (index status: ${doc.indexingStatus})…\n`);
const { review, cached } = await reviewPullRequest({
  repositoryDoc: doc,
  octokit,
  meta,
  number,
  trigger: 'manual',
  postToGithub: true,
  force: true,
});

console.log(`verdict=${review.verdict} risk=${review.riskLevel} findings=${review.findings.length} cached=${cached}`);
console.log(`files reviewed=${review.filesReviewed} (+${review.additions}/-${review.deletions})\n`);
console.log(`${review.summary}\n`);
for (const finding of review.findings) {
  console.log(`- [${finding.severity}/${finding.confidence}] ${finding.filePath}${finding.line ? `:${finding.line}` : ''} — ${finding.title}`);
  console.log(`    issue: ${finding.issue}`);
  console.log(`    fix:   ${finding.recommendation}`);
}
if (review.testGaps?.length) console.log(`\ntest gaps: ${review.testGaps.join(' | ')}`);
if (review.breakingChanges?.length) console.log(`breaking: ${review.breakingChanges.join(' | ')}`);
console.log(`\nposted to GitHub: ${review.postedToGithub} ${review.githubCommentUrl || ''}`);

await disconnectMongo();
process.exit(0);
