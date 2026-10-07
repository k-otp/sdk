# K-OTP Kiota 다국어 SDK PoC 결과와 릴리스 후속안

확인 기준: 2026-10-07, Asia/Seoul. 작업 브랜치: `poc/kiota-multilang`.

이 파일은 개발 검증 기록이다. 사용자는 [`preview/README.md`](preview/README.md)의
언어별 설치·사용법을 참고한다. 사용자 문서 `docs/`에서는 이 보고서를 제거했다.

## 공개 wrapper와 로컬 preview 패키지

`preview/`에는 8개 언어의 공개 서버 클라이언트와 Kotlin/JVM JAR 소비자가 있다.
클라이언트 초기화·origin 제한·인증·9개 operation·멱등키 검증·자동 재시도 금지·
명시적 503 재시도·JSON 응답·공통 오류 view가 설치한 패키지 안에서 동작한다.
소비자는 fixture 관측만 수행하며 SDK 정책을 복사하거나 생성 모델을 직접 호출하지 않는다.

로컬에서 9개 preview 모두 전체 SDK/wrapper build/load, artifact 설치와
28/28 계약을 통과했다. 공개 `requestId`/`retryAfterMs`도 fixture와 비교한다.
CLI/spec/fixture/run/commit 및 wrapper source hash가 다르면 이전 증거를 재사용할
수 없다. CI는 기존 raw/overlay 검증에 이어 이 preview 소비자를 모두 필수로 실행한다.

버전과 공개 entry point는 `preview/packages.json`에 있고 각 artifact에 사용자
README와 MIT license를 포함했다. Ruby/Dart/TypeScript의 보완 계층은 preview
package 소스가 기준이며 기존 PoC도 같은 소스를 소비한다. 생성 파일은 수정하지 않는다.
패키지 이름은 로컬 fixture 좌표로 잠정적이며 외부 registry 발행은 하지 않았다.
Preview는 서버 `sk_`와 네이티브 JSON view 범위다. 추가 runtime/OS, mobile/browser,
typed envelope data 검증 및 정식 배포 체계는 후속 범위로 남는다.

## 도입 판단

CSharp·PHP·Java·Go·Python·Ruby·Dart·Kiota TypeScript 8개 SDK 언어와 별도
Kotlin/JVM 소비자는 **공식 runtime, 생성 전용 overlay와 K-OTP 소비 정책을
적용한 채택 후보**다. Ruby·Dart·TypeScript에는 아래의 작은 보완 계층도 필요하다.
로컬과 Ubuntu 24.04 Actions에서 모두 전체 생성 코드 빌드/로드, 28/28 계약,
독립 패키지 소비와 깨끗한 재생성을 통과했다. 전체 PoC workflow와 기존 SDK CI도
성공했다. 아래 실행의 artifact로 각 단계를 확인했다.
원본 OpenAPI만으로 생성한 SDK는 오류 모델 및 일부 상수/union 처리가
불완전해 그대로 배포할 수 없다. Swift는 고정 CLI 미지원이다.
HTTP 출력은 SDK가 아닌 요청 예제이며 현재 본문 검사가 실패한다.

이 판정은 공개 9개 operation과 명시된 fixture/toolchain에 한정한다.
Kiota의 upstream maturity, 모든 API 입력의 호환성, 운영 지원 보장과는 별개다.
기존 `@k-otp/sdk`를 유지한다. 이번 PoC에서는 외부 패키지 발행, 릴리스/tag,
미러 저장소, main 반영, SDK 버전/changeset 변경을 수행하지 않았다.

## 실행 근거와 재현

