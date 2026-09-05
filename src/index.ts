import { createApp } from './app';
import { handleError } from './middleware/error';
import type { Env } from './types/env';

const app = createApp();

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    try {
      return await app.fetch(request, env, context);
    } catch (error) {
      // Handle non-Error rejections that Hono does not forward to onError.
      return handleError(error);
    }
  },
} satisfies ExportedHandler<Env>;
