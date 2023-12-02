import { IRequest, Router } from "itty-router";
import { CfReqContext } from "../environment";
import { MethodNotAllowedResponse } from "../responses/MethodNotAllowedResponse";
import { ErrorResponse } from "../responses/ErrorResponse";
import { NotFoundResponse } from "../responses/NotFoundResponse";
import { filterUnauthorized } from "../auth";
import { createObjectHeaders, createUploadRequest, getMD5Prefix, md5ToKey, objectToMD5, objectToMetadata } from "../r2object";
import { normalizeHex } from "../util";
import { createJsonHeaders } from "../httpUtil";

const router = Router();

// list
router.get('/md5', async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
	let objectMapper: (object: R2Object) => any;
	const returnMode = req.query.return ?? "md5";
	if (returnMode === "hash") {
		objectMapper = objectToMD5;
	}
	else if (returnMode === "object") {
		objectMapper = objectToMetadata;
	}
	else {
		return new ErrorResponse("bad_request", 400);
	}

	const objects = await ctx.env.FILES_BUCKET.list({
		prefix: getMD5Prefix()
	});

	return new Response(
		JSON.stringify(objects.objects.map(objectMapper)), {
		headers: createJsonHeaders()
	});
})

router.all('/md5', async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
	return new MethodNotAllowedResponse(
		"method_not_allowed", ["GET"])
})

// download
router.get('/md5/:hash', async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
	const key = md5ToKey(req.params.hash)
	const object = await ctx.env.FILES_BUCKET.get(key);
	if (object === null) {
		return new NotFoundResponse("object_not_found");
	}

	const headers = createObjectHeaders(object);
	return new Response(object.body, {
		headers
	});
})

// upload
router.post('/md5/:hash', filterUnauthorized, async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
	const hash = normalizeHex(req.params.hash);
	const exists = req.query.exists === "overwrite" ? "overwrite" : "error";
	const uploadRequest = await createUploadRequest(hash, exists, ctx.env)
	return new Response(JSON.stringify(uploadRequest));
})

// delete
router.delete('/md5/:hash', filterUnauthorized, async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
	const key = md5ToKey(req.params.hash);
	await ctx.env.FILES_BUCKET.delete(key)
	return new Response(null, {
		status: 204
	});
})

// head
router.all('/md5/:hash', async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
	if (req.method === 'HEAD') {
		const key = md5ToKey(req.params.hash);
		const object = await ctx.env.FILES_BUCKET.head(key);
		if (object) {
			return new Response(null, {
				status: 200,
				headers: createObjectHeaders(object)
			});
		}
		else {
			return new NotFoundResponse();
		}
	}
	else {
		return new MethodNotAllowedResponse(
			"method_not_allowed",
			['GET', 'PUT', 'DELETE', 'HEAD'])
	}
})

export default router;