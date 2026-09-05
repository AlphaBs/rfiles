import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeHash, hexToBase64, encodeBase64 } from '../../src/lib/encoding';
import { objectHeaders, objectKey } from '../../src/modules/files/repository';
import { createUploadInstruction } from '../../src/modules/files/upload';
import { HASH, storedObject } from '../helpers/bucket';

afterEach(() => vi.useRealTimers());

describe('persistent key and signing behavior', () => {
  it('normalizes valid MD5 hashes and preserves their keys and checksums', () => {
    expect(normalizeHash(HASH.toUpperCase())).toBe(HASH);
    expect(objectKey(HASH.toUpperCase())).toBe(`objects/${HASH}`);
    expect(hexToBase64(HASH)).toBe('wJowQVxBvz45xYtzR+irGg==');
    expect(hexToBase64(HASH.toUpperCase())).toBe(hexToBase64(HASH));
    expect(encodeBase64(new Uint8Array([0, 127, 128, 255]).buffer)).toBe('AH+A/w==');
  });

  it.each(['', 'a', 'gg', 'AB-CD', '0'.repeat(31), '0'.repeat(33), '_'.repeat(32)])(
    'rejects invalid MD5 input: %s',
    (hash) => {
      expect(() => normalizeHash(hash)).toThrow('Invalid MD5 hash');
      expect(() => hexToBase64(hash)).toThrow('Invalid MD5 hash');
    },
  );

  it('does not invent an MD5 header when R2 has no checksum', () => {
    const headers = objectHeaders(storedObject(`objects/${HASH}`, false) as unknown as R2Object);
    expect(headers.has('content-md5')).toBe(false);
    expect(headers.get('content-length')).toBe('4');
    expect(headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('retains endpoint concatenation and query parameters', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-01-02T03:04:05Z'));
    const instruction = await createUploadInstruction(HASH, 'error', {
      ...env,
      S3_ENDPOINT: 'https://test-account.r2.cloudflarestorage.com/files?custom=1',
    });
    const url = new URL(instruction.url);
    expect(instruction.md5).toBe(HASH);
    expect(url.pathname).toBe(`/filesobjects/${HASH}`);
    expect(url.searchParams.get('custom')).toBe('1');
    expect(url.searchParams.get('X-Amz-Date')).toBe('20240102T030405Z');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(instruction.headers['If-Unmodified-Since']).toBe('Tue, 28 Sep 2021 16:00:00 GMT');
  });
});
