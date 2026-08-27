import { describe, expect, it } from 'vitest';
import { parseRepoInput, assertSafeRepoPath, isSafeBranchName, assertBranchName } from '../src/utils/repoIdentity.js';

describe('parseRepoInput', () => {
  it('accepts a plain https URL', () => {
    expect(parseRepoInput('https://github.com/amit/chat-app')).toMatchObject({ owner: 'amit', repo: 'chat-app', branch: null });
  });

  it('accepts owner/repo shorthand', () => {
    expect(parseRepoInput('rahul/ecommerce-app')).toMatchObject({ owner: 'rahul', repo: 'ecommerce-app' });
  });

  it('strips .git and trailing paths', () => {
    expect(parseRepoInput('https://github.com/facebook/react.git')).toMatchObject({ repo: 'react' });
    expect(parseRepoInput('https://github.com/facebook/react/issues/123')).toMatchObject({ owner: 'facebook', repo: 'react' });
  });

  it('extracts the branch from /tree/ URLs', () => {
    expect(parseRepoInput('https://github.com/expressjs/express/tree/5.x')).toMatchObject({ repo: 'express', branch: '5.x' });
  });

  it('accepts SSH remotes and host-only URLs', () => {
    expect(parseRepoInput('git@github.com:vercel/next.js.git')).toMatchObject({ owner: 'vercel', repo: 'next.js' });
    expect(parseRepoInput('github.com/nodejs/node')).toMatchObject({ owner: 'nodejs', repo: 'node' });
  });

  it('rejects non-GitHub hosts', () => {
    expect(() => parseRepoInput('https://gitlab.com/foo/bar')).toThrow(/Only github.com/);
    expect(() => parseRepoInput('https://evil.com/github.com/foo/bar')).toThrow(/Only github.com/);
  });

  it('rejects incomplete or malformed input', () => {
    expect(() => parseRepoInput('')).toThrow();
    expect(() => parseRepoInput('https://github.com/onlyowner')).toThrow(/owner and a repository/);
    expect(() => parseRepoInput('a/b/c')).toThrow(/owner\/repo/);
    expect(() => parseRepoInput('bad owner/repo')).toThrow(/not a valid GitHub owner/);
    expect(() => parseRepoInput('owner/re;po')).toThrow(/not a valid repository name/);
  });
});

describe('assertSafeRepoPath', () => {
  it('accepts normal repository paths', () => {
    expect(assertSafeRepoPath('src/controllers/auth.controller.js')).toBe('src/controllers/auth.controller.js');
    expect(assertSafeRepoPath('./README.md')).toBe('README.md');
  });

  it('blocks traversal, absolute paths and NUL bytes', () => {
    expect(() => assertSafeRepoPath('../../etc/passwd')).toThrow(/invalid segment/);
    expect(() => assertSafeRepoPath('src/../../secret')).toThrow(/invalid segment/);
    expect(() => assertSafeRepoPath('/etc/passwd')).toThrow(/repository-relative/);
    expect(() => assertSafeRepoPath('C:\\Windows\\system32')).toThrow();
    expect(() => assertSafeRepoPath('src\\win\\path.js')).toThrow(/forward slashes/);
    expect(() => assertSafeRepoPath('src/a\0b.js')).toThrow(/Invalid file path/);
  });

  it('blocks git internals and over-long paths', () => {
    expect(() => assertSafeRepoPath('.git/config')).toThrow(/Git internals/);
    expect(() => assertSafeRepoPath(`${'a/'.repeat(250)}b.js`)).toThrow(/too long/);
  });
});

describe('branch names', () => {
  it('accepts real branch names', () => {
    expect(isSafeBranchName('main')).toBe(true);
    expect(isSafeBranchName('codeweave/add-payment-validation')).toBe(true);
    expect(isSafeBranchName('release/v1.2.3')).toBe(true);
  });

  it('rejects git-illegal and injection-shaped names', () => {
    for (const bad of ['', '..', 'feature/../main', 'has space', 'tilde~1', 'caret^', 'colon:name', 'question?', 'star*', 'open[bracket', 'back\\slash', 'double//slash', 'trailing/', 'thing.lock', '@{now}', '.hidden']) {
      expect(isSafeBranchName(bad), bad).toBe(false);
    }
    expect(() => assertBranchName('bad name')).toThrow(/not a valid git branch/);
  });
});