| 실행 | 코드 커밋 | 확인 범위 |
| --- | --- | --- |
| [최초 기준 37501140708](https://github.com/k-otp/sdk/actions/runs/37501140708) | `52ae367dd9bab4c0ee7663d816486ba221e9ed48` | 생성 7개 성공; Swift 실패; Kotlin 소비 미검증 |
| [전체 HTTP 검증 37511514629](https://github.com/k-otp/sdk/actions/runs/37511514629) | `e963550dd90b0e90d675993f5d74a9ca30404c21` | 핵심 6개 overlay: 전체 빌드·28/28 계약·패키지 소비·재생성 통과; 기존 SDK 회귀 통과 |
| [패키징/최소 재현 보강 37514447594](https://github.com/k-otp/sdk/actions/runs/37514447594) | `500e0e6ee5d73ac70b7c752b30a6f596a54d1151` | 추가 언어 패키지 소비, Java/Go 최소 재현, 증거 identity 검사, 기존 SDK 공통 fixture 비교 |
| [수정 전 PR 37515801223](https://github.com/k-otp/sdk/actions/runs/37515801223) | `ffda3fb092f9b8a0795ccbb759a4fd936ba656b2` | 핵심 6개 overlay 통과; Ruby/Dart/TypeScript overlay 실패와 raw 실패를 기록. 전체 workflow 실패 |
| [8개 언어 + Kotlin/JVM 37552678500](https://github.com/k-otp/sdk/actions/runs/37552678500) | PR head `2b90b80a7883147de98a5b5b6c76022530d69dd5` | 모든 9개 overlay profile 28/28, 전체 build/load·package·재생성, raw/HTTP/기존 SDK 비교의 정확한 음성 회귀, 최종 gate 통과. 전체 workflow 성공 |
| [동일 커밋 push 37552674854](https://github.com/k-otp/sdk/actions/runs/37552674854) | `2b90b80a7883147de98a5b5b6c76022530d69dd5` | PR 실행과 별도로 전체 PoC workflow 성공 |
| [기존 SDK CI 37552678538](https://github.com/k-otp/sdk/actions/runs/37552678538) | PR head `2b90b80a7883147de98a5b5b6c76022530d69dd5` | 기존 SDK·framework/Node 호환성·examples/e2e 회귀 통과 |

아래 단계 표는 완료된 `37552678500`의 aggregate JSON 22개 행과 일치한다.
PR 실행의 실제 checkout/`sourceCommit`은 merge commit
`2c88648fa029256d6c6a2a3f993c4304c6f1535d`이며 위 표의 PR head와 구분한다.
각 실행의
`kiota-evidence-report` artifact에 `results.json`/`results.md`가 있고, 언어별
`kiota-<Target>-<variant>` artifact에 원본 생성 코드·명령·관측·패키지가 있다.
Actions artifact 보관은 14일이므로 장기 검토 시 해당 실행의 증거를 보관해야 한다.

CLI release는 `v1.35.0`, 전체 바이너리 버전은
`1.35.0+114aa7ee609262d892fd9ceb02b2d9f7ecb84190`이다.
setup-kiota v0.5.0은 commit
`111eb592b2b3b2602ba9e0d979d4a4509cd59bb5`에 고정하고 action 입력은
`version: v1.35.0`이다. 액션 버전, CLI 버전, companion runtime 버전은 각각
다른 항목이다. [공식 action 입력](https://github.com/microsoft/setup-kiota/blob/v0.5.0/action.yml).

입력은 저장소의 `spec/openapi.json`이며 운영 URL에서 갱신하지 않는다.
OpenAPI 규격 버전은 **3.1.1**, 서비스 계약 버전은 **1.8.0**,
SHA-256은 `f8e49375574f1e01fb566453707d1d382c4e5fe158648863200baf8b6353b84e`다.
각 JSON에 commit/run/attempt/spec/fixture/input hash, 실제 도구·OS/architecture,
action SHA, dependency lock hash, 단계별 상태, 경고·차단 요인·증거 경로를 남긴다.

```sh
# 저장소 루트; 도구 설치 및 선택은 poc/kiota/README.md 참고
bun install --frozen-lockfile
export KIOTA_BIN=/absolute/path/to/kiota
export POC_OUTPUT=.cache/kiota-poc/review-current
bun run poc/kiota/scripts/generate.ts Java raw
bun run poc/kiota/scripts/reproduce.ts Java raw
bun run poc/kiota/scripts/harness.ts Java raw
# raw wire의 비정상 종료를 확인한 후 overlay를 별도로 실행
bun run poc/kiota/scripts/generate.ts Java overlay
bun run poc/kiota/scripts/harness.ts Java overlay
# 다른 필수 target과 Kotlin도 생성/검증한 뒤 실행
bun run poc/kiota/scripts/report.ts --gate
bunx --no-install ttsc --noEmit -p poc/kiota/tsconfig.json
bun test poc/kiota/overlays poc/kiota/mock poc/kiota/scripts/evidence.test.ts poc/kiota/scripts/ci-policy.test.ts
bun run check
```

Go 최소 재현은 `bun run poc/kiota/scripts/reproduce.ts Go overlay`다.
`generate.ts Swift raw`는 고정 CLI help에서 target 등록 여부를 실제 확인한다.
`harness.ts`는 계약 실패 시 계속 비정상 종료한다. CI의 `ci-target.ts`는 별도
판정으로 아래의 고정된 원본 실패 재현을 검증한다. `continue-on-error`는 없다.

## 단계별 결과

<!-- stage-table:start -->

| Target | Input | generation | buildOrLoad | wireContract | kotlinInterop | packageConsumer | reproducibility |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CSharp | raw | passed | passed | failed | not_applicable | passed | passed |
| CSharp | overlay | passed | passed | passed | not_applicable | passed | passed |
| Java | raw | passed | passed | failed | not_applicable | passed | passed |
| Java | overlay | passed | passed | passed | not_applicable | passed | passed |
| Kotlin | raw | passed | passed | failed | failed | passed | passed |
| Kotlin | overlay | passed | passed | passed | passed | passed | passed |
| PHP | raw | passed | passed | failed | not_applicable | passed | passed |
| PHP | overlay | passed | passed | passed | not_applicable | passed | passed |
| Go | raw | passed | passed | failed | not_applicable | passed | passed |
| Go | overlay | passed | passed | passed | not_applicable | passed | passed |
| Python | raw | passed | passed | failed | not_applicable | passed | passed |
| Python | overlay | passed | passed | passed | not_applicable | passed | passed |
| Ruby | raw | passed | passed | failed | not_applicable | passed | passed |
| Ruby | overlay | passed | passed | passed | not_applicable | passed | passed |
| Dart | raw | passed | passed | failed | not_applicable | passed | passed |
| Dart | overlay | passed | passed | passed | not_applicable | passed | passed |
| TypeScript | raw | passed | passed | failed | not_applicable | passed | passed |
| TypeScript | overlay | passed | passed | passed | not_applicable | passed | passed |
| HTTP | raw | passed | not_applicable | failed | not_applicable | not_applicable | passed |
| HTTP | overlay | passed | not_applicable | failed | not_applicable | not_applicable | passed |
| Swift | raw | unsupported | not_applicable | not_applicable | not_applicable | not_applicable | not_applicable |
| ExistingTypeScript | raw | not_applicable | passed | failed | not_applicable | not_applicable | not_applicable |

<!-- stage-table:end -->

`generation`은 빈 출력이 아닌 코드 생성, `buildOrLoad`는 모든 생성 파일의
실제 compile/import/require/analyze, `wireContract`는 28개 계약 사례 전체,
`packageConsumer`는 별도 소비자의 로컬 패키지 설치/빌드/로드,
`reproducibility`는 깨끗한 두 생성 디렉터리의 코드 hash 일치다.
서로 다른 단계의 성공을 다음 단계 성공으로 간주하지 않는다.

`report` job의 최종 gate는 SDK 8개 언어와 Kotlin/JVM의 **overlay**를 모두
필수 통과 대상으로 평가한다. 어떤 overlay도 알려진 실패 목록에 넣을 수 없다.
raw/HTTP/기존 SDK의 비교는 `fixtures/known-baseline-gaps.json`에 검토한 실패
사례·요청 수·예외·진단을 고정한 음성 회귀 테스트다. 정확히 같은 실패가
재현되어야 CI 검증이 통과하고 SDK의 `wireContract: failed`는 그대로 남는다.
새로운 실패, 소비자 crash, 설치/빌드/패키징 실패, 누락된 사례와 달라진 실패는
CI를 실패시킨다. 예상 밖 개선도 baseline을 사람이 재검토하도록 실패시킨다.
이 목록은 CI에서 자동 갱신하지 않는다. CLI/spec/fixture hash도 고정한다.
`ciValidation`과 SDK 계약 단계는 서로 다른 결과다. CI 성공은 검증한 overlay
후보의 계약 통과와 원본 한계의 정확한 재현을 뜻한다.
집계는 현재 run/attempt/commit/spec/fixture/action/target/variant identity를
검사한다. 누락·이전 실행·다른 variant의 artifact는 `not_run` 및 차단 사유로
기록하여 필수 gate를 통과시키지 못한다.

| Target | raw 계약 | overlay 계약 | overlay 생성 코드 수 |
| --- | --- | --- | --- |
| CSharp | 19/28 | 28/28 | 63 |
| Java / Kotlin | 각각 19/28 | 각각 28/28 | 각각 Java 파일 54 |
| PHP | 15/28 | 28/28 | 67 |
| Go | 19/28 | 28/28 | 63 |
| Python | 14/28 | 28/28 | 55 |
| Ruby | 6/28 | 28/28 | 66 |
| Dart | 18/28 | 28/28 | 58 |
| Kiota TypeScript | 18/28 | 28/28 | 11 |
| HTTP | 예제 7/9 | 예제 7/9 | 9개 `.http` |

Kotlin 행의 source 수는 Java JAR 입력이고 Kotlin consumer는 별도 소스다.
HTTP 예제 검사와 Swift 미지원은 SDK 계약 성공 수에 합산하지 않는다.

## 도구·runtime 및 패키징

CI OS는 Ubuntu 24.04 x64이고 로컬 보조 검증은 macOS arm64다. 로컬 Java는
22.0.1이었으며 CI는 아래 JDK로 별도 통과했다. JS 설치·실행은 Bun 1.4.2를 쓴다.
고정 CLI가 출력한 `info --language`와 실제 설치 metadata를 함께 보관한다.
해당 바이너리는 핵심 5개 언어를 Stable/Microsoft, TypeScript를
Preview/Microsoft, Ruby·Dart를 Experimental/Community로 표시한다.
이는 upstream 자체 표시이며 위 PoC 판정을 대신하지 않는다.

| 언어 | CI 도구 / companion runtime | 실제 로컬 산출물과 소비 방식 |
| --- | --- | --- |
| CSharp | .NET SDK 8.0.303, Kiota Bundle 2.0.0, NuGet lock | `.nupkg`; 별도 consumer가 local feed에서 restore, 전체 SDK를 참조하여 실행 |
| Java | Temurin 21.0.8+9, checksum 고정 Maven 3.9.9, bundle 및 serializer 1.9.3, Jakarta annotations 2.1.1 | Java 17 bytecode JAR; 별도 Maven consumer의 artifact 의존성 |
| Kotlin/JVM | 위 Java JAR + Kotlin compiler/plugin 2.1.20 | 생성 Java 소스를 Kotlin 프로젝트에 복사하지 않고 설치된 JAR를 참조 |
| PHP | PHP 8.4.4, Composer 2.8.6, bundle 2.1.0, lock의 abstractions 2.2.0 | Composer archive ZIP; artifact repository로 설치하고 PSR-4 autoload |
| Go | Go 1.26.5; abstractions 1.11.1, HTTP 1.5.4, JSON/form/multipart 1.1.2, text 1.1.3 | file module proxy의 versioned ZIP; 별도 module/cache, `replace` 없이 소비 |
| Python | Python 3.13.2; bundle 1.14.2, setuptools 80.9.0, wheel 0.45.1, build 1.3.0 | wheel; 깨끗한 consumer venv, hash 고정 runtime 설치 후 wheel install |
| Ruby | Ruby 3.3.6, Bundler 2.5.22, abstractions/Faraday/JSON 0.24.0 | `.gem`; 별도 GEM_HOME에 artifact 설치, frozen lock으로 설치한 실제 runtime을 GEM_PATH로 사용 |
| Dart | Dart 3.9.4; bundle 0.1.1, lock의 abstractions 0.3.0 / HTTP 0.0.7 / JSON 0.0.9 | source archive; 별도 디렉터리에 압축 해제한 SDK를 Pub path 의존성으로 소비, kernel compile |
| Kiota TypeScript | Bun 1.4.2, ttsc 0.30.4, TypeScript 7.0.2, bundle 1.0.0-preview.106 | Bun build 및 local tarball; public type/subpath exports로 별도 consumer를 ttsc 검사하고 package import와 wire 실행 |
| HTTP | Kiota HTTP writer | 9개 `.http` 요청 예제; SDK 패키징 해당 없음 |

.NET/Composer/Go/Python/Ruby/Dart/Bun 의존성 lock을 커밋하고 hash를 기록했다.
Python은 exact version + `--require-hashes`로 SDK와 consumer 양쪽을 설치한다.
Maven은 dependency/plugin 좌표 버전을 고정하고 dependency tree/hash를 저장한다.
Maven artifact 자체의 전체 checksum lock 및 일부 추가 언어 consumer의 transitive
lock까지 완결된 공급망 검증은 정식 릴리스 전 후속 과제다.
패키지 파일 hash는 재생성 코드 hash와 별개다. 패키지 archive byte 재현성은
이번 PoC의 통과 조건이 아니며 공개 SDK release 이름/버전을 확정한 것도 아니다.

## 원본 경고의 실제 영향과 overlay

원본 생성에는 보통 60개 경고가 있다. 59개는 operation/status별
`Could not create error type`이고, 1개는 여러 `servers` 중 첫 URL 사용 경고다.
모든 클라이언트의 adapter base URL을 loopback mock으로 지정하므로 뒤 경고는
설명 가능한 선택이다. 오류 mapping 경고는 실제 원본 wire 테스트에서 envelope
필드 손실을 재현했으므로 배포 차단 요인이다. 일부 단일 branch 402 mapping은
생성되지만 이것으로 모든 오류 보존을 주장할 수 없다.

`poc/kiota/fixtures/error-oneof-minimal.json`은 verify 한 operation과 400의
`defined:true/false` oneOf만 남긴 최소 입력이다. Java 1.35.0에서 생성 exit 0,
400 warning 및 `errorMapping.put("400", ...)` 누락을 확인한다. 동일 입력에
overlay를 적용하면 400 mapping이 생긴다. 전체 SDK의 raw 실패와 overlay 통과
HTTP 테스트가 mapping 유무의 런타임 영향을 보완한다.
오류 발생 시 mapping이 필요하다는 upstream 설명은
[Kiota 오류 처리 문서](https://learn.microsoft.com/en-us/openapi/kiota/errors)를 참고한다.

변환은 `poc/kiota/overlays/compat.ts`에만 있고 generated 파일은 수정하지 않는다.
원본 OpenAPI 3.1.1, 9개 operation, nullable 및 boolean/object `webOtp` union은
유지한다. `overlay-changes.json`은 JSON pointer와 전후 schema/사유를 저장한다.

| 변환 | 개수 | 의미와 손실 |
| --- | --- | --- |
| 동종·서로 다른 `oneOf/const` 값 → 명시 primitive `enum` | 40 | 허용 값 집합 동일; 혼합 union이나 nullable은 적용 대상 아님 |
| type 없는 const에 값의 type 추가 | 241 | const 값 제약 유지 |
| 오류 oneOf → 공통 `KotpErrorEnvelope` reference | 60 | 필드와 동적 data는 수용하되 branch별 const 관계·typed data·분기 validation을 완화 |

공통 오류 view는 `defined:boolean`, `code:string`, `status:number`,
`message:string`, 임의 `data`와 additional fields를 허용한다. raw 계약의
`code/status/defined` 조합 및 402/429 typed data 보장은 사라진다. 따라서
overlay는 원본 서비스 계약의 대체 스펙이 아니며 runtime 오류 정보를 읽기 위한
생성용 projection이다. 향후 typed helper가 원본 data schema를 기준으로
402/429 데이터를 검증하는 방식을 추가 평가해야 한다.

언어별 projection은 공통 overlay 위에만 적용한다. Ruby는 format 없는 numeric
schema에 `format: float`를 지정해 official Float reader를 사용한다. JSON number
타입, const 및 범위 제약은 유지하지만 Float64의 표현 한계는 별도 검증 대상이다.
Dart는 optional/unconstrained 오류 `data`의 명시 property를 생략하고 원래부터
열려 있는 `additionalProperties`로 받는다. 허용 JSON 값은 동일하고 실제 data는
additional-data에서 읽는다. 이로써 UntypedNode parser의 문자열 `"001"` 변환과
writer 문제를 피하며 null/false/object/list를 보존한다. 전후 schema 검사가 있다.

## 공통 계약과 재시도

28개 계약 사례는 원본에서 계산한 9개 public operation을 모두 실행한다.
실제 생성 request builder + official serializer + request adapter가 로컬 HTTP를
통과한다. request method/path/query/header/body, 실제 응답 객체 및 오류 객체를
관측한다. `issue`/`verify` 메서드 stub은 없다.

검증 범위는 문자열 전화번호/선행 0 OTP/Unicode, `smsFallback` 생략·true·false,
`webOtp` 생략·false·true·object, metadata/templateVariables map, enum/const,
200 `verified:false`, 400/401/403/404/409/402/429/500/503 및 `defined:false`,
중첩 object/list/null/false 오류 data, request id와 Retry-After 초 및 body ms,
조직 지갑·promo nullable expiry, path/query encoding, 두 cursor 페이지 및 종료다.

사용 정책을 적용한 verify는 자동 retry가 없어 429에서도 한 요청만 보낸다.
issue 역시 자동 retry를 기본 끄고, 명시된 503 재시도 사례에서만 정확히 두 번
보낸다. mock이 두 요청의 같은 멱등키/header/body를 검사한다. 잘못된·없는
멱등키는 HTTP 전에 거부해 요청 수가 0이다. issue timeout 사례는 한 요청 후
`unknown`을 기록하고 성공/미발송으로 확정하지 않는다.

29번째 fixture는 별도 **default middleware 관측**이다. 성공 계약 수에 포함하지
않고 default factory가 보낸 요청 수·최종 예외·본문 변화를 저장한다.
고정 환경에서 default chain은 C#/Java/Kotlin/PHP/Go/TS에서 verify를 반복했고,
Python은 세 요청 후 10초 제한에 걸렸다. C#은 `AggregateException`, Go는 재시도
본문이 비어 JSON/body 위반이 생겼다. retry 수는 factory 옵션과 시간 제한에
따라 달라질 수 있으므로 artifact의 `default-retry.json`/`http-requests.json`을
기준으로 읽는다. 이 관측을 K-OTP 안전 정책의 통과로 계산하지 않는다.

| overlay default probe | 실제 요청 수 | 최종 관측 |
| --- | --- | --- |
| CSharp | 4 | AggregateException |
| Java / Kotlin | 각각 4 | KotpErrorEnvelope, HTTP 429 |
| PHP | 4 | KotpErrorEnvelope, HTTP 429 |
| Go | 4 | KotpErrorEnvelope; 빈 재시도 body 위반 |
| Python | 3 | TimeoutError, outcome unknown |
| Kiota TypeScript | 4 | runtime이 던진 plain 오류 객체(non-Error) |
| Ruby / Dart | 각각 1 | 각각 KotpErrorEnvelope, HTTP 429 |

Ruby는 official runtime 0.20.0에서
[0.24.0](https://github.com/microsoft/kiota-ruby/releases/tag/v0.24.0)으로 갱신하여
null optional field 생략, error mapping과 status/header의 실제 값을 검증했다.
Ruby·Dart도 명시적 503 재시도에서 같은 key/body, 정확히 2회 요청 및 timeout
unknown을 28개 사례로 검증했다. default chain의 관측과 K-OTP 사용 정책의
통과는 별도로 기록한다.

## Kotlin과 최소 사용성 계층

Kotlin은 문서 출력 job이 아니라 독립 JVM 프로젝트다. 생성 Java JAR의
클라이언트 초기화, 9개 builder 호출, nullable 응답, enum query, boolean/object
union의 실제 값을 직접 읽고, ApiException을 catch하여 status/header/data를
관측한다. 생성 Java API는 **동기 호출**이며 CompletableFuture/coroutine API를
가정하지 않았다. coroutine facade는 추가하지 않았다. 필요하다면 caller가
blocking I/O를 적절한 dispatcher에 배치하는 얇은 facade를 별도 평가한다.
Android·Kotlin Multiplatform의 설치/네트워크/축소 도구는 미검증이다.

기존 PoC 소비자에는 secret-key/loopback client 구성, issue 멱등키 검증·header 일치,
union 설정, 공통 오류 읽기, timeout 및 explicit retry 정책이 있다. 이 부분을
이 정책을 `preview/`의 설치 가능한 wrapper로 추출했다. fixture runner는 제품
API로 발행하지 않는다. generated model/transport를 수동 재구현하지 않았다.

현재 전체 consumer 파일의 물리적 줄 수는 C# 94, Java 106, Kotlin 108,
PHP 107, Python 144, Go 246줄이다. 이 수치에는 9개 operation dispatch,
fixture I/O와 관측도 포함되므로 제품 wrapper의 순수 크기로 읽으면 안 된다.
운영 wrapper로 추출할 때는 client factory·issue guard·오류 view·retry 정책의
크기와 public API를 별도로 측정해야 한다.

특별 관리가 필요한 부분은 Python serializer의 false-valued `webOtp` 처리
(official additional-data 경로로 false 보존), Python 동적 오류 data의 직접 읽기,
Go abstractions 1.9.3의 nil optional date query panic(1.11.1로 해결),
원본/overlay 사이 enum query 소비자 타입 차이, 오류 data의 schema 완화다.
Go 최소 fixture는 두 runtime 버전에서 panic/fix를 모두 실행한다.

추가 3개 언어의 보완 계층은 `preview/<language>/`의 compatibility 파일로 옮겼다. 물리적
줄 수는 Ruby 65, Dart 82, TypeScript 52줄이며 fixture dispatch는 포함하지 않는다.
패키지 단독이 아니라 이 계층과 사용 정책을 함께 적용한 profile을 검증했다.

| 언어 | 보완 범위 | 유지보수 조건 |
| --- | --- | --- |
| Ruby | official JSON writer를 상속하여 enum wire 값·Hash·false union 보존. 생성 input의 enum으로 값 map을 만들고 잘못 생성된 enum-array Hash factory만 official parser에 연결 | process-wide parser prepend와 writer 내부 state를 사용하므로 runtime 0.24.0에 고정. unrelated factory 오류가 전파되는 native guard 필요 |
| Dart | real adapter의 `send` 전 enum query wire 값 보정, MIME charset 정규화, 응답별 parser hook으로 명시 null 복구, additional-data 오류 view | 전체 7개 ledger enum과 5개 verification enum을 real HTTP로 검사. nullable/null·empty object 구분 및 runtime 변경 시 guard 필요 |
| TypeScript | generated Parsable factory로 map/union 요청 구성, official UntypedNode를 JSON view로 읽기, 응답별 parser hook으로 null 복구 | user `value`/`getValue` key와 선행 0 문자열·false·null 보존. interleaved parse node guard와 독립 package consumer ttsc 필요 |

공식 runtime을 수정하거나 fork하지 않았고 생성 파일 byte는 그대로다. 각 root
parser hook은 응답별 closure를 사용하므로 전역 last-response cache가 없다.
guard 테스트는 interleaved parsing을 확인하며 운영 동시성 전체를 보장하지 않는다.

## 미해결 실패와 다음 조치

| 대상 | 판정 | 실제 실패 범위와 다음 조치 |
| --- | --- | --- |
| 핵심 5개 + Kotlin/JVM raw | 추가 수정 필요 | 경고/누락 mapping과 const/union 처리. 최소 error oneOf 및 동일 wire fixture를 유지하여 schema 표현 개선 또는 error projection을 비교 |
| 8개 SDK 언어 + Kotlin/JVM overlay | 채택 후보 | 모두 28/28, 전체 build/load, package consumer 및 재생성 통과. 보완 계층을 제품 wrapper로 추출하고 typed error/helper·지원 환경을 검증한 뒤 제한된 preview |
| Ruby raw | 추가 수정 필요 | 오류 oneOf/const 생성의 mapping·모델 한계가 남음. official 0.24.0와 보완 계층만으로 원본 입력의 28개 계약을 모두 충족하지 않음 |
| Dart raw | 추가 수정 필요 | 원본 오류 oneOf 모델과 dynamic UntypedNode 처리. 지원 후보는 common error projection + additional-data + 얇은 adapter/parser profile |
| Kiota TypeScript raw | 추가 수정 필요 | error mapping·const와 dynamic model 한계가 남음. 지원 후보는 overlay + generated Parsable 소비/JSON view 계층이며 기존 SDK는 유지 |
| HTTP raw/overlay | 추가 수정 필요 | 생성 body의 wrapper/후행 comma로 JSON 파싱 실패. method/path/header 검사는 가능하지만 요청 예제로 배포 전 writer 수정 또는 다른 예제 도구 평가 |
| Swift | 미지원 | CLI help에 writer 등록 없음. 별도 OpenAPI generator 평가를 후속 과제로 두고 이번 PoC에서 수동 Swift SDK를 만들지 않음 |
| Android/KMP·운영 네트워크·추가 runtime/OS | 미검증 | 지원 범위 확대 전 실제 consumer/HTTP/TLS/cancellation matrix 필요 |

추가 언어의 fixture ID와 해당 generated source/import를 축소 재현 자료로 사용할
수 있다. 원본 전체 생성 소스와 adapter stack trace 및 관측 JSON을
artifact에 보존했으나 모든 실패가 upstream issue로 접수되거나 최소 spec 하나로
축소된 상태는 아니다. 공식 도구 기반 보완으로 8개 언어를 검증 대상으로 유지하되,
핵심 5개와 Ruby/Dart의 Experimental·TypeScript의 Preview maturity 차이를 반영해
운영 지원 환경과 유지보수 책임을 정해야 한다.

기존 TypeScript SDK도 **동일한 더 엄격한 fixture**로 비교한다. 관측은 16/28이며
성공·조회·멱등키 요청 수·explicit retry·timeout은 맞는다. 나머지는 기존 공개
오류 API가 `defined`와 raw `Retry-After`를 노출하지 않고, 잘못된 issue 입력이
`OtpApiError`로 정규화되는 차이 때문이다. 기존 SDK는 `requestId`, `data`,
`retryAfterMs`를 보존한다. 이것은 기존 SDK 계약 회귀를 뜻하지 않는다.
기존 자체 계약의 `bun run check`(typecheck/lint/tests/build/pack/smoke/size/examples)
는 로컬 및 Actions에서 통과했고 기존 SDK 소스는 수정하지 않았다.

최종 보강 run에서 Java/Go의 raw·overlay 최소 repro 네 job도 모두
`passed: true`를 기록했다. PoC infrastructure의 16개 테스트(overlay·mock·증거
identity·CI 판정)와 ttsc, 추가 3개 언어의 native 보완 계층 guard도 통과했다.
Swift 외의 등록 target은 모두 실행했고 설치 실패나
빈 fixture build를 성공으로 치환한 행은 없다.

## ADR: 정식 배포 후속안

현재 결정은 **공식 Kiota와 얇은 보완 계층을 적용한 8개 언어의 조건부 PoC 채택**이다.
release 계정/이름/정책은
추가 결정이 필요하다. generated SDK와 K-OTP wrapper를 재생성 가능하게 분리하고
언어별 독립 SemVer를 사용한다. OpenAPI `info.version`, Kiota CLI/runtime version,
각 패키지 release version을 분리해 기록한다. 기존 npm/Sampo release workspace의
`@k-otp/sdk` 단일 패키지·서브패스 규칙은 유지한다.

| 생태계 | 후속 배포 설계 | 이번 검증과 남은 일 |
| --- | --- | --- |
| NuGet | 독립 package id/version, 승인된 publish workflow | local feed 확인; package metadata/license/symbols/signing 및 supported TFM matrix 결정 |
| Maven Central | group/artifact/version과 repository identity/서명 | JAR/Kotlin JVM 확인; source/Javadoc/signing, 최소 JDK, Kotlin nullable ergonomics 결정 |
| PyPI | 독립 distribution 및 Python 지원 버전 | wheel/import 확인; package metadata/types, async cancellation, 전체 Python 버전 matrix 결정 |
| Packagist | SDK subtree 또는 mirror/tag 제공 정책 | ZIP/PSR-4 확인; repository 경로와 tag/version semantics ADR, PHP 최소 버전 및 소비자 lock 정책 결정 |
| Go modules | module path/repository layout, release tag prefix, v2 suffix 정책 | file proxy/no-replace 확인; real module proxy discovery/ZIP layout 및 독립 tag 정책 검증 |
| RubyGems / pub.dev | 검증한 보완 profile 기반 preview 검토 | gem/archive consumer + 28/28 확인; Experimental runtime 보완의 유지보수·release metadata·최소 runtime 정책 미정 |
| npm Kiota 비교물 | 기존 SDK 유지, 별도 제품 필요성 재평가 | overlay profile의 28/28과 package 타입 소비 확인; 기존 npm 릴리스에 추가하지 않음 |

정식 배포 전에는 지원 OS/runtime 최소·최신 버전, 모든 documented request 옵션과
typed data, non-JSON/gateway 오류, TLS/redirect/proxy, auth key 유출 방지·교체,
timeout/cancellation 이후 결과 조회, concurrent client isolation, pagination 대규모
입력, retry backoff/예산, 모델/API diff 검토, dependency SBOM/license/vulnerability,
장기 재생성·패키지 파일 누락 및 upgrade 회귀를 확인한다. overlay의 60개 오류
완화와 Python/Go 및 Ruby/Dart/TypeScript 보완 계층을 제품 문서/테스트에 유지할
책임자도 필요하다.
이번 loopback fixture만으로 이러한 운영 항목을 통과했다고 주장하지 않는다.
