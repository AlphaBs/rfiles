import { IRequest, Router } from "itty-router";
import { encodeBase64, hex, normalizeHex } from "./util";
import { CfReqContext } from ".";
import { MethodNotAllowedResponse } from "./responses/MethodNotAllowedResponse";
import { ErrorResponse } from "./responses/ErrorResponse";
import { NotFoundResponse } from "./responses/NotFoundResponse";

const router = Router({ base: '/objects'});

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

router.get('/', async (req: IRequest, ctx: CfReqContext) => {
	const objects = await ctx.env.FILES_BUCKET.list({
        limit: 100,
        prefix: keyPrefix
    });

    return new Response(
        JSON.stringify({
            objects: objects.objects.map(object => keyToHash(object.key))
		}));
})

router.all('/', async (req: IRequest, ctx: CfReqContext) => {
	return new MethodNotAllowedResponse(
		"method_not_allowed", ["GET"])
})

router.get('/:hash', async (req: IRequest, ctx: CfReqContext) => {
	console.log(req.params.hash);
    const key = hashToKey(req.params.hash)
	const object = await ctx.env.FILES_BUCKET.get(key);
	if (object === null) {
		return new NotFoundResponse("object_not_found");
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	addObjectHeaders(object, headers);

	return new Response(object.body, {
		headers
	});
})

router.put('/:hash', async (req: IRequest, ctx: CfReqContext) => {
    // TODO: if the key already exists return appropriate status code
	
    const hash = normalizeHex(req.params.hash);
    const key = hashToKey(hash);
	const object = await ctx.env.FILES_BUCKET.put(key, req.body, {
		md5: hash
	});

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	addObjectHeaders(object, headers);

	if (!object.checksums.md5 || 
		hash !== hex(object.checksums.md5)) {
		return new ErrorResponse("mismatch_hash", 400);
	}

	return new Response(null, {
		headers,
		status: 204
	});
})

router.delete('/:hash', async (req: IRequest, ctx: CfReqContext) => {
	const key = hashToKey(req.params.hash);
    await ctx.env.FILES_BUCKET.delete(key)
    return new Response(null, {
        status: 204
    });

    // TODO: return 404 for non-existing file
})

router.all('/:hash', async (req: IRequest, ctx:CfReqContext) => {
	if (req.method === 'HEAD') {
		const key = hashToKey(req.params.hash);
		const object = await ctx.env.FILES_BUCKET.head(key);
		if (object) {
			const headers = new Headers(); 
			object.writeHttpMetadata(headers);
			addObjectHeaders(object, headers);

			return new Response(null, {
				headers
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