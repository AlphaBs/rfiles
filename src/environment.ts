export interface Env {
	CLIENT_SECRET: string,
	FILES_BUCKET: R2Bucket
}

export interface CfReqContext {
	request: Request,
	env: Env,
	context: ExecutionContext
}