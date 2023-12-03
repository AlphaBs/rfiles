import { IRequest, Router } from "itty-router";
import { Env, CfReqContext } from "../environment";
import { ErrorResponse } from "../responses/ErrorResponse";
import { createUploadRequest, md5ToKey, objectToMetadata } from "../r2object";
import { createJsonHeaders } from "../httpUtil";
import { filterUnauthorized } from "../auth";

const router = Router();

router.post('/query', async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
	const reqObj: any = await ctx.request.json();
	const reqQuery = parseQueryRequest(reqObj)
	if (reqQuery instanceof ErrorResponse)
		return reqQuery

	const objects: Array<R2Object> = []
	for (let reqHash of reqQuery) {
		const key = md5ToKey(reqHash)
		const fileObj = await ctx.env.FILES_BUCKET.head(key)
		if (fileObj) {
			objects.push(fileObj)
		}
	}

	return new Response(
		JSON.stringify(objects.map(objectToMetadata)), {
		headers: createJsonHeaders()
	})
})

router.post('/sync', filterUnauthorized, async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
	const reqObj: any = await ctx.request.json();
	const reqQuery = parseQueryRequest(reqObj)
	if (reqQuery instanceof ErrorResponse)
		return reqQuery

	const objects: Array<R2Object> = []
	const uploads: Array<RequestInfo> = []
	for (let reqHash of reqQuery) {
		const key = md5ToKey(reqHash)
		const fileObj = await ctx.env.FILES_BUCKET.head(key)
		if (fileObj) {
			objects.push(fileObj)
		}
		else {
			const uploadRequest = await createUploadRequest(reqHash, "error", ctx.env);
			uploads.push(uploadRequest)
		}
	}

	return new Response(
		JSON.stringify({ objects, uploads }), {
		headers: createJsonHeaders()
	})
});

function parseQueryRequest(req: any): Array<string> | ErrorResponse {
	if (!req)
		return new ErrorResponse("bad_request", 400)

	const reqMd5 = req.md5;
	if (!Array.isArray(reqMd5))
		return new ErrorResponse("bad_request", 400)
	if (reqMd5.length > 1000)
		return new ErrorResponse("too_large_request", 413)

	const items: Array<string> = []
	for (let item of reqMd5) {
		if (typeof item !== "string")
			return new ErrorResponse("bad_request", 400)
		items.push(item)
	}
	return items
}

export default router;