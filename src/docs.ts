import { Scalar } from '@scalar/hono-api-reference';
import type { Hono } from 'hono';
import { openAPIRouteHandler, type GenerateSpecOptions } from 'hono-openapi';
import type { AppEnv } from './types/env';

export const openAPIOptions: Partial<GenerateSpecOptions> = {
  documentation: {
    openapi: '3.1.0',
    info: {
      title: 'rfiles API',
      version: '0.0.0',
      description:
        'Hash based file storage on Cloudflare Workers and R2. Successful file downloads default to immutable caching; stored cache policies and the existing storage contract are preserved.',
    },
    tags: [{ name: 'Files' }, { name: 'Bulk' }],
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { clientSecret: { type: 'apiKey', in: 'header', name: 'x-client-secret' } },
    },
  },
  exclude: ['/docs', '/openapi.json'],
  excludeMethods: ['OPTIONS'],
  excludeStaticFile: false,
};

export function registerDocs(app: Hono<AppEnv>): void {
  app.get('/openapi.json', openAPIRouteHandler(app, openAPIOptions));
  app.get(
    '/docs',
    Scalar((context) => ({
      url: '/openapi.json',
      pageTitle: 'rfiles API',
      servers: [{ url: new URL(context.req.url).origin }],
      persistAuth: false,
      showDeveloperTools: 'never',
      agent: { disabled: true },
      cdn: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.67.0',
    })),
  );
}
