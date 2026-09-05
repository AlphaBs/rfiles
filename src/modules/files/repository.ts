import { encodeBase64, normalizeHash } from '../../lib/encoding';

// This exact prefix (including list's lack of a slash) is part of the storage contract.
export const OBJECT_PREFIX = 'objects';

export function objectKey(hash: string): string {
  return `${OBJECT_PREFIX}/${normalizeHash(hash)}`;
}

export function objectHash(object: R2Object): string {
  return object.key.slice(OBJECT_PREFIX.length + 1);
}

export function objectMetadata(object: R2Object) {
  return { uploaded: object.uploaded, size: object.size, md5: objectHash(object) };
}

export function objectHeaders(object: R2Object): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Length', String(object.size));
  headers.set('Last-Modified', object.uploaded.toUTCString());
  if (object.checksums?.md5) headers.set('Content-MD5', encodeBase64(object.checksums.md5));
  return headers;
}

export class FileRepository {
  constructor(private readonly bucket: R2Bucket) {}

  async list() {
    // Preserve the single page behavior; fetching further pages changes the response.
    const page = await this.bucket.list({ prefix: OBJECT_PREFIX });
    return page.objects;
  }

  get(hash: string) {
    return this.bucket.get(objectKey(hash));
  }
  head(hash: string) {
    return this.bucket.head(objectKey(hash));
  }
  delete(hash: string) {
    return this.bucket.delete(objectKey(hash));
  }
}
