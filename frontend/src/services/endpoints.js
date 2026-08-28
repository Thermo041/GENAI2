import { api } from './api.js';

/** Every backend call the UI makes, in one place. */
export const authApi = {
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  setTheme: (theme) => api.patch('/auth/preferences', { theme }),
};

export const systemApi = {
  health: (deep = false) => api.get('/health', { params: deep ? { deep: 'true' } : {} }),
  activity: () => api.get('/activity'),
};

export const repoApi = {
  analyze: (url, branch) => api.post('/repositories/analyze', { url, ...(branch ? { branch } : {}) }),
  listAnalyzed: () => api.get('/repositories'),
  listGithub: () => api.get('/github/repositories'),
  details: (owner, repo) => api.get(`/repositories/${owner}/${repo}`),
  branches: (owner, repo) => api.get(`/repositories/${owner}/${repo}/branches`),
  tree: (owner, repo, branch) => api.get(`/repositories/${owner}/${repo}/tree`, { params: branch ? { branch } : {} }),
  file: (owner, repo, path, ref) => api.get(`/repositories/${owner}/${repo}/file`, { params: { path, ...(ref ? { ref } : {}) } }),
  commits: (owner, repo, branch) => api.get(`/repositories/${owner}/${repo}/commits`, { params: branch ? { branch } : {} }),
  symbols: (owner, repo, q) => api.get(`/repositories/${owner}/${repo}/symbols`, { params: { q } }),
  overview: (owner, repo) => api.get(`/repositories/${owner}/${repo}/overview`),
  generateOverview: (owner, repo, refresh = false) => api.post(`/repositories/${owner}/${repo}/overview`, { refresh }),
  graph: (owner, repo) => api.get(`/repositories/${owner}/${repo}/graph`),
  startIndex: (owner, repo, body = {}) => api.post(`/repositories/${owner}/${repo}/index`, body),
  indexStatus: (owner, repo) => api.get(`/repositories/${owner}/${repo}/index-status`),
  jobs: (owner, repo) => api.get(`/repositories/${owner}/${repo}/jobs`),
};

export const aiApi = {
  chat: (payload) => api.post('/ai/chat', payload),
  impact: (payload) => api.post('/ai/impact-analysis', payload),
  generateChange: (payload) => api.post('/ai/generate-change', payload),
  conversations: (owner, repo) => api.get('/ai/conversations', { params: { owner, repo } }),
  conversation: (owner, repo, conversationId) =>
    api.get('/ai/conversation', { params: { owner, repo, ...(conversationId ? { conversationId } : {}) } }),
};

export const changeApi = {
  list: (owner, repo) => api.get('/changes', { params: owner && repo ? { owner, repo } : {} }),
  get: (id) => api.get(`/changes/${id}`),
  accept: (id, payload) => api.post(`/changes/${id}/accept`, payload),
  reject: (id) => api.post(`/changes/${id}/reject`),
};

export const githubApi = {
  user: () => api.get('/github/user'),
  forkStatus: (owner, repo) => api.get(`/github/${owner}/${repo}/fork`),
  fork: (owner, repo) => api.post(`/github/${owner}/${repo}/fork`),
  createBranch: (owner, repo, payload) => api.post(`/github/${owner}/${repo}/branches`, payload),
  openPullRequest: (owner, repo, payload) => api.post(`/github/${owner}/${repo}/pull-request`, payload),
  pulls: (owner, repo, state = 'open') => api.get(`/github/${owner}/${repo}/pulls`, { params: { state } }),
  pull: (owner, repo, number) => api.get(`/github/${owner}/${repo}/pulls/${number}`),
  review: (owner, repo, number, payload = {}) => api.post(`/github/${owner}/${repo}/pulls/${number}/review`, payload),
  storedReview: (owner, repo, number) => api.get(`/github/${owner}/${repo}/pulls/${number}/review`),
};
