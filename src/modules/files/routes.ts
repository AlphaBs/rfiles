import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { toJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';
import { HTTPException } from 'hono/http-exception';
import { requireClientSecret } from '../../middleware/auth';
import type { AppEnv } from '../../types/env';
import { objectHash, objectHeaders, objectMetadata } from './repository';
import {
  bulkRequestSchema,
  errorSchema,
  hashListSchema,
  hashSchema,
  metadataSchema,
  syncResponseSchema,
  uploadSchema,
} from './schemas';
import { FileService, parseBulkRequest, parseHash } from './service';
import { createUploadInstruction } from './upload';

const defaultDownloadCacheControl = 'public, max-age=31536000, immutable';
const errorContent = { 'application/json': { schema: resolver(errorSchema) } };
const serverError = {
  description: 'Unexpected server error. Internal error details are not exposed.',
  content: errorContent,
};
const authErrors = {
  401: { description: 'Missing or empty x-client-secret.', content: errorContent },
  403: { description: 'Incorrect x-client-secret.', content: errorContent },
};
const security = [{ clientSecret: [] }];
const hashParameter = {
  name: 'hash',
  in: 'path' as const,
  required: true,
  description:
    '32 hexadecimal MD5 characters, case-insensitive. Hono percent-decodes the path parameter before validation.',
  schema: toJsonSchema(hashSchema) as OpenAPIV3.SchemaObject,
};
const fileHeaders = {
  'Content-Length': { description: 'File size in bytes.', schema: { type: 'integer' as const } },
  'Last-Modified': {
    description: 'R2 upload time as an HTTP date.',
    schema: { type: 'string' as const },
  },
  'Content-MD5': {
    description: 'Base64 checksum, when stored by R2.',
    schema: { type: 'string' as const },
  },
};
const bulkBody = {
  required: true,
  description:
    'At most 1000 MD5 hashes of 32 hexadecimal characters. Order and duplicates are retained; unknown properties are ignored. JSON is parsed regardless of Content-Type.',
  content: {
    'application/json': { schema: toJsonSchema(bulkRequestSchema) as OpenAPIV3_1.SchemaObject },
  },
};
const bulkErrors = {
  400: {
    description: 'Malformed JSON or invalid MD5 hashes.',
    content: errorContent,
  },
  413: { description: 'More than 1000 hashes (checked before item types).', content: errorContent },
  500: serverError,
};

export const fileRoutes = new Hono<AppEnv>();

fileRoutes.get(
  '/md5',
  describeRoute({
    operationId: 'listFiles',
    tags: ['Files'],
    summary: 'List the first page of stored files',
    description:
      'Lists the historical R2 prefix "objects". No pagination cursor is returned. HEAD uses the same handler and omits the response body.',
    parameters: [
      {
        name: 'return',
        in: 'query',
        required: true,
        description:
          'Required for success. Missing or unsupported values (including md5) return 400. Repeated parameters use the first value.',
        schema: { type: 'string', enum: ['hash', 'object'] },
      },
    ],
    responses: {
      200: {
        description: 'Hashes or file metadata.',
        content: {
          'application/json': {
            schema: resolver(v.union([hashListSchema, v.array(metadataSchema)])),
          },
        },
      },
      400: { description: 'Invalid return mode.', content: errorContent },
      500: serverError,
    },
  }),
  async (context) => {
    const mode = context.req.query('return');
    if (mode !== 'hash' && mode !== 'object')
      throw new HTTPException(400, { message: 'bad_request' });
    const objects = await new FileService(context.env).repository.list();
    return context.json(mode === 'hash' ? objects.map(objectHash) : objects.map(objectMetadata));
  },
);

fileRoutes.get(
  '/md5/:hash',
  describeRoute({
    operationId: 'downloadFile',
    tags: ['Files'],
    summary: 'Download a file',
    description:
      'Successful downloads default to one year of immutable caching when R2 metadata contains neither Cache-Control nor Expires. Stored cache policies take precedence. Deletion removes the origin object but does not revoke cached copies; metadata changes at the same URL may remain cached. HEAD is also supported at this URL: it uses R2.head() to read metadata only and returns no body, including on errors. HEAD returns 200 for existing files, 400 for invalid hashes, 404 for missing files, and 500 for unexpected errors. It forwards stored HTTP metadata without adding the immutable cache default.',
    parameters: [hashParameter],
    responses: {
      200: {
        description: 'File bytes and stored HTTP metadata.',
        headers: {
          ...fileHeaders,
          'Cache-Control': {
            description:
              'Stored object policy, or the immutable default when neither Cache-Control nor Expires is stored.',
            schema: { type: 'string', example: defaultDownloadCacheControl },
          },
        },
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      },
      400: { description: 'Invalid MD5 hash.', content: errorContent },
      404: { description: 'object_not_found.', content: errorContent },
      500: serverError,
    },
  }),
  async (context) => {
    const repository = new FileService(context.env).repository;
    const hash = parseHash(context.req.param('hash'));
    if (context.req.method === 'HEAD') {
      const object = await repository.head(hash);
      return object
        ? new Response(null, { headers: objectHeaders(object) })
        : context.body(null, 404);
    }
    const object = await repository.get(hash);
    if (!object) throw new HTTPException(404, { message: 'object_not_found' });
    const headers = objectHeaders(object);
    // Apply only to successful downloads. Respect explicitly stored cache policies,
    // including Expires, and leave HEAD headers unchanged.
    if (!headers.has('Cache-Control') && !headers.has('Expires')) {
      headers.set('Cache-Control', defaultDownloadCacheControl);
    }
    return new Response(object.body, { headers });
  },
);
fileRoutes.post(
  '/md5/:hash',
  describeRoute({
    operationId: 'createUpload',
    tags: ['Files'],
    summary: 'Create a signed R2 upload request',
    security,
    description:
      'Returns a PUT URL valid for 600 seconds. Send the file bytes directly to that URL with both returned headers. The instruction is returned as JSON.',
    parameters: [
      hashParameter,
      {
        name: 'exists',
        in: 'query',
        description:
          'The first value enables overwrite only when it is exactly overwrite; all other inputs mean error.',
        schema: { type: 'string', default: 'error' },
      },
    ],
    responses: {
      200: {
        description: 'Signed PUT instruction.',
        content: { 'application/json': { schema: resolver(uploadSchema) } },
      },
      400: { description: 'Invalid MD5 hash.', content: errorContent },
      ...authErrors,
      500: serverError,
    },
  }),
  requireClientSecret,
  async (context) => {
    const hash = parseHash(context.req.param('hash'));
    const mode = context.req.query('exists') === 'overwrite' ? 'overwrite' : 'error';
    return context.json(await createUploadInstruction(hash, mode, context.env));
  },
);

fileRoutes.delete(
  '/md5/:hash',
  describeRoute({
    operationId: 'deleteFile',
    tags: ['Files'],
    summary: 'Delete a file',
    security,
    parameters: [hashParameter],
    responses: {
      204: { description: 'Deleted, or already absent.' },
      400: { description: 'Invalid MD5 hash.', content: errorContent },
      ...authErrors,
      500: serverError,
    },
  }),
  requireClientSecret,
  async (context) => {
    await new FileService(context.env).repository.delete(parseHash(context.req.param('hash')));
    return context.body(null, 204);
  },
);

fileRoutes.post(
  '/query',
  describeRoute({
    operationId: 'queryFiles',
    tags: ['Bulk'],
    summary: 'Find metadata for existing hashes',
    requestBody: bulkBody,
    responses: {
      200: {
        description: 'Existing files, in input order; missing files omitted.',
        content: { 'application/json': { schema: resolver(v.array(metadataSchema)) } },
      },
      ...bulkErrors,
    },
  }),
  async (context) => {
    const hashes = await parseBulkRequest(context.req.raw);
    return context.json(await new FileService(context.env).query(hashes));
  },
);

fileRoutes.post(
  '/sync',
  describeRoute({
    operationId: 'syncFiles',
    tags: ['Bulk'],
    summary: 'Find files and create upload requests for missing hashes',
    security,
    requestBody: bulkBody,
    description:
      'objects contains { uploaded, size, md5 } metadata, matching /query. Missing inputs each produce an upload instruction; duplicates are retained.',
    responses: {
      200: {
        description: 'Existing R2 objects and signed upload requests.',
        content: { 'application/json': { schema: resolver(syncResponseSchema) } },
      },
      ...authErrors,
      ...bulkErrors,
    },
  }),
  requireClientSecret,
  async (context) => {
    const hashes = await parseBulkRequest(context.req.raw);
    return context.json(await new FileService(context.env).sync(hashes));
  },
);
