import * as v from 'valibot';
import { HTTPException } from 'hono/http-exception';
import { normalizeHash } from '../../lib/encoding';
import type { Env } from '../../types/env';
import { FileRepository, objectMetadata } from './repository';
import { bulkRequestSchema, hashSchema, MAX_HASHES, type UploadInstruction } from './schemas';
import { createUploadInstruction } from './upload';

export function parseHash(hash: string): string {
  if (!v.safeParse(hashSchema, hash).success)
    throw new HTTPException(400, { message: 'bad_request' });
  return normalizeHash(hash);
}

export async function parseBulkRequest(request: Request): Promise<string[]> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (cause) {
    throw new HTTPException(400, { message: 'bad_request', cause });
  }
  // Size errors historically take precedence over invalid items.
  if (
    body &&
    typeof body === 'object' &&
    'md5' in body &&
    Array.isArray(body.md5) &&
    body.md5.length > MAX_HASHES
  ) {
    throw new HTTPException(413, { message: 'too_large_request' });
  }
  const result = v.safeParse(bulkRequestSchema, body);
  if (!result.success) throw new HTTPException(400, { message: 'bad_request' });
  return result.output.md5.map(normalizeHash);
}

export class FileService {
  readonly repository: FileRepository;

  constructor(private readonly env: Env) {
    this.repository = new FileRepository(env.FILES_BUCKET);
  }

  async query(hashes: string[]) {
    const objects: R2Object[] = [];
    for (const hash of hashes) {
      const object = await this.repository.head(hash);
      if (object) objects.push(object);
    }
    return objects.map(objectMetadata);
  }

  async sync(hashes: string[]) {
    const objects: R2Object[] = [];
    const uploads: UploadInstruction[] = [];
    // Keep order and duplicates, including one signed instruction per missing input.
    for (const hash of hashes) {
      const object = await this.repository.head(hash);
      if (object) objects.push(object);
      else uploads.push(await createUploadInstruction(hash, 'error', this.env));
    }
    return { objects, uploads };
  }
}
