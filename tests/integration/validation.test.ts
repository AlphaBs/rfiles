import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../src/index';
import { createBucket, HASH } from '../helpers/bucket';
import { auth, request } from '../helpers/request';

describe('MD5 validation', () => {
  it.each(['GET', 'HEAD', 'POST', 'DELETE'])(
    'rejects invalid %s hashes before R2 access',
    async (method) => {
      const bucket = createBucket();
      const context = createExecutionContext();
      const response = await worker.fetch(
        new Request('https://files.example/md5/not-a-hash', { method, headers: auth }),
        { ...env, FILES_BUCKET: bucket.binding },
        context,
      );
      await waitOnExecutionContext(context);
      expect(response.status).toBe(400);
      expect(bucket.calls()).toEqual({ get: [], head: [], list: [], delete: [] });
      await response.arrayBuffer();
      if (method === 'HEAD') {
        const head = await request('/md5/not-a-hash', { method });
        expect(head.status).toBe(400);
        expect(await head.text()).toBe('');
      }
    },
  );

  it.each(['/query', '/sync'])(
    'validates the entire %s request before storage access',
    async (path) => {
      for (const invalid of [
        '',
        'g'.repeat(32),
        '0'.repeat(31),
        '0'.repeat(33),
        ` ${HASH}`,
        `${HASH}\n`,
      ]) {
        const bucket = createBucket();
        const context = createExecutionContext();
        const response = await worker.fetch(
          new Request(`https://files.example${path}`, {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({ md5: [HASH, invalid] }),
          }),
          { ...env, FILES_BUCKET: bucket.binding },
          context,
        );
        await waitOnExecutionContext(context);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'bad_request' });
        expect(bucket.calls()).toEqual({ get: [], head: [], list: [], delete: [] });
      }
    },
  );
});
