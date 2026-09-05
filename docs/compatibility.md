# Compatibility contract

The Git baseline is commit `4376e99d1858682f27ac414ad014e53f7bf93759` on `main`.
The contract snapshots were recorded by running the original implementation in
workerd before replacing its router. They capture response status, headers, body,
R2 calls, and complete signed URLs with a fixed clock. Only the approved HTTP response, routing, and MD5 validation changes below have been applied to those
expectations. Storage calls and signed URLs remain fixed outside those routing cases; unrelated changes must
not be accepted by regenerating snapshots. Integration tests additionally exercise the real local R2 binding and
its native serialization. Neither suite touches production data.

The old Swagger draft and Hurl files disagree with the implementation. The
running implementation is the compatibility source of truth. The new `/docs`
and `/openapi.json` routes are additive; `/` keeps its original 404.

The HTTP response policy and download cache default below are separately
approved changes after the initial refactor. Baseline fixtures specify an
explicit cache policy; dedicated cache tests cover the new default and exclusions.

## Approved HTTP response policy

The legacy response helpers in `lib/http.ts` have been removed. Handlers use
Hono's `context.json()` and the error handler uses the standard `Response.json()`.
All JSON responses, including upload instructions and errors, now use
`application/json`. Hono 4.13.7 also uses this media type without a charset, so
list/query/sync Content-Type values did not need a compatibility wrapper.

Malformed or empty JSON is a 400 `bad_request`, rather than a 500 parser error.
Unexpected failures return 500 `internal_server_error`; details are logged but
not included in responses. Authentication still runs before body parsing.

Explicit method-not-allowed handlers are removed. Unsupported methods fall through
to the existing 404 handler, without an Allow header. Hono routes HEAD through GET
and strips the response body. List HEAD now follows list GET validation and storage
access; file HEAD continues using R2Bucket.head. HEAD and 204 responses are bodyless.

## Approved download cache policy

Successful `GET /md5/:hash` responses add
`Cache-Control: public, max-age=31536000, immutable` only when stored HTTP metadata
contains neither `Cache-Control` nor `Expires`. Explicit policies, including
`no-store`, `no-cache`, and shorter lifetimes, remain untouched. The default is
applied to the response only; R2 keys, bytes, metadata, and signing stay unchanged.

Deletion removes the origin object but is not access revocation for copies
already distributed or cached. Updates to metadata at the same URL may remain
invisible to cached clients until expiry. HEAD preserves its original headers;
it does not receive the new default. No default is added to other API operations,
documentation, or error responses. This does not add an edge cache or purge logic.

## Approved native Hono routing

`lib/compatibility.ts` is removed. Hono uses its default strict routing,
`context.req.param('hash')`, and `context.req.query()` directly.
Trailing slashes no longer match canonical routes and return 404 without redirects.
Path parameters are percent-decoded before MD5 validation and lowercase normalization;
`%63` and `c` now select the same key. Repeated query parameters use their first
value, including `return` and `exists`. JSON bulk inputs are not URL-decoded.

These are intentional external behavior changes. Encoded-path requests can now
select different keys and produce different upload signatures; duplicate overwrite
parameters can select a different signing condition. No stored objects are migrated.
Snapshot changes outside these cases and the approved HTTP policy require review.

## Approved MD5 validation

All single-file path hashes and bulk input hashes must be exactly 32 hexadecimal
characters. Uppercase is accepted and normalized to lowercase. Invalid input
returns 400 `bad_request` (bodyless for HEAD). Protected routes authenticate first.
Existing malformed keys remain stored and may appear in list responses, but cannot
be accessed through single-file or bulk operations. Response metadata schemas thus
continue allowing legacy hash strings. Valid MD5 keys and signatures are unchanged.

## HTTP behavior

- Routing follows the approved native Hono policy below.
- `GET /md5` requires `return=hash` or `return=object` as its first value. An omitted mode,
  `return=md5`, and other inputs return 400 with `{"error":"bad_request"}`.
- List and query metadata is `{ uploaded, size, md5 }`. Dates serialize to ISO
  timestamps. Responses preserve R2 ordering and input ordering respectively.
- `GET /md5/:hash` uses `R2Bucket.get`; `HEAD` uses `R2Bucket.head`. Both forward
  stored HTTP metadata and set `Content-Length` and `Last-Modified`. A stored MD5
  checksum adds a base64 `Content-MD5` header. No new ETag is added.
- Missing GET objects return 404 with `{"error":"object_not_found"}`. Missing
  HEAD objects return 404 with no body. HEAD responses never transmit bodies.
