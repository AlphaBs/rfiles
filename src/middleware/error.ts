import { HTTPException } from 'hono/http-exception';

/** Render explicit HTTP errors as JSON; keep unexpected failure details in logs. */
export function handleError(error: unknown): Response {
  if (error instanceof HTTPException) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error('uncaught_error', error instanceof Error ? error.stack : error);
  return Response.json({ error: 'internal_server_error' }, { status: 500 });
}
