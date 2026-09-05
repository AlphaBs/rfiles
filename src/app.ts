import { Hono } from 'hono';
import { registerDocs } from './docs';
import { handleError } from './middleware/error';
import { fileRoutes } from './modules/files/routes';
import type { AppEnv } from './types/env';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.notFound((context) => context.json({ error: "can't find endpoint" }, 404));
  app.route('/', fileRoutes);
  registerDocs(app);
  return app;
}
