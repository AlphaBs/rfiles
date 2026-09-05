import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { HASH, OTHER_HASH } from '../helpers/bucket';
import { auth, request } from '../helpers/request';

const key = `objects/${HASH}`;
const body = new Uint8Array([0, 127, 128, 255]);

beforeEach(async () => {
  await reset();
  const md5 = await crypto.subtle.digest('MD5', body);
  await env.FILES_BUCKET.put(key, body, {
    md5,
    httpMetadata: {
      contentType: 'image/png',
      contentDisposition: 'attachment; filename="fixture.png"',
      contentLanguage: 'ko',
      cacheControl: 'public, max-age=600',
    },
    customMetadata: { originalName: 'fixture.png', owner: 'test' },
  });
});

describe('Worker with a real local R2 binding', () => {
  it('streams existing bytes and all stored HTTP metadata without rewriting the object', async () => {
    const before = await env.FILES_BUCKET.head(key);
    const response = await request(`/md5/${HASH.toUpperCase()}`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body);
    expect(Object.fromEntries(response.headers)).toEqual({
      'content-type': 'image/png',
      'content-length': '4',
      'content-disposition': 'attachment; filename="fixture.png"',
      'content-language': 'ko',
      'cache-control': 'public, max-age=600',
      'content-md5': btoa(String.fromCharCode(...new Uint8Array(before!.checksums.md5!))),
      'last-modified': before!.uploaded.toUTCString(),
    });
    expect(JSON.stringify(await env.FILES_BUCKET.head(key))).toBe(JSON.stringify(before));
  });

  it('returns identical file headers for HEAD and no body', async () => {
    const download = await request(`/md5/${HASH}`);
    await download.arrayBuffer();
    const head = await request(`/md5/${HASH}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(Object.fromEntries(head.headers)).toEqual(Object.fromEntries(download.headers));
    expect((await head.arrayBuffer()).byteLength).toBe(0);
  });

  it('returns bodyless HEAD responses for missing files and the list', async () => {
    const missing = await request(`/md5/${OTHER_HASH}`, { method: 'HEAD' });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('');
    const list = await request('/md5?return=hash', { method: 'HEAD' });
    expect(list.status).toBe(200);
    expect(list.headers.has('allow')).toBe(false);
    expect(await list.text()).toBe('');
  });

  it('queries metadata in input order, keeping duplicates and ignoring unknown hashes', async () => {
    const stored = await env.FILES_BUCKET.head(key);
    const response = await request('/query', {
      method: 'POST',
      body: JSON.stringify({ md5: [HASH, OTHER_HASH, HASH.toUpperCase()] }),
    });
    const metadata = { uploaded: stored!.uploaded.toISOString(), size: 4, md5: HASH };
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual([metadata, metadata]);
  });

  it('preserves native R2 serialization in sync and signs only missing entries', async () => {
    const stored = await env.FILES_BUCKET.head(key);
    const response = await request('/sync', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ md5: [HASH, OTHER_HASH] }),
    });
    expect(response.status).toBe(200);
    const result = await response.json<{
      objects: unknown[];
      uploads: { md5: string; method: string; url: string; headers: Record<string, string> }[];
    }>();
    expect(result.objects).toEqual([JSON.parse(JSON.stringify(stored))]);
    expect(result.uploads).toHaveLength(1);
    expect(result.uploads[0].md5).toBe(OTHER_HASH);
    expect(result.uploads[0].method).toBe('PUT');
    expect(result.uploads[0].headers).toEqual({
      'Content-MD5': '1B2M2Y8AsgTpgAmY7PhCfg==',
      'If-Unmodified-Since': 'Tue, 28 Sep 2021 16:00:00 GMT',
    });
    const url = new URL(result.uploads[0].url);
    expect(url.origin).toBe('https://test-account.r2.cloudflarestorage.com');
    expect(url.pathname).toBe(`/files/objects/${OTHER_HASH}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-md5;host;if-unmodified-since',
    );
    expect(await env.FILES_BUCKET.head(`objects/${OTHER_HASH}`)).toBeNull();
  });

  it('lists the original prefix, including keys without an objects/ separator', async () => {
    await env.FILES_BUCKET.put('objects-old/extra', 'extra');
    await env.FILES_BUCKET.put('unrelated/file', 'unrelated');
    const response = await request('/md5?return=hash');
    expect(await response.json()).toEqual(['old/extra', HASH]);
    const metadata = await request('/md5?return=object');
    expect(await metadata.json()).toEqual([
      {
        uploaded: (await env.FILES_BUCKET.head('objects-old/extra'))!.uploaded.toISOString(),
        size: 5,
        md5: 'old/extra',
      },
      { uploaded: (await env.FILES_BUCKET.head(key))!.uploaded.toISOString(), size: 4, md5: HASH },
    ]);
  });

  it('deletes only the normalized key and is idempotent', async () => {
    await env.FILES_BUCKET.put(`unrelated/${HASH}`, 'other');
    for (let i = 0; i < 2; i++) {
      const response = await request(`/md5/${HASH.toUpperCase()}`, {
        method: 'DELETE',
        headers: auth,
      });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
    }
    expect(await env.FILES_BUCKET.head(key)).toBeNull();
    expect(await env.FILES_BUCKET.head(`unrelated/${HASH}`)).not.toBeNull();
  });

  it('does not mutate storage when authentication fails', async () => {
    const before = JSON.stringify(await env.FILES_BUCKET.head(key));
    for (const method of ['POST', 'DELETE']) {
      const unauthorized = await request(`/md5/${HASH}`, { method });
      expect(unauthorized.status).toBe(401);
      const forbidden = await request(`/md5/${HASH}`, {
        method,
        headers: { 'x-client-secret': 'wrong' },
      });
      expect(forbidden.status).toBe(403);
    }
    expect(JSON.stringify(await env.FILES_BUCKET.head(key))).toBe(before);
  });

  it('issues an upload without storing bytes or changing metadata', async () => {
    const before = JSON.stringify(await env.FILES_BUCKET.head(key));
    const response = await request(`/md5/${HASH}?exists=overwrite`, {
      method: 'POST',
      headers: auth,
      body: 'ignored',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    const instruction = await response.json<{ md5: string; url: string }>();
    expect(instruction.md5).toBe(HASH);
    expect(new URL(instruction.url).pathname).toBe(`/files/${key}`);
    expect(JSON.stringify(await env.FILES_BUCKET.head(key))).toBe(before);
  });
});
