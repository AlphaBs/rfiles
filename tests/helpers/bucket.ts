import { vi } from 'vitest';

export const HASH = 'c09a30415c41bf3e39c58b7347e8ab1a';
export const OTHER_HASH = 'd41d8cd98f00b204e9800998ecf8427e';
export const UPLOADED = new Date('2023-11-01T01:02:03.000Z');

export function storedObject(key = `objects/${HASH}`, checksum = true) {
  return {
    key,
    version: 'fixture-version',
    size: 4,
    etag: HASH,
    httpEtag: `"${HASH}"`,
    uploaded: UPLOADED,
    httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'public, max-age=60' },
    customMetadata: { originalName: 'uploadfile' },
    checksums: checksum
      ? { md5: new Uint8Array(HASH.match(/../g)!.map((pair) => parseInt(pair, 16))).buffer }
      : {},
    storageClass: 'Standard',
    writeHttpMetadata(headers: Headers) {
      headers.set('Content-Type', 'application/octet-stream');
      headers.set('Cache-Control', 'public, max-age=60');
    },
  };
}

export function createBucket() {
  const objects = new Map([
    [`objects/${HASH}`, storedObject()],
    // The old prefix is "objects", without a slash. Keep this edge case observable.
    ['objects-old/abc', storedObject('objects-old/abc', false)],
  ]);
  const head = vi.fn(async (key: string) => objects.get(key) ?? null);
  const get = vi.fn(async (key: string) => {
    const object = objects.get(key);
    return object ? { ...object, body: new Response('test').body } : null;
  });
  const list = vi.fn(async () => ({
    objects: [...objects.values()],
    truncated: true,
    cursor: 'not-followed',
  }));
  const remove = vi.fn(async (key: string) => {
    objects.delete(key);
  });
  return {
    binding: { head, get, list, delete: remove } as unknown as R2Bucket,
    calls: () => ({
      head: head.mock.calls,
      get: get.mock.calls,
      list: list.mock.calls,
      delete: remove.mock.calls,
    }),
    head,
  };
}
