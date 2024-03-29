/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { IRequest, Router } from 'itty-router'
import bulkRoutes from './routes/bulkRoutes'
import md5Routes from './routes/md5Routes'
import { ErrorResponse } from './responses/ErrorResponse'
import { NotFoundResponse } from './responses/NotFoundResponse'
import { Env, CfReqContext } from './environment';


const router = Router()
	.all('*', bulkRoutes.handle)
	.all('*', md5Routes.handle)
	.all('*', async (req: IRequest, ctx: CfReqContext) => {
		console.log("not_matching_any_routers");
		return new NotFoundResponse("can't find endpoint");
	});

const errorHandler = (error: any) => {
	console.log("uncaughted_error");
	console.log(error?.stack ?? error);
	return new ErrorResponse(error.toString(), 500); 
}

export default {
	fetch: (request: Request, env: Env, context: ExecutionContext): Promise<Response> => 
		router
			.handle(request, { request, env, context })
			.catch(errorHandler)
};