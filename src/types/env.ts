export interface Env {
  CLIENT_SECRET: string;
  /** Retained for existing deployments; signing uses the S3 credentials below. */
  R2_TOKEN?: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_ENDPOINT: string;
  FILES_BUCKET: R2Bucket;
}

export type AppEnv = { Bindings: Env };
