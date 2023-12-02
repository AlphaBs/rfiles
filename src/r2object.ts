import { AwsClient } from "aws4fetch";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { encodeBase64, hexToBase64, normalizeHex } from "./util";
import { Env } from "./environment";

const keyPrefix = "objects"

export function getMD5Prefix() {
	return keyPrefix
}

export function md5ToKey(hash: string): string {
	hash = normalizeHex(hash);
	return `${keyPrefix}/${hash}`;
}

export function keyToMD5(key: string): string {
	const sliceFrom = keyPrefix.length + 1;
	return key.slice(sliceFrom);
}

export function addObjectHeaders(object: R2Object, headers: Headers) {
	headers.set("Content-Length", object.size.toString());
	headers.set("Last-Modified", object.uploaded.toUTCString());
	if (object.checksums?.md5)
		headers.set("Content-MD5", encodeBase64(object.checksums.md5));
}

export function createObjectHeaders(object: R2Object): Headers {
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	addObjectHeaders(object, headers);
	return headers;
}

export function objectToMD5(object: R2Object): any {
	return keyToMD5(object.key);
}

export function objectToMetadata(object: R2Object): any {
	return {
		"uploaded": object.uploaded,
		"size": object.size,
		"md5": keyToMD5(object.key)
	};
}

export async function createUploadRequest(hash: string, exists: "error"|"overwrite", env: Env): Promise<any> {
	let unmodifiedSince: Date;
	if (exists === "overwrite") {
		// even the object already exists the server would accept the request only once
		unmodifiedSince = new Date();
	} 
	else { // error
		// the server only accept the request when the object does not exists
		// minimum If-Unmodified-Since value of R2
		unmodifiedSince = new Date(1632844800000);
	}

	const r2 = new AwsClient({
		accessKeyId: env.S3_ACCESS_KEY,
		secretAccessKey: env.S3_SECRET_ACCESS_KEY
	})

	const url = new URL(env.S3_ENDPOINT);
	url.pathname += md5ToKey(hash)
	url.searchParams.set("X-Amz-Expires", "600"); // 10 minutes

	const headers = {
		"If-Unmodified-Since": unmodifiedSince.toUTCString(),
		"Content-MD5": hexToBase64(hash)
	}

	const signed = await r2.sign(url, {
		method: "PUT",
		headers,
		aws: { 
			signQuery: true,
			allHeaders: true
		}
	})

	return {
		method: signed.method,
		url: signed.url,
		headers: headers
	}
}