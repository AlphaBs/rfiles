import * as v from 'valibot';
import { MD5_PATTERN } from '../../lib/encoding';

export const MAX_HASHES = 1000;
export const hashSchema = v.pipe(v.string(), v.length(32), v.regex(MD5_PATTERN));
// Stored legacy objects can still appear in list and metadata responses.
export const hashListSchema = v.array(v.string());
export const bulkRequestSchema = v.object({
  md5: v.pipe(v.array(hashSchema), v.maxLength(MAX_HASHES)),
});
export const metadataSchema = v.object({
  uploaded: v.pipe(v.string(), v.isoTimestamp()),
  size: v.number(),
  md5: v.string(),
});
export const uploadSchema = v.object({
  md5: hashSchema,
  method: v.literal('PUT'),
  url: v.string(),
  headers: v.object({ 'If-Unmodified-Since': v.string(), 'Content-MD5': v.string() }),
});
export const errorSchema = v.object({ error: v.string() });

// /sync exposes R2Object's native JSON shape, unlike /query and return=object.
export const storedObjectSchema = v.looseObject({
  key: v.string(),
  version: v.string(),
  size: v.number(),
  etag: v.string(),
  httpEtag: v.string(),
  uploaded: v.pipe(v.string(), v.isoTimestamp()),
  httpMetadata: v.optional(v.record(v.string(), v.unknown())),
  customMetadata: v.optional(v.record(v.string(), v.string())),
  checksums: v.record(v.string(), v.unknown()),
  storageClass: v.optional(v.string()),
});
export const syncResponseSchema = v.object({
  objects: v.array(storedObjectSchema),
  uploads: v.array(uploadSchema),
});
export type UploadInstruction = v.InferOutput<typeof uploadSchema>;
