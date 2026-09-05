import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';
import { createBucket, HASH, OTHER_HASH } from '../helpers/bucket';

// Recorded against main at 4376e99d1858682f27ac414ad014e53f7bf93759 BEFORE
// the Hono migration, then adjusted only for the approved HTTP response, routing, and MD5 validation changes
// documented in docs/compatibility.md. Other storage calls and signed URLs stay fixed.
interface Scenario {
  name: string;
  path: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}
const auth = { 'x-client-secret': 'test-secret' };
const scenarios: Scenario[] = [
  { name: 'unknown endpoint', path: '/' },
  { name: 'unknown nested endpoint', path: '/md5/a/b' },
  { name: 'unknown bulk method', path: '/query', method: 'GET' },
  { name: 'missing return mode', path: '/md5' },
  { name: 'old documented md5 mode is rejected', path: '/md5?return=md5' },
  { name: 'list hashes', path: '/md5?return=hash' },
  { name: 'list metadata', path: '/md5?return=object' },
  { name: 'trailing slash', path: '/md5/?return=hash' },
  { name: 'double trailing slash', path: '/md5//?return=hash' },
  { name: 'duplicate return mode', path: '/md5?return=hash&return=object' },
  { name: 'encoded query parameter', path: '/md5?ret%75rn=h%61sh' },
  { name: 'list wrong method', path: '/md5', method: 'POST' },
  { name: 'list HEAD', path: '/md5?return=hash', method: 'HEAD' },
  { name: 'download', path: `/md5/${HASH}` },
  { name: 'uppercase hash', path: `/md5/${HASH.toUpperCase()}` },
  { name: 'download trailing slash', path: `/md5/${HASH}/` },
  { name: 'download double trailing slash', path: `/md5/${HASH}//` },
  { name: 'missing download', path: `/md5/${OTHER_HASH}` },
  { name: 'HEAD', path: `/md5/${HASH}`, method: 'HEAD' },
  { name: 'missing HEAD', path: `/md5/${OTHER_HASH}`, method: 'HEAD' },
  { name: 'legacy punctuation normalization', path: '/md5/G:A-Z_09%2F' },
  { name: 'percent encoded hash is decoded', path: `/md5/%63${HASH.slice(1)}` },
  { name: 'malformed percent encoding', path: '/md5/%ZZ' },
  { name: 'object PUT remains unsupported', path: `/md5/${HASH}`, method: 'PUT' },
  { name: 'object OPTIONS remains unsupported', path: `/md5/${HASH}`, method: 'OPTIONS' },
  { name: 'object PATCH remains unsupported', path: `/md5/${HASH}`, method: 'PATCH' },
  { name: 'upload unauthorized', path: `/md5/${HASH}`, method: 'POST' },
  {
    name: 'upload empty secret',
    path: `/md5/${HASH}`,
    method: 'POST',
    headers: { 'x-client-secret': '' },
  },
  {
    name: 'upload forbidden',
    path: `/md5/${HASH}`,
    method: 'POST',
    headers: { 'x-client-secret': 'wrong' },
  },
  { name: 'upload signature', path: `/md5/${HASH}`, method: 'POST', headers: auth },
  {
    name: 'upload uppercase signature',
    path: `/md5/${HASH.toUpperCase()}`,
    method: 'POST',
    headers: auth,
  },
  {
    name: 'upload overwrite signature',
    path: `/md5/${HASH}?exists=overwrite`,
    method: 'POST',
    headers: auth,
  },
  {
    name: 'upload unknown exists means error',
    path: `/md5/${HASH}?exists=skip`,
    method: 'POST',
    headers: auth,
  },
  {
    name: 'upload duplicate exists: first wins',
    path: `/md5/${HASH}?exists=overwrite&exists=overwrite`,
    method: 'POST',
    headers: auth,
  },
  { name: 'upload permissive hash', path: '/md5/not-a-hash', method: 'POST', headers: auth },
  { name: 'delete', path: `/md5/${HASH}`, method: 'DELETE', headers: auth },
  { name: 'delete missing object', path: `/md5/${OTHER_HASH}`, method: 'DELETE', headers: auth },
  { name: 'delete unauthorized', path: `/md5/${HASH}`, method: 'DELETE' },
  {
    name: 'delete forbidden',
    path: `/md5/${HASH}`,
    method: 'DELETE',
    headers: { 'x-client-secret': 'wrong' },
  },
  {
    name: 'query includes duplicates and omits missing',
    path: '/query',
    method: 'POST',
    body: JSON.stringify({ md5: [HASH, OTHER_HASH, HASH] }),
  },
  {
    name: 'query trailing slash',
    path: '/query/',
    method: 'POST',
    body: JSON.stringify({ md5: [HASH] }),
  },
  { name: 'query empty list', path: '/query', method: 'POST', body: '{"md5":[]}' },
  {
    name: 'query accepts unrelated fields',
    path: '/query',
    method: 'POST',
    body: '{"md5":[],"extra":1}',
  },
  {
    name: 'query ignores Content-Type',
    path: '/query',
    method: 'POST',
    body: JSON.stringify({ md5: [HASH] }),
    headers: { 'content-type': 'text/plain' },
  },
  {
    name: 'query too large before invalid items',
    path: '/query',
    method: 'POST',
    body: JSON.stringify({ md5: Array(1001).fill(null) }),
  },
  { name: 'sync unauthorized before parsing', path: '/sync', method: 'POST', body: 'invalid' },
  {
    name: 'sync forbidden before parsing',
    path: '/sync',
    method: 'POST',
    body: 'invalid',
    headers: { 'x-client-secret': 'wrong' },
  },
  {
    name: 'sync raw R2 metadata and upload signature',
    path: '/sync',
    method: 'POST',
    body: JSON.stringify({ md5: [HASH, OTHER_HASH, OTHER_HASH] }),
    headers: auth,
  },
  {
    name: 'sync uppercase checksum uses original input',
    path: '/sync',
    method: 'POST',
    body: JSON.stringify({ md5: [OTHER_HASH.toUpperCase()] }),
    headers: auth,
  },
  {
    name: 'sync permissive checksum uses original input',
    path: '/sync',
    method: 'POST',
    body: '{"md5":["AB-CD","g!",""]}',
    headers: auth,
  },
  { name: 'sync empty list', path: '/sync', method: 'POST', body: '{"md5":[]}', headers: auth },
];
for (const path of ['/query', '/sync', '/md5', `/md5/${HASH}`, '/unknown']) {
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    scenarios.push({ name: `${method} ${path} method matrix`, path, method, headers: auth });
  }
}
for (const path of ['/query', '/sync']) {
  for (const [name, body] of Object.entries({
    null: 'null',
    array: '[]',
    string: '"string"',
    missing: '{}',
    scalar: '{"md5":"abc"}',
    nonstring: '{"md5":["a",3]}',
    malformed: '{',
    empty: '',
  })) {
    scenarios.push({ name: `${path} ${name} body`, path, method: 'POST', body, headers: auth });
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2024-01-02T03:04:05.000Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe('legacy HTTP and storage contract', () => {
  it.each(scenarios)('$name', async ({ path, method = 'GET', body, headers }) => {
    const bucket = createBucket();
    const context = createExecutionContext();
    const request = new Request(`https://files.example${path}`, { method, body, headers });
    const response = await worker.fetch(request, { ...env, FILES_BUCKET: bucket.binding }, context);
    await waitOnExecutionContext(context);
    const text = new TextDecoder().decode(await response.arrayBuffer());
    // HEAD bodies are suppressed by the HTTP runtime, even if a handler creates one.
    expect({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: method === 'HEAD' ? '' : text,
      storage: bucket.calls(),
    }).toMatchSnapshot();
  });

  it('accepts exactly 1000 items without changing their order or keys', async () => {
    const bucket = createBucket();
    const context = createExecutionContext();
    const response = await worker.fetch(
      new Request('https://files.example/query', {
        method: 'POST',
        body: JSON.stringify({ md5: Array(1000).fill(OTHER_HASH) }),
      }),
      { ...env, FILES_BUCKET: bucket.binding },
      context,
    );
    await waitOnExecutionContext(context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(bucket.calls().head).toEqual(Array(1000).fill([`objects/${OTHER_HASH}`]));
  });

  it('returns a generic JSON error for string rejections from storage', async () => {
    const bucket = createBucket();
    bucket.head.mockRejectedValueOnce('R2 unavailable');
    const context = createExecutionContext();
    const response = await worker.fetch(
      new Request('https://files.example/query', {
        method: 'POST',
        body: JSON.stringify({ md5: [HASH] }),
      }),
      { ...env, FILES_BUCKET: bucket.binding },
      context,
    );
    await waitOnExecutionContext(context);
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.text()).toBe('{"error":"internal_server_error"}');
  });

  it('preserves unexpected storage error responses', async () => {
    const bucket = createBucket();
    bucket.head.mockRejectedValueOnce(new Error('R2 unavailable'));
    const context = createExecutionContext();
    const response = await worker.fetch(
      new Request('https://files.example/query', {
        method: 'POST',
        body: JSON.stringify({ md5: [HASH] }),
      }),
      { ...env, FILES_BUCKET: bucket.binding },
      context,
    );
    await waitOnExecutionContext(context);
    expect({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    }).toMatchSnapshot();
  });

  it('does not misclassify a storage SyntaxError as a malformed client request', async () => {
    const bucket = createBucket();
    bucket.head.mockRejectedValueOnce(new SyntaxError('internal storage detail'));
    const context = createExecutionContext();
    const response = await worker.fetch(
      new Request('https://files.example/query', {
        method: 'POST',
        body: JSON.stringify({ md5: [HASH] }),
      }),
      { ...env, FILES_BUCKET: bucket.binding },
      context,
    );
    await waitOnExecutionContext(context);
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ error: 'internal_server_error' });
  });
});
