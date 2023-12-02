import { IRequest, Router } from "itty-router";
import { encodeBase64, hex, normalizeHex } from "./util";
import { Env, CfReqContext } from "./environment";
import { MethodNotAllowedResponse } from "./responses/MethodNotAllowedResponse";
import { ErrorResponse } from "./responses/ErrorResponse";
import { NotFoundResponse } from "./responses/NotFoundResponse";
import { AwsClient } from "aws4fetch";
import { filterUnauthorized } from "./auth";

const router = Router({ base: '/objects' });

const keyPrefix = "objects"

function hashToKey(hash: string): string {
	hash = normalizeHex(hash);
	return `${keyPrefix}/${hash}`;
}

function keyToHash(key: string): string {
	const sliceFrom = keyPrefix.length + 1;
	return key.slice(sliceFrom);
}

function addObjectHeaders(object: R2Object, headers: Headers) {
	headers.set("Content-Length", object.size.toString());
	headers.set("Last-Modified", object.uploaded.toUTCString());
	if (object.checksums?.md5)
		headers.set("Content-MD5", encodeBase64(object.checksums.md5));
}

function createObjectHeaders(object: R2Object): Headers {
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	addObjectHeaders(object, headers);
	return headers;
}

function objectToKey(object: R2Object): any {
	return keyToHash(object.key);
}

function objectToDetail(object: R2Object): any {
	return {
		"uploaded": object.uploaded,
		"size": object.size,
		"md5": keyToHash(object.key)
	};
}

function createJsonHeaders(): Headers {
	const headers = new Headers();
	headers.set("Content-Type", "application/json");
	return headers;
}

// list all objects the server stores
router.get('/', async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
	let objectMapper: (object: R2Object) => any;
	const returnMode = req.query.return ?? "md5";
	if (returnMode === "md5") {
		objectMapper = objectToKey;
	}
	else if (returnMode === "object") {
		objectMapper = objectToDetail;
	}
	else {
		return new ErrorResponse("bad_request", 400);
	}

	const objects = await ctx.env.FILES_BUCKET.list({
		prefix: keyPrefix
	});

	return new Response(
		JSON.stringify(objects.objects.map(objectMapper)), {
		headers: createJsonHeaders()
	});
})

router.all('/', async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
	return new MethodNotAllowedResponse(
		"method_not_allowed", ["GET"])
})

router.post('/query', async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
	const reqObj: any = await ctx.request.json()
	if (!reqObj)
		return new ErrorResponse("bad request", 400)

	const reqHashes = reqObj.hashes;
	if (!Array.isArray(reqHashes))
		return new ErrorResponse("bad request", 400)
	if (reqHashes.length > 1000)
		return new ErrorResponse("too large request", 413)

	const objects: Array<R2Object> = []
	for (let reqHash of reqHashes) {
		if (typeof reqHash !== "string")
			return new ErrorResponse("bad request", 400)

		const key = hashToKey(reqHash)
		const fileObj = await ctx.env.FILES_BUCKET.head(key)
		if (fileObj) {
			objects.push(fileObj)
		}
	}

	return new Response(
		JSON.stringify(objects.map(objectToDetail)), {
		headers: createJsonHeaders()
	})
})

// download
router.get('/:hash', async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
	const key = hashToKey(req.params.hash)
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
router.post('/:hash', filterUnauthorized,
	async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
		const hash = normalizeHex(req.params.hash);
		const key = hashToKey(hash);
		
		let unmodifiedSince: Date;
		const exists = req.query.exists ? req.query.exists : "error";
		if (exists === "error") {
			// the server only accept the request when the object does not exists
			// minimum If-Unmodified-Since value of R2
			unmodifiedSince = new Date(1632844800000);
		}
		else if (exists === "overwrite") {
			// even the object already exists the server would accept the request only once
			unmodifiedSince = new Date();
		}
		else {
			return new ErrorResponse("bad_request", 400);
		}

		const r2 = new AwsClient({
			accessKeyId: ctx.env.S3_ACCESS_KEY,
			secretAccessKey: ctx.env.S3_SECRET_ACCESS_KEY
		})

		const url = new URL(ctx.env.S3_ENDPOINT);
		url.pathname = key;
		url.searchParams.set("X-Amz-Expires", "600"); // 10 minutes
		const signed = await r2.sign(new Request(url, {
			method: "PUT"
		}),
			{
				aws: { signQuery: true },
				headers: {
					"If-Unmodified-Since": unmodifiedSince.toUTCString(),
					"Content-MD5": hash,
				}
			});

		return new Response(JSON.stringify({
			method: signed.method,
			url: signed.url,
			headers: signed.headers
		}));
	})

// delete
router.delete('/:hash', filterUnauthorized,
	async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
		const key = hashToKey(req.params.hash);
		await ctx.env.FILES_BUCKET.delete(key)
		return new Response(null, {
			status: 204
		});
	})

// head
router.all('/:hash', async (req: IRequest, ctx: CfReqContext): Promise<Response> => {
	if (req.method === 'HEAD') {
		const key = hashToKey(req.params.hash);
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