- Successful upload instructions, list, query, sync, and JSON errors use
  `application/json`. Empty responses retain their original empty body and headers.
- Only upload POST, DELETE, and sync require `x-client-secret`. Missing or empty
  values produce 401 `unauthorized`; incorrect values produce 403 `forbidden`.
  Authentication precedes body parsing. Public reads remain public.
- DELETE returns 204 for both present and missing objects, with an empty body.
- Unsupported methods and unknown paths return 404 with
  `{"error":"can't find endpoint"}` (bodyless for HEAD). No Allow header is added.
- No CORS middleware, redirect, or automatic request
  Content-Type validation is added.

## Recovered production contract

The pre-refactor deployment `db946a0b-94d2-47a1-80fe-09b3de480139`
(2024-11-02) differed from Git main: upload instructions included `md5`, and
`/sync.objects` contained `{ uploaded, size, md5 }` metadata. Both fields are
required by RFiles.NET 0.0.4 and FishBucket. These deployed response shapes take
precedence over the Git baseline and are now covered by regression assertions.
The prior deployment processed bulk lookups concurrently; current processing
remains sequential and retains input order.

## Bulk behavior

`/query` and `/sync` parse JSON regardless of Content-Type and accept an `md5`
array of up to 1000 valid MD5 strings. Empty arrays, duplicates, and additional
object properties retain their historical behavior. Invalid hashes reject the whole
request before storage access; valid hashes are lowercased.
Non-array `md5` values and non-string items return 400 `bad_request`. More than
1000 items returns 413 `too_large_request` before checking item types. Malformed
or empty JSON returns 400 `bad_request`. Unexpected exceptions return 500
`internal_server_error`, without including the error's string form.

`/query` returns metadata only for existing files. `/sync` returns
`{ objects, uploads }`, where `objects` contains `{ uploaded, size, md5 }`,
matching `/query` and the recovered production contract. Missing inputs each
receive an upload instruction, including duplicates. Operations remain sequential.

## Upload response consumer contract

Upload instructions from single-file POST and `/sync` include `md5`, the lowercase
32-character hexadecimal digest, alongside `method`, `url`, and `headers`.
RFiles.NET 0.0.4 maps this field to `RFilesUploadRequest.Hash`; omitting it yields null
and FishBucket rejects the sync action. The Git baseline omitted this field, so
baseline snapshots alone did not capture the consuming client's requirement.
This additive correction leaves stored keys, checksum headers, and signatures unchanged.

## Storage and signing

- Keys remain `objects/<normalized-hash>` for valid MD5 hashes. Normalization
  validates exactly 32 hexadecimal characters and lowercases them. No objects
  are moved, renamed, rewritten, or migrated by this refactor.
- Listing uses exactly `{ prefix: 'objects' }`, without a slash. Only the first
  R2 list page is returned; the cursor is not followed or exposed. Keys matching
  that prefix outside `objects/` retain the old fixed-offset hash slicing.
- Signing appends the key directly to `S3_ENDPOINT.pathname`. It does not insert
  a missing slash or replace a bucket path. Existing URL query parameters remain.
- Upload requests use PUT, AWS query signing, all-header signing, and
  `X-Amz-Expires=600`. Returned headers are `Content-MD5` and
  `If-Unmodified-Since`. Error mode uses `Tue, 28 Sep 2021 16:00:00 GMT`;
  overwrite uses the current UTC time. Only an exact first `exists=overwrite` value
  activates overwrite.
- Single-file POST and bulk sync validate and lowercase hashes before checksum
  conversion. Content-MD5 encodes the 16 digest bytes as Base64. Invalid input
  is rejected instead of being partially parsed or converted to zero bytes.
- `wrangler.toml` retains the worker name, account ID, bucket bindings and names,
  `workers_dev` setting, and compatibility date. Existing environment-variable
  names remain valid. `R2_TOKEN` remains optional and unused by signing.

## Verification limits

Local R2 integration tests verify storage layout, bytes, metadata, query/sync,
HEAD, deletion, and authentication. Frozen signatures verify the URL and headers
produced by the old signer. They do not send PUT requests to Cloudflare's live S3
endpoint or prove service-side conditional upload enforcement. A production
deployment or live-bucket upload is outside this refactor's local verification.

Review changes to snapshots as changes to the external contract. Future runtime
upgrades may change native R2 serialization; review those differences explicitly
instead of blindly regenerating snapshots. JSON parser details are no longer part
of the response contract.
