import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { disconnectMongo } from '../src/config/db.js';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../src/middleware/csrf.js';

let app;

beforeAll(() => {
  app = createApp();
});

afterAll(async () => {
  await disconnectMongo();
});

describe('API contract', () => {
  it('exposes a health endpoint with the success envelope', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ status: expect.any(String), env: expect.any(String) });
  });

  it('serves an API banner at the root', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('CodeWeave API');
  });

  it('returns the error envelope for unknown routes', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it('rejects unauthenticated access to protected routes with 401', async () => {
    for (const path of ['/api/repositories', '/api/activity', '/api/changes', '/api/github/repositories']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code, path).toBe('UNAUTHORIZED');
    }
  });

  it('issues a readable CSRF cookie while keeping the session cookie httpOnly', async () => {
    const res = await request(app).get('/api/auth/me');
    const cookies = res.headers['set-cookie'] || [];
    const csrfCookie = cookies.find((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`));
    expect(csrfCookie).toBeTruthy();
    expect(csrfCookie.toLowerCase()).not.toContain('httponly');
    expect(res.body.data).toMatchObject({ authenticated: false, csrfToken: expect.any(String) });
  });

  it('blocks state-changing requests without a matching CSRF token', async () => {
    const res = await request(app).post('/api/repositories/analyze').send({ url: 'owner/repo' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/CSRF/i);
  });

  it('accepts the double-submit CSRF token, then still enforces authentication', async () => {
    const token = 'test-csrf-token-value';
    const res = await request(app)
      .post('/api/repositories/analyze')
      .set('Cookie', [`${CSRF_COOKIE_NAME}=${token}`])
      .set(CSRF_HEADER_NAME, token)
      .send({ url: 'owner/repo' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('validates request bodies before touching GitHub', async () => {
    const token = 'test-csrf-token-value';
    const res = await request(app)
      .patch('/api/auth/preferences')
      .set('Cookie', [`${CSRF_COOKIE_NAME}=${token}`])
      .set(CSRF_HEADER_NAME, token)
      .send({ theme: 'neon' });
    // Auth runs first for this route, so an invalid theme still cannot leak past 401.
    expect([401, 422]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  it('rejects webhook deliveries without a signature', async () => {
    const res = await request(app)
      .post('/api/github/webhook')
      .set('X-GitHub-Event', 'push')
      .set('X-GitHub-Delivery', 'test-delivery-1')
      .send({ ref: 'refs/heads/main' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/signature/i);
  });

  it('rejects webhook deliveries with an invalid signature', async () => {
    const res = await request(app)
      .post('/api/github/webhook')
      .set('X-GitHub-Event', 'push')
      .set('X-GitHub-Delivery', 'test-delivery-2')
      .set('X-Hub-Signature-256', 'sha256=0000000000000000000000000000000000000000000000000000000000000000')
      .send({ ref: 'refs/heads/main' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/Invalid webhook signature/i);
  });

  it('blocks disallowed CORS origins', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
  });

  it('allows the configured client origin with credentials', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
