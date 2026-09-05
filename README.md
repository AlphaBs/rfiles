# rfiles

Cloudflare Workers와 R2에서 실행되는 해시 기반 파일 서버입니다. Hono를 사용하며,
API 스키마와 라우트 설명으로 OpenAPI 3.1 문서를 자동 생성합니다.
`/docs`에서 Scalar로 API 문서를 확인하고 요청을 실행할 수 있습니다.

## 개발 환경

Node.js 24를 사용합니다(`.nvmrc` 기준, 최소 22.12).
pnpm 버전은 `package.json`에 10.28.0으로 고정되어 있습니다.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm run dev
```

`.dev.vars`에 `CLIENT_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_ACCESS_KEY`,
`S3_ENDPOINT`를 설정합니다. S3 엔드포인트에는 버킷 경로와 마지막 슬래시를 포함해야 합니다.
예: `https://<account-id>.r2.cloudflarestorage.com/files/`
인증 정보는 Git에 커밋하지 않습니다. 기존 `FILES_BUCKET` 바인딩, 버킷 이름,
Worker 이름, 계정, 호환성 날짜는 `wrangler.toml`에 유지되어 있습니다.

- [Scalar API 문서](http://localhost:8787/docs)
- [자동 생성된 OpenAPI JSON](http://localhost:8787/openapi.json)

Wrangler는 로컬에서 R2를 에뮬레이션합니다. 서명된 업로드 URL은 `S3_ENDPOINT`를
가리키므로, 해당 URL에 업로드한 파일은 Wrangler의 로컬 버킷에 저장되지 않습니다.
자동화 테스트는 로컬 R2와 테스트용 서명 자격 증명을 사용합니다.
실제 서명 URL로 업로드하거나 운영 버킷에 접근하지 않습니다.

## API

| 메서드 | 경로                      | 동작                                                       | 인증              |
| ------ | ------------------------- | ---------------------------------------------------------- | ----------------- |
| GET    | `/md5?return=hash`        | 해시 목록의 첫 페이지 조회                                 | 불필요            |
| GET    | `/md5?return=object`      | `{ uploaded, size, md5 }` 메타데이터 목록의 첫 페이지 조회 | 불필요            |
| GET    | `/md5/:hash`              | 파일 바이트와 저장된 HTTP 메타데이터 다운로드              | 불필요            |
| HEAD   | `/md5/:hash`              | 본문 없이 파일 헤더 조회                                   | 불필요            |
| POST   | `/md5/:hash?exists=error` | 서명된 PUT 업로드 요청 생성                                | `x-client-secret` |
| DELETE | `/md5/:hash`              | 파일 삭제. 파일이 없어도 204 반환                          | `x-client-secret` |
| POST   | `/query`                  | 존재하는 해시의 메타데이터 조회                            | 불필요            |
| POST   | `/sync`                   | 기존 파일 메타데이터와 누락된 해시의 업로드 요청 반환      | `x-client-secret` |

두 일괄 처리 엔드포인트(`/query`, `/sync`)는 `{ "md5": ["..."] }` 형식의 본문을 받으며,
문자열 항목을 최대 1000개까지 허용합니다.

업로드 안내는 `{ md5, method, url, headers }` 형식입니다. `md5`는 소문자 32자리 해시이며,
`/sync`의 `uploads` 항목에도 포함됩니다. `objects`는 `/query`와 같은 `{ uploaded, size, md5 }` 배열입니다. RFiles.NET은 이 필드로 업로드 대상 해시를 식별합니다.

파일을 업로드하려면 먼저 `/md5/:hash`로 POST 요청을 보냅니다.
응답의 `url`에 파일 바이트를 PUT으로 전송하고, 응답에 포함된 `Content-MD5`와
`If-Unmodified-Since` 헤더를 그대로 사용합니다. URL의 유효 기간은 600초입니다.
`exists=overwrite`는 현재 시각을 조건부 업로드 기준 시각으로 사용합니다.
그 외의 값은 기존 `error` 모드로 처리합니다.

아래에 명시한 HTTP 응답·URL·MD5 검증·캐시 정책 변경 외에는 기존 구현의 관찰된 동작을 유지합니다.
예를 들어 `/md5`에서 반환 모드를 생략하거나 `return=md5`를 지정하면 400을 반환합니다.
이러한 동작을 변경하기 전에 [호환성 계약](docs/compatibility.md)을 확인하세요.

## HTTP 응답

목록·조회·동기화·업로드 요청 정보와 오류는 `application/json`으로 반환합니다.
일반 JSON 응답에는 Hono의 `context.json()`을, 공통 오류 처리에는 표준 `Response.json()`을 사용합니다.
기존 헤더를 재현하기 위한 `lib/http.ts` 헬퍼는 제거했습니다.

- 잘못되거나 비어 있는 JSON 본문은 `400 { "error": "bad_request" }`로 처리합니다.
- 예상하지 못한 서버 오류는 `500 { "error": "internal_server_error" }`로 반환하며,
  상세 오류는 서버 로그에만 기록합니다.
- 지원하지 않는 메서드는 Hono의 라우팅 결과에 따라 404를 반환합니다. 별도의 405·`Allow` 처리는 없습니다.
- HEAD는 Hono가 GET 핸들러로 처리한 뒤 본문을 제거합니다. 목록 HEAD도 GET과 같은 조건으로 처리하고,
  파일 HEAD는 `R2.head()`로 메타데이터만 조회합니다.
- 존재하지 않는 경로는 404, 파일 삭제는 본문 없는 204를 반환합니다. HEAD 응답에도 본문이 없습니다.

이 응답 정책은 기존 호환성 요구에서 별도로 변경을 허용한 부분입니다.
파일 저장 키와 업로드 서명 규칙은 유지합니다.

## URL 처리

Hono의 기본 라우팅과 `context.req.param()`, `context.req.query()`를 사용합니다.
별도의 라우터 호환성 보정은 없습니다.

- 경로 끝의 슬래시를 구분합니다. `/md5/`, `/md5/:hash/`, `/query/`, `/sync/`는 404이며 리다이렉트하지 않습니다.
- 경로 파라미터는 퍼센트 디코딩 후 MD5를 검증하고 소문자로 변환합니다. 예를 들어 `%63`과 `c`는 같은 해시 문자입니다.
- 쿼리 파라미터가 반복되면 첫 값을 사용합니다. `return=hash&return=object`는 해시 목록,
  `exists=overwrite&exists=error`는 덮어쓰기 모드입니다.
- 일괄 요청의 JSON 해시는 URL 디코딩하지 않습니다.

저장된 객체를 이동하거나 수정하지 않습니다. 다만 인코딩된 경로로 요청할 때 선택되는 저장 키는
기존과 달라질 수 있습니다. 정상 MD5 키의 기존 객체에는 해당 해시 경로로 접근할 수 있습니다.

## MD5 검증

단일 파일의 경로 해시와 `/query`, `/sync`의 모든 해시는 정확히 32자리 16진수여야 합니다.
대소문자는 모두 허용하며 소문자로 통일합니다. 빈 문자열, 잘못된 길이, 기호나 공백이 포함된
값은 `400 { "error": "bad_request" }`로 거부합니다. HEAD 오류에는 본문이 없습니다.
일괄 요청은 모든 항목을 검증한 뒤 저장소에 접근하므로 잘못된 항목이 있으면 전체가 실패합니다.
빈 배열은 허용하고 1000개 제한과 입력 순서·중복은 유지합니다.

정상 MD5의 `objects/<소문자 해시>` 저장 키와 `Content-MD5`는 유지합니다.
기존의 비정상 해시를 허용하던 처리는 제거했습니다. 비정상 키의 기존 객체는 그대로 남지만
단일 파일·일괄 API로 접근할 수 없습니다. 목록에는 기존 객체가 계속 표시될 수 있습니다.

## 다운로드 캐시

성공한 `GET /md5/:hash` 응답은 객체에 `Cache-Control`과 `Expires`가 모두 없을 때
다음 기본값을 추가합니다. 이 기본값은 기존 계약 보존을 위한 리팩토링 이후 합의한 응답 정책입니다.

```http
Cache-Control: public, max-age=31536000, immutable
```

캐시 유효 기간은 1년이며, 해당 기간에는 일반적인 재검증을 생략할 수 있습니다.
R2에 저장된 `Cache-Control` 또는 `Expires`가 있으면 기존 정책을 그대로 사용합니다.
따라서 객체별 `no-store`, `no-cache`, 짧은 유효 기간 등을 유지할 수 있습니다.
이 기본값은 응답에만 추가하며 R2 객체나 메타데이터를 수정하지 않습니다.

삭제는 원본 저장소에서 파일을 제거하는 동작이며, 이미 배포되거나 캐시된 파일의 접근 철회를
의미하지 않습니다. 같은 URL의 메타데이터를 변경해도 기존 캐시에는 만료 전까지 반영되지 않을 수 있습니다.

HEAD는 기존 저장 메타데이터만 반환하고 위 기본값을 추가하지 않습니다.
목록·조회·동기화·업로드 요청 정보·삭제·오류 응답에도 기본값을 추가하지 않습니다.
이 변경은 응답 헤더 정책이며, 별도의 Cloudflare 엣지 캐시 저장이나 무효화 로직은 추가하지 않습니다.

## 명령어

| 명령어                        | 용도                                                  |
| ----------------------------- | ----------------------------------------------------- |
| `pnpm run dev` / `pnpm start` | 로컬 Wrangler 실행                                    |
| `pnpm test`                   | workerd에서 계약·통합·단위 테스트 실행                |
| `pnpm run test:watch`         | 파일 변경 시 테스트 자동 재실행                       |
| `pnpm run test:coverage`      | `coverage/`에 커버리지 보고서 생성                    |
| `pnpm run typecheck`          | 애플리케이션·테스트·설정·스크립트 타입 검사           |
| `pnpm run format`             | 소스 코드와 문서 포맷 정리                            |
| `pnpm run openapi:generate`   | `dist/openapi.json` 생성 및 검증                      |
| `pnpm run build`              | OpenAPI 생성 및 배포 모의 실행으로 Worker 번들 생성   |
| `pnpm run check`              | 포맷·타입·테스트 커버리지·OpenAPI 검증·빌드 전체 검사 |
| `pnpm run deploy`             | Wrangler로 배포                                       |

CI는 푸시와 풀 리퀘스트에서 `pnpm install --frozen-lockfile`과 `pnpm run check`를 실행합니다.
생성된 파일, 로컬 비밀 값, 로컬 R2 데이터는 Git 추적에서 제외합니다.
OpenAPI는 등록된 라우트와 공통 Valibot 스키마에서 생성하므로 별도의 YAML 명세를 관리하지 않습니다.
HEAD 동작은 GET의 설명에 함께 안내합니다. 별도 HEAD 명세나 문서용 라우트는 등록하지 않습니다.
기존 Hurl은 자동화 테스트로 대체했습니다.

## 프로젝트 구조

```text
src/
  index.ts                 Worker 진입점과 최종 오류 처리
  app.ts                   Hono 애플리케이션 구성
  docs.ts                  OpenAPI 및 Scalar 등록
  types/env.ts             Worker 바인딩 타입
  middleware/auth.ts       클라이언트 시크릿 인증
  middleware/error.ts      JSON 오류 응답과 서버 오류 로깅
  lib/                     해시 정규화 및 인코딩
  modules/files/
    routes.ts              HTTP 핸들러와 API 동작 설명
    schemas.ts             요청·응답 스키마와 추론된 타입
    service.ts             일괄 요청 검증, 조회, 동기화
    repository.ts          R2 접근, 저장 키, 메타데이터, 헤더 처리
    upload.ts              AWS 서명 업로드 요청 생성
scripts/
  generate-openapi.ts       OpenAPI 문서 생성 및 검증
tests/
  contract/                기존 동작과 합의된 HTTP·URL 변경을 검증하는 스냅샷
  integration/             로컬 R2 및 API 문서에 대한 Worker 통합 테스트
  unit/                    인코딩·헤더·서명의 경계 조건 테스트
  helpers/                 격리된 테스트 데이터와 요청 헬퍼
```

## 배포

1. `wrangler.toml`의 기존 R2 버킷과 `FILES_BUCKET` 바인딩이 배포할 계정에 맞는지 확인합니다.
   기존 배포 환경에는 데이터 마이그레이션이 필요하지 않습니다.
2. 다음 명령으로 Worker의 비밀 값을 설정합니다.

   ```sh
   pnpm exec wrangler secret put CLIENT_SECRET
   pnpm exec wrangler secret put S3_ACCESS_KEY
   pnpm exec wrangler secret put S3_SECRET_ACCESS_KEY
   ```

   `S3_ENDPOINT`는 Worker 환경 변수 또는 비밀 값으로 설정합니다.
   기존 배포 환경의 설정값은 그대로 사용할 수 있습니다.

3. `pnpm run check`를 실행한 뒤, 배포할 준비가 되면 `pnpm run deploy`를 실행합니다.

참고 문서: [Hono OpenAPI](https://hono.dev/examples/hono-openapi),
[Hono용 Scalar](https://scalar.com/products/api-references/integrations/hono),
[Cloudflare Vitest 통합](https://developers.cloudflare.com/workers/testing/vitest-integration/).
