import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { HASH } from '../helpers/bucket';
import { auth, request } from '../helpers/request';

const encodedHash = `%63${HASH.slice(1)}`;

beforeEach(async () => {
  await reset();
  await env.FILES_BUCKET.put(`objects/${HASH}`, 'test');
});

describe('native Hono URL handling', () => {
  it.each([
    ['/md5/?return=hash', 'GET'],
    [`/md5/${HASH}/`, 'GET'],
    [`/md5/${HASH}/`, 'DELETE'],
    ['/query/', 'POST'],
    ['/sync/', 'POST'],
  ])('rejects trailing slashes: %s %s', async (path, method) => {
    const response = await request(path, { method, headers: auth });
    expect(response.status).toBe(404);
    expect(response.headers.has('location')).toBe(false);
    await response.text();
    expect(await env.FILES_BUCKET.head(`objects/${HASH}`)).not.toBeNull();
  });

  it('uses decoded hashes for reads, upload instructions, and deletion', async () => {
    for (const method of ['GET', 'HEAD']) {
      const response = await request(`/md5/${encodedHash}`, { method });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(method === 'GET' ? 'test' : '');
    }
    const upload = await request(`/md5/${encodedHash}`, { method: 'POST', headers: auth });
    const instruction = await upload.json<{ url: string }>();
    expect(new URL(instruction.url).pathname).toBe(`/files/objects/${HASH}`);
    const deletion = await request(`/md5/${encodedHash}`, { method: 'DELETE', headers: auth });
    expect(deletion.status).toBe(204);
    expect(await env.FILES_BUCKET.head(`objects/${HASH}`)).toBeNull();
  });

  it('decodes path parameters once and leaves bulk JSON hashes undecoded', async () => {
    const doubleEncoded = await request(`/md5/%2563${HASH.slice(1)}`);
    expect(doubleEncoded.status).toBe(400);
    await doubleEncoded.text();
    const bulk = await request('/query', {
      method: 'POST',
      body: JSON.stringify({ md5: [encodedHash, HASH] }),
    });
    expect(bulk.status).toBe(400);
    expect(await bulk.json()).toEqual({ error: 'bad_request' });
  });

  it('uses the first repeated query value', async () => {
    const hashes = await request('/md5?return=hash&return=object');
    expect(await hashes.json()).toEqual([HASH]);
    const invalid = await request('/md5?return=invalid&return=hash');
    expect(invalid.status).toBe(400);
    await invalid.text();
    for (const [query, overwrite] of [
      ['exists=overwrite&exists=error', true],
      ['exists=error&exists=overwrite', false],
    ] as const) {
      const response = await request(`/md5/${HASH}?${query}`, { method: 'POST', headers: auth });
      const instruction = await response.json<{ headers: Record<string, string> }>();
      expect(instruction.headers['If-Unmodified-Since'] !== 'Tue, 28 Sep 2021 16:00:00 GMT').toBe(
        overwrite,
      );
    }
  });
});
