import { describe, expect, it } from 'vitest';
import { normalizePermissions, normalizeRepository } from '../src/services/github/repositories.js';
import { assertWriteAccess, summarizeAccess } from '../src/services/repositoryAccess.js';
import { mapGithubError } from '../src/services/github/errors.js';
import { AppError } from '../src/utils/errors.js';

const repoPayload = (overrides = {}) => ({
  id: 1,
  name: 'chat-app',
  full_name: 'amit/chat-app',
  owner: { login: 'amit', avatar_url: 'a', type: 'User' },
  html_url: 'https://github.com/amit/chat-app',
  description: 'd',
  private: false,
  fork: false,
  archived: false,
  size: 120,
  default_branch: 'main',
  language: 'JavaScript',
  stargazers_count: 3,
  forks_count: 1,
  open_issues_count: 0,
  topics: [],
  pushed_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('normalizePermissions', () => {
  it('derives write access only from GitHub push/maintain/admin', () => {
    expect(normalizePermissions({ permissions: { push: true, pull: true } })).toMatchObject({ canWrite: true, role: 'write' });
    expect(normalizePermissions({ permissions: { admin: true } })).toMatchObject({ canWrite: true, role: 'admin' });
    expect(normalizePermissions({ permissions: { maintain: true } })).toMatchObject({ canWrite: true, role: 'maintain' });
    expect(normalizePermissions({ permissions: { triage: true } })).toMatchObject({ canWrite: false, role: 'triage' });
    expect(normalizePermissions({ permissions: { pull: true } })).toMatchObject({ canWrite: false, role: 'read' });
  });

  it('treats a missing permissions object as read-only', () => {
    expect(normalizePermissions({})).toMatchObject({ canWrite: false, role: 'read' });
  });

  it('does NOT infer write access from repository ownership', () => {
    // The signed-in user is "amit" and owns this repo, but GitHub says read-only
    // (for example an org policy or a suspended installation).
    const meta = normalizeRepository(repoPayload({ permissions: { pull: true } }), normalizePermissions(repoPayload({ permissions: { pull: true } })));
    expect(meta.owner).toBe('amit');
    expect(meta.permissions.canWrite).toBe(false);
    expect(() => assertWriteAccess(meta)).toThrow(/Fork & Modify with AI/);
  });
});

describe('assertWriteAccess', () => {
  it('allows writes when GitHub reports push access', () => {
    const meta = normalizeRepository(repoPayload(), normalizePermissions(repoPayload({ permissions: { push: true } })));
    expect(assertWriteAccess(meta)).toBe(true);
  });

  it('blocks writes to archived repositories even with push access', () => {
    const payload = repoPayload({ archived: true, permissions: { push: true, admin: true } });
    const meta = normalizeRepository(payload, normalizePermissions(payload));
    expect(() => assertWriteAccess(meta)).toThrow(/archived/);
  });

  it('produces the read-only UI contract for repositories the user cannot push to', () => {
    const payload = repoPayload({ permissions: { pull: true } });
    const meta = normalizeRepository(payload, normalizePermissions(payload));
    expect(summarizeAccess(meta)).toMatchObject({ mode: 'read_only', canWrite: false, canFork: true, role: 'read' });
  });

  it('marks private repositories without write access as non-forkable', () => {
    const payload = repoPayload({ private: true, permissions: { pull: true } });
    const meta = normalizeRepository(payload, normalizePermissions(payload));
    expect(summarizeAccess(meta).canFork).toBe(false);
  });
});

describe('mapGithubError', () => {
  const err = (status, message, headers = {}) => ({ status, message, response: { status, headers } });

  it('maps 401 to a reconnect prompt', () => {
    expect(mapGithubError(err(401, 'Bad credentials')).code).toBe('GITHUB_AUTH_EXPIRED');
  });

  it('maps exhausted rate limits to a friendly message', () => {
    const mapped = mapGithubError(err(403, 'API rate limit exceeded', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) }));
    expect(mapped.code).toBe('GITHUB_RATE_LIMIT');
    expect(mapped.message).toMatch(/rate limit/i);
    expect(mapped.status).toBe(429);
  });

  it('maps 404 by resource type', () => {
    expect(mapGithubError(err(404, 'Not Found'), { resource: 'repository' }).code).toBe('REPO_NOT_FOUND');
    expect(mapGithubError(err(404, 'Not Found'), { resource: 'branch', branch: 'dev' }).message).toMatch(/dev/);
    expect(mapGithubError(err(404, 'Not Found'), { resource: 'file', path: 'a.js' }).message).toMatch(/a\.js/);
  });

  it('maps 422 conflicts to actionable messages', () => {
    expect(mapGithubError(err(422, 'Reference already exists')).message).toMatch(/branch already exists/);
    expect(mapGithubError(err(422, 'No commits between main and feature')).message).toMatch(/no changes/i);
    expect(mapGithubError(err(422, 'A pull request already exists for x')).message).toMatch(/already exists/);
  });

  it('maps empty-repository conflicts and server errors', () => {
    expect(mapGithubError(err(409, 'Git Repository is empty.')).message).toMatch(/empty/);
    expect(mapGithubError(err(502, 'Bad gateway')).code).toBe('GITHUB_ERROR');
  });

  it('passes AppErrors through untouched', () => {
    const original = new AppError('CUSTOM', 'custom message', 418);
    expect(mapGithubError(original)).toBe(original);
  });

  it('never leaks raw GitHub internals for unknown failures', () => {
    const mapped = mapGithubError({ message: 'socket hang up with token ghp_abcdefghijklmnopqrstuvwxyz123456' });
    expect(mapped.message).not.toMatch(/ghp_/);
  });
});
