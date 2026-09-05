import { AwsClient } from 'aws4fetch';
import { hexToBase64 } from '../../lib/encoding';
import type { Env } from '../../types/env';
import { objectKey } from './repository';
import type { UploadInstruction } from './schemas';

export type ExistsMode = 'error' | 'overwrite';

export async function createUploadInstruction(
  hash: string,
  exists: ExistsMode,
  env: Env,
): Promise<UploadInstruction> {
  // R2's earliest accepted date prevents replacing an existing object in error mode.
  const unmodifiedSince = exists === 'overwrite' ? new Date() : new Date(1632844800000);
  const signer = new AwsClient({
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  });
  const url = new URL(env.S3_ENDPOINT);
  // Do not resolve or insert a slash: existing S3_ENDPOINT concatenation is contractual.
  url.pathname += objectKey(hash);
  url.searchParams.set('X-Amz-Expires', '600');
  const headers = {
    'If-Unmodified-Since': unmodifiedSince.toUTCString(),
    'Content-MD5': hexToBase64(hash),
  };
  const signed = await signer.sign(url, {
    method: 'PUT',
    headers,
    aws: { signQuery: true, allHeaders: true },
  });
  return { method: 'PUT', url: signed.url, headers };
}
