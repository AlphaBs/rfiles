# rfiles
Hash based file server on Cloudflare Workers &amp; R2

## Publish

1. [Create R2 bucket](https://developers.cloudflare.com/r2/get-started/)
2. Copy `wrangler.toml.example` to `wrangler.toml` and modify values (e.g. `account_id`, `bucket_name`)
3. Run `npx wrangler publish`
