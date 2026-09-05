import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { HASH, OTHER_HASH } from '../helpers/bucket';
import { auth, request } from '../helpers/request';

const key = `objects/${HASH}`;

beforeEach(async () => {
  await reset();
  await env.FILES_BUCKET.put(key, 'test', { httpMetadata: { contentType: 'text/plain' } });
});

describe('download cache policy', () => {
  it('adds a one-year immutable default without changing bytes or R2 metadata', async () => {
    const before = JSON.stringify(await env.FILES_BUCKET.head(key));
    const response = await request(`/md5/${HASH}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('content-type')).toBe('text/plain');
    expect(await response.text()).toBe('test');
    expect(JSON.stringify(await env.FILES_BUCKET.head(key))).toBe(before);

    const head = await request(`/md5/${HASH}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.has('cache-control')).toBe(false);
    expect(await head.text()).toBe('');
  });

  it.each(['private, no-store', 'no-cache', 'public, max-age=600', ''])(
    'preserves an explicit Cache-Control value: %s',
    async (cacheControl) => {
      await env.FILES_BUCKET.put(key, 'test', { httpMetadata: { cacheControl } });
      for (const method of ['GET', 'HEAD']) {
        const response = await request(`/md5/${HASH}`, { method });
        expect(response.status).toBe(200);
        // The HTTP transport may omit an explicitly empty header.
        expect(response.headers.get('cache-control') ?? '').toBe(cacheControl);
        await response.arrayBuffer();
      }
    },
  );

  it('preserves Expires without adding a conflicting freshness lifetime', async () => {
    const cacheExpiry = new Date('2030-01-01T00:00:00Z');
    await env.FILES_BUCKET.put(key, 'test', { httpMetadata: { cacheExpiry } });
    const response = await request(`/md5/${HASH}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('expires')).toBe(cacheExpiry.toUTCString());
    expect(response.headers.has('cache-control')).toBe(false);
    await response.arrayBuffer();
  });

  it('preserves origin deletion and adds no long-lived policy to subsequent misses', async () => {
    const download = await request(`/md5/${HASH}`);
    expect(download.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    await download.arrayBuffer();
    const deleted = await request(`/md5/${HASH}`, { method: 'DELETE', headers: auth });
    expect(deleted.status).toBe(204);
    expect(deleted.headers.has('cache-control')).toBe(false);
    expect(await env.FILES_BUCKET.head(key)).toBeNull();
    for (const method of ['GET', 'HEAD']) {
      const response = await request(`/md5/${HASH}`, { method });
      expect(response.status).toBe(404);
      expect(response.headers.has('cache-control')).toBe(false);
      await response.arrayBuffer();
    }
  });

  it.each([
    { path: '/md5?return=hash', method: 'GET', status: 200 },
    { path: '/md5?return=object', method: 'GET', status: 200 },
    { path: '/query', method: 'POST', body: '{"md5":[]}', status: 200 },
    { path: '/sync', method: 'POST', body: '{"md5":[]}', headers: auth, status: 200 },
    { path: `/md5/${HASH}`, method: 'POST', headers: auth, status: 200 },
    { path: `/md5/${HASH}`, method: 'POST', status: 401 },
    { path: `/md5/${HASH}`, method: 'PUT', status: 404 },
    { path: `/md5/${OTHER_HASH}`, method: 'GET', status: 404 },
    { path: '/unknown', method: 'GET', status: 404 },
    { path: '/query', method: 'POST', body: '{}', status: 400 },
    { path: '/openapi.json', method: 'GET', status: 200 },
    { path: '/docs', method: 'GET', status: 200 },
  ])('does not add the policy to $method $path ($status)', async ({ path, status, ...init }) => {
    const response = await request(path, init);
    expect(response.status).toBe(status);
    expect(response.headers.has('cache-control')).toBe(false);
    await response.arrayBuffer();
  });
});
