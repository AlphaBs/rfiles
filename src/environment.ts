export interface Env {
	CLIENT_SECRET: string,
	R2_TOKEN: string,
	S3_ACCESS_KEY: string,
	S3_SECRET_ACCESS_KEY: string,
	S3_ENDPOINT: string,
	FILES_BUCKET: R2Bucket
}

export interface CfReqContext {
	request: Request,
	env: Env,
	context: ExecutionContext
}