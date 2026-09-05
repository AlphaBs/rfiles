import { describe, expect, it } from 'vitest';
import type { OpenAPIV3_1 } from 'openapi-types';
import { createApp } from '../../src/app';
import { request } from '../helpers/request';

async function document() {
  const response = await request('/openapi.json');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  return response.json<OpenAPIV3_1.Document>();
}

describe('generated OpenAPI and Scalar', () => {
  it('discovers registered operations and describes HEAD alongside GET', async () => {
    const spec = await document();
    expect(spec.openapi).toBe('3.1.0');
    expect(createApp().routes.some((route) => route.method === 'HEAD')).toBe(false);
    expect(spec.paths!['/md5/{hash}']!.get!.description).toContain('HEAD is also supported');
    expect(spec.paths!['/md5/{hash}']!.get!.description).toContain(
      'returns no body, including on errors',
    );
    expect(
      Object.fromEntries(
        Object.entries(spec.paths!).map(([path, operations]) => [
          path,
          Object.keys(operations!).sort(),
        ]),
      ),
    ).toEqual({
      '/md5': ['get'],
      '/md5/{hash}': ['delete', 'get', 'post'],
      '/query': ['post'],
      '/sync': ['post'],
    });
    expect(spec.components!.securitySchemes!.clientSecret).toEqual({
      type: 'apiKey',
      name: 'x-client-secret',
      in: 'header',
    });
    for (const [path, method] of [
      ['/md5/{hash}', 'post'],
      ['/md5/{hash}', 'delete'],
      ['/sync', 'post'],
    ] as const) {
      expect(spec.paths![path]![method]!.security).toEqual([{ clientSecret: [] }]);
    }
    expect(spec.paths!['/query']!.post!.security).toBeUndefined();
    expect(spec.paths!['/md5/{hash}']!.get!.security).toBeUndefined();
  });

  it('documents JSON media types, validation limit, and distinct response shapes', async () => {
    const spec = await document();
    const query = spec.paths!['/query']!.post!;
    expect(query.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            required: ['md5'],
            properties: { md5: { type: 'array', maxItems: 1000, items: { type: 'string' } } },
          },
        },
      },
    });
    expect(query.responses!['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { type: 'array', items: { required: ['uploaded', 'size', 'md5'] } },
        },
      },
    });
    expect(query.responses!['500']).toMatchObject({
      content: { 'application/json': { schema: { properties: { error: { type: 'string' } } } } },
    });
    expect(spec.paths!['/md5/{hash}']!.post!.responses!['200']).toMatchObject({
      content: {
        'application/json': { schema: { required: ['md5', 'method', 'url', 'headers'] } },
      },
    });
    expect(spec.paths!['/sync']!.post!.responses!['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            properties: {
              objects: {
                items: { required: ['uploaded', 'size', 'md5'] },
              },
            },
          },
        },
      },
    });
  });

  it('serves Scalar linked to the generated specification without embedding credentials', async () => {
    const response = await request('/docs');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('/openapi.json');
    expect(html).toContain('@scalar/api-reference');
    expect(html).toContain('rfiles API');
    expect(html).toContain('https://files.example');
    expect(html).not.toContain('test-secret');
    expect(html).not.toContain('test-access-key');
  });

  it('returns the same document on repeated requests', async () => {
    expect(await document()).toEqual(await document());
  });

  it('documents the immutable default only on successful file downloads', async () => {
    const spec = await document();
    expect(spec.paths!['/md5/{hash}']!.get!.responses!['200']).toMatchObject({
      headers: {
        'Cache-Control': {
          schema: { type: 'string', example: 'public, max-age=31536000, immutable' },
        },
      },
    });
    expect(spec.paths!['/md5/{hash}']!.get!.description).toContain(
      'without adding the immutable cache default',
    );
    expect(spec.paths!['/md5/{hash}']!.get!.responses!['404']).not.toHaveProperty(
      'headers.Cache-Control',
    );
  });
});
