import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../types/env';

export const requireClientSecret = createMiddleware<AppEnv>(async (context, next) => {
  const secret = context.req.header('x-client-secret');
  if (!secret) throw new HTTPException(401, { message: 'unauthorized' });
  if (secret !== context.env.CLIENT_SECRET) throw new HTTPException(403, { message: 'forbidden' });
  await next();
});
