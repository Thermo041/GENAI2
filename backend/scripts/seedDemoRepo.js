#!/usr/bin/env node
/**
 * Seeds an EMPTY GitHub repository with a small Express/Mongoose app so every
 * CodeWeave feature has real structure to analyse. Acts as the CodeWeave GitHub
 * App installation, so it only works on repositories the App is installed on.
 *
 * Usage: node scripts/seedDemoRepo.js owner/repo
 */
import { getAppOctokit, getInstallationOctokit } from '../src/config/github.js';
import { DEMO_FILES } from './demoApp.js';

const target = process.argv[2];
if (!target || !target.includes('/')) {
  console.error('Usage: node scripts/seedDemoRepo.js owner/repo');
  process.exit(1);
}
const [owner, repo] = target.split('/');

const app = getAppOctokit();
const { data: installation } = await app.rest.apps.getRepoInstallation({ owner, repo }).catch((err) => {
  console.error(
    err.status === 404
      ? `The CodeWeave App is not installed on ${target}. Install it on that account first.`
      : `Could not resolve the installation: ${err.message}`,
  );
  process.exit(1);
});

const octokit = getInstallationOctokit(installation.id);
const { data: repository } = await octokit.rest.repos.get({ owner, repo });
console.log(`repository: ${repository.full_name} | empty=${repository.size === 0} | default branch=${repository.default_branch}`);

const entries = Object.entries(DEMO_FILES);

// An empty repository has no commit to build a tree on, so the first file goes
// through the contents API (which creates the branch), then the rest land in one
// commit through the git data API.
const existing = await octokit.rest.repos
  .getBranch({ owner, repo, branch: repository.default_branch })
  .then((r) => r.data.commit.sha)
  .catch(() => null);

let baseSha = existing;
let created = 0;

if (!baseSha) {
  const [firstPath, firstContent] = entries[0];
  const { data } = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: firstPath,
    message: 'Add project readme',
    content: Buffer.from(firstContent, 'utf8').toString('base64'),
  });
  baseSha = data.commit.sha;
  created += 1;
  console.log(`created ${firstPath} (first commit ${baseSha.slice(0, 7)})`);
}

const remaining = entries.slice(created);
if (remaining.length) {
  const baseCommit = await octokit.rest.git.getCommit({ owner, repo, commit_sha: baseSha });
  const tree = [];
  for (const [path, content] of remaining) {
    const blob = await octokit.rest.git.createBlob({
      owner,
      repo,
      content: Buffer.from(content, 'utf8').toString('base64'),
      encoding: 'base64',
    });
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.data.sha });
  }
  const newTree = await octokit.rest.git.createTree({ owner, repo, base_tree: baseCommit.data.tree.sha, tree });
  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: 'Add demo Express service (routes, controller, service, model, tests)',
    tree: newTree.data.sha,
    parents: [baseSha],
  });
  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${repository.default_branch}`,
    sha: commit.data.sha,
  });
  created += remaining.length;
  console.log(`committed ${remaining.length} file(s) as ${commit.data.sha.slice(0, 7)}`);
}

console.log(`\nSeeded ${created} file(s) into ${target} on ${repository.default_branch}.`);
console.log(`Browse: ${repository.html_url}`);
