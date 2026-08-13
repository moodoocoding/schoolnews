# AI 교육, 오늘

초등교육과 관련된 AI·디지털 교육 뉴스를 하루 한 편씩 소개하는 자동 뉴스 큐레이션 웹사이트입니다.

이 프로젝트의 목적은 기사를 많이 보여주는 것이 아니라, 여러 신뢰할 만한 자료에서 확인된 사실을 짧고 이해하기 쉬운 글로 재구성해 학생, 교사, 학부모가 교육의 변화를 생각해 볼 계기를 제공하는 것입니다.

> `AI 교육, 오늘`은 현재 사용하는 가칭이며 개발 과정에서 변경할 수 있습니다.

## 제품 개요

서비스는 매일 다음 작업을 자동으로 수행합니다.

1. AI·디지털 교육과 관련된 최신 뉴스를 수집합니다.
2. 초등교육과의 관련성, 출처 신뢰도, 새로움 등을 기준으로 후보를 평가합니다.
3. 당일 주제 한 건과 관련된 여러 자료 및 과거 자료를 찾습니다.
4. 확인된 사실만으로 짧은 게시물을 작성하고 대표 추상 비주얼을 준비합니다.
5. 사실성, 중복, 출처, 형식을 검사합니다.
6. 품질 기준을 통과한 게시물을 웹사이트에 공개합니다.
7. 작업 결과와 오류를 기록하고 실패한 단계는 안전하게 재시도합니다.

```text
뉴스 소스
   ↓
수집·정규화 → 중복 제거 → 주제 평가·선정
                              ↓
과거 자료 검색 → 근거 기반 글 작성 → 품질 검사
                                      ↓
                              저장·자동 게시
                                      ↓
                              갤러리형 웹사이트
```

## 주요 사용자

- AI·디지털 교육의 변화를 알고 싶은 초등학교 교사
- 자녀의 디지털 학습 환경에 관심 있는 학부모
- 쉽고 안전한 설명을 통해 새로운 기술을 이해하려는 학생

학생도 볼 수 있는 공개 서비스인 만큼, 문장은 쉽고 차분하게 작성하며 불필요한 공포, 과장, 기술 만능주의를 피합니다.

## 게시물 구성

각 게시물은 다음 네 부분으로 구성합니다.

1. **오늘의 한 줄 요약**: 핵심을 한 문장으로 설명합니다.
2. **무슨 일이 있었나요?**: 여러 출처에서 확인된 사실과 맥락을 간결하게 소개합니다.
3. **함께 생각해 볼 질문**: 하나의 정답을 유도하지 않는 질문을 제시합니다.
4. **참고 기사와 출처**: 매체명, 기사 제목, 발행일과 원문 링크를 표시합니다.

기사 문장을 길게 복제하지 않으며, 생성된 모든 주요 사실은 참고 출처로 확인할 수 있어야 합니다.

## 웹사이트 경험

웹페이지는 복잡한 뉴스 포털이 아닌, 하루 한 장씩 기록이 쌓이는 작은 온라인 갤러리를 지향합니다.

- 상단에는 사이트 이름과 한 줄 소개만 표시
- 메인에는 최신순 뉴스 카드 갤러리 배치
- 카드에는 대표 이미지, 날짜, 짧은 제목, 한 줄 요약 표시
- 카드 선택 시 게시물 상세 화면으로 이동
- 첫 화면은 최신 글 12건을 보여주고 링크형 커서 페이지네이션 제공
- 모바일 한 열, 태블릿 두 열, 데스크톱 세 열의 반응형 그리드
- 회원가입, 댓글, 복잡한 메뉴와 과도한 애니메이션은 초기 범위에서 제외

## 자동 발행 정책

- 하루에 한 번, 한국 표준시(`Asia/Seoul`)를 기준으로 실행합니다.
- 같은 날짜의 작업을 다시 실행해도 게시물은 한 건만 생성되어야 합니다.
- 같은 기사 또는 실질적으로 같은 주제는 중복 발행하지 않습니다.
- 일시적인 장애는 제한된 횟수만큼 자동 재시도합니다.
- 근거가 부족하거나 품질 검사를 통과하지 못한 글은 공개하지 않습니다.
- 기본적으로 최근 72시간의 기사를 평가하고, 적합한 주제가 없으면 최근 7일 안의 미발행 후보를 다시 평가합니다.
- 대체 후보도 기준에 미달하면 내용을 꾸며내지 않고 발행을 보류한 뒤 운영 알림을 남깁니다.
- 발행이 보류된 날에는 빈 게시물을 만들지 않고 기존 최신 게시물을 그대로 보여줍니다.

완전 자동 운영은 무조건 발행한다는 뜻이 아니라, 수집부터 실패 처리와 알림까지 사람의 반복 작업 없이 안전하게 수행한다는 뜻입니다.

## 데이터와 저작권 원칙

- 공식 API와 RSS를 우선 사용하고, 크롤링은 허용 범위와 호출 빈도를 확인한 소스에만 적용합니다.
- `robots.txt`, 사이트 이용약관 및 관련 법규를 준수합니다.
- 원문 전체를 재게시하지 않고 분석에 필요한 최소 정보만 저장합니다.
- 기사 제목, 매체, 기자, 발행일, 원문 URL, 수집 시각을 추적 가능하게 보관합니다.
- MVP의 대표 비주얼은 게시물 불변 ID를 바탕으로 만든 결정론적 추상 패턴을 사용합니다.
- 뉴스 기사 사진과 매일 생성하는 AI 이미지는 MVP에서 사용하지 않습니다.
- 향후 이미지를 추가하더라도 사용 권한을 기록하고 실제 인물이나 사건의 보도사진처럼 오해할 표현을 사용하지 않습니다.

## 확정된 기술 구성

네 역할의 기술 토론 결과, 첫 구현은 운영 복잡도를 낮추기 위해 하나의 TypeScript 애플리케이션을 중심으로 구성했습니다. 영속 데이터베이스는 사용자가 이미 운영 중인 Supabase 프로젝트의 PostgreSQL을 사용합니다. 공개 화면은 publishable key와 RLS가 허용한 `published` 투영만 읽고, 자동화·발행 RPC는 서버 전용 secret key로 분리합니다. 현재 고정 버전은 Next.js 16.3.0, React 19.2.8, TypeScript 6.0.3, Zod 4.4.3, AI SDK 7.0.62, `@supabase/supabase-js` 2.112.3, `fast-xml-parser` 5.10.1, Vitest 4.1.10입니다. 기존 Firestore 코드는 이력 보존용으로 남아 있지만 활성 운영 경로가 아닙니다.

| 영역 | 확정안 | 목적 |
|---|---|---|
| 웹 애플리케이션 | Next.js App Router + TypeScript | 갤러리와 상세 페이지, 서버 API |
| 스타일 | 전역 CSS 디자인 토큰 + CSS Modules | 작은 디자인 시스템과 반응형 레이아웃 |
| 데이터베이스 | Supabase PostgreSQL + 개발용 `memory` | 기존 프로젝트 안의 전용 private schema와 공개 투영 사용 |
| 데이터 접근 | Supabase Data API/RPC + Zod 런타임 계약 | 공개 읽기와 서버 쓰기 권한 분리, 변경 이력 관리 |
| 뉴스 수집 | RSS·공식 API 우선 + 허용된 제한적 HTML 파서 | 기사 후보 자동 수집 |
| AI 처리 | 공급자 중립 인터페이스 + 구조화 출력을 지원하는 LLM | 근거 기반 글 작성과 의미 품질 평가 |
| 일일 실행 | 순수 TypeScript `runDaily()` + CLI + 얇은 Cron 어댑터 | 스케줄러 교체와 수동 재실행 지원 |
| 스케줄·배포 | M5에서 운영 환경과 비용을 확인한 뒤 확정 | 특정 플랫폼 종속 최소화 |
| 대표 비주얼 | 불변 게시물 ID 기반 SVG·CSS 추상 패턴 | 저작권·비용·실패 위험 제거 |
| 관측 | 구조화 로그 + 오류 알림 | 실패 위치, 비용, 발행 결과 확인 |

MVP에는 Redis, 별도 작업 큐, 벡터 데이터베이스, Elasticsearch와 별도 Python 서비스를 도입하지 않습니다. 필요성이 실제 사용량이나 품질 데이터로 확인될 때만 추가합니다.

## 확정된 제품·콘텐츠 결정

### 후보 선정

점수 계산 전에 광고성·중복·출처 불명·주제 부적합 후보를 제외합니다. 통과한 후보는 재실행해도 같은 결과가 나오도록 결정론적인 100점 규칙으로 평가합니다.

| 평가 항목 | 배점 |
|---|---:|
| 초등교육 관련성 | 30 |
| AI·디지털 구체성 | 20 |
| 출처 신뢰도와 독립성 | 20 |
| 과거 게시물 대비 새로움 | 20 |
| 교육·사회적 의미 | 10 |

자동 발행 후보는 총점 70점 이상, 초등교육 관련성 18점 이상, AI·디지털 구체성 10점 이상, 출처 신뢰도 12점 이상, 새로움 10점 이상이어야 합니다. 점수만으로 발행하지 않으며 근거·중복·콘텐츠·운영 품질 게이트도 모두 통과해야 합니다. LLM은 후보 점수와 최종 발행 상태를 바꿀 권한이 없습니다.

### 출처와 근거

- 기본 원칙은 `공식 1차 자료 1개 + 독립 보도 1개` 또는 `서로 독립적인 신뢰 출처 2개`입니다.
- 도메인이 다르더라도 같은 보도자료나 통신사 기사를 전재했다면 독립 출처로 계산하지 않습니다.
- 권한 있는 공공기관이 직접 확정한 발표일·시행일·대상 같은 단순 사실만 `AUTHORITATIVE_SINGLE_SOURCE` 예외를 허용합니다.
- 단일 출처 예외로 효과, 현장 반응, 안전성, 전망을 추론하거나 기업 홍보자료를 발행하지 않습니다.
- 모든 사실·맥락 문장은 짧은 근거 passage와 내부적으로 연결합니다.
- 공개 상세 화면에서는 수치·일정·정책 결정 등 핵심 사실에만 절제된 `[1]` 각주를 표시합니다.

### 콘텐츠 길이

- 제목: 권장 18~32자, 최대 36자
- 한 줄 요약: 권장 45~90자, 최대 100자
- 본문: 3~5문단, 최대 900자. 450자는 참고 기준이며 내용을 부풀리기 위해 강제하지 않습니다.
- 질문: 1~2개, 질문당 최대 80자

LLM은 제공된 근거를 쉬운 한국어로 재구성하는 역할만 담당합니다. 현재 구현은 초안 1회와 필요 시 수정 1회, 최대 2회의 생성 호출만 허용합니다. 향후 별도 모델 의미 평가를 연결하더라도 전체 파이프라인 호출·토큰·비용 상한 안에서만 실행합니다. 수정본이 다시 품질을 통과하지 못하면 발행을 보류합니다.

실제 생성과 외부 의미 평가는 서버 전용 `GOOGLE_GENERATIVE_AI_API_KEY`를 사용합니다. 모델은 `gemini-3.6-flash → gemini-3.5-flash-lite` 순서로 고정했고 Google 오류 body까지 확인한 429 `RESOURCE_EXHAUSTED`, 404 `NOT_FOUND`, 503 `UNAVAILABLE`에서만 하위 모델로 전환합니다. 인증·입력·품질 오류에는 재호출하지 않습니다. 각 물리 요청은 `routeAttempt`로 따로 감사·예산 집계되며 남은 호출 슬롯 안에서만 fallback합니다. 키 존재만으로 호출하지 않으며 `LLM_ENABLED=true`, `LLM_PROVIDER=gemini`, `GEMINI_FREE_TIER_DATA_USE_ACKNOWLEDGED=true` 세 설정이 모두 있어야 활성화됩니다. Google의 무료 등급과 가격은 바뀔 수 있으므로 감사 비용은 보수적인 유료 가격 상한으로 계산합니다. 무료 등급 데이터는 제품 개선에 사용될 수 있어 공개 기사 근거 외 개인정보나 비공개 학생 정보는 모델에 보내지 않습니다.

### 갤러리와 상세 화면

- 공개 저장소는 `published` 상태의 활성 리비전만 반환합니다.
- 목록은 `publishedAt DESC, id DESC`로 정렬하고 한 페이지에 12건을 제공합니다.
- 다음 페이지는 내부 구조를 노출하지 않는 불투명 커서와 `이전 기록 보기` 링크로 이동합니다.
- 카드는 4:3 추상 비주얼, 실제 게시 날짜, 제목, 한 줄 요약만 표시합니다.
- 상세 화면은 본문 폭을 약 680~760px로 제한하고 네 개의 고정 콘텐츠 영역과 출처 각주를 표시합니다.
- 당일 발행이 보류돼도 공개 배너나 빈 카드를 만들지 않고 기존 최신 글의 실제 날짜를 그대로 보여줍니다.
- MVP SEO 범위는 한국어 메타데이터, canonical URL, sitemap, `Article`·`CollectionPage` 구조화 데이터와 공통 OG 이미지입니다.

### 발행과 실패 처리

- KST 날짜당 게시물 컨테이너는 최대 하나이며 여러 생성 결과는 불변 리비전으로 기록합니다.
- 발행은 근거 관계와 모든 필수 품질 검사를 PostgreSQL의 짧은 원자 RPC 안에서 다시 확인한 뒤 상태를 전환합니다.
- 캐시 무효화는 발행 이후 별도 재시도 가능 단계로 실행합니다. 캐시 실패 때문에 이미 검증된 DB 발행을 되돌리지 않습니다.
- 대표 추상 비주얼은 외부 생성 API에 의존하지 않으며 비주얼 문제가 콘텐츠 발행을 막지 않습니다.
- 적합한 후보가 없는 정상 보류와 시스템 실패를 구분해 기록합니다.

## 핵심 데이터 모델

- `PublisherGroup`, `Source`: 매체 소유·원출처 계열과 수집 정책
- `RawArticle`, `Article`: 원본 응답과 정규화 기사 메타데이터
- `TopicCandidate`, `TopicArticle`: 유사 사건 묶음, 점수와 선정 근거
- `EvidenceItem`: 기사 내 허용된 짧은 근거 passage와 지문
- `Post`, `PostRevision`: KST 게시일 컨테이너와 불변 생성 이력
- `PostSentence`, `SentenceEvidence`: 문장 종류·중요도와 근거 연결
- `PostSource`: 공개 출처 순서와 게시물 관계
- `QualityCheck`: 검사 버전, 결과와 발행 차단 사유
- `PipelineRun`, `PipelineStepRun`: 날짜별 실행과 단계 재시도·입출력 지문
- `ModelCall`: 모델, 목적, 프롬프트 버전, 토큰과 비용 기록

게시물 상태는 `draft`, `validated`, `published`, `rejected`, `withheld`를 구분합니다. 공개 화면은 `published` 상태와 활성 리비전을 저장소 계층에서 원자적으로 강제합니다. 별도 이미지 파일과 권리 관리가 필요해질 때만 `Asset`을 추가합니다.

### Supabase PostgreSQL 구조

- 원본 기사, 근거, 주제, 게시물 리비전, 일일 실행 저널, artifact와 모델 호출 감사는 `news_clipping_private` schema에 저장합니다.
- `posts.publication_date_kst`와 `posts.slug`는 각각 unique 제약으로 하루 한 건과 고유 주소를 강제합니다.
- `post_revisions`, `pipeline_artifacts`, `model_calls`는 trigger로 수정·삭제를 거부하는 불변 감사 기록입니다.
- 브라우저가 접근하는 `public.published_posts`는 발행된 카드·상세에 필요한 필드만 가진 별도 투영입니다. 기사 passage, 프롬프트, 실행 저널과 초안은 포함하지 않습니다.
- 공개 목록은 `published_at DESC, id DESC` 인덱스와 `limit + 1` 커서를 사용합니다.
- `publish_post` RPC가 실행일·lease token·fence·revision, KST 날짜, slug, 근거 계보를 한 트랜잭션에서 확인하고 private 게시물과 공개 투영을 함께 만듭니다.
- `acquire_daily_run`, `checkpoint_daily_run`, `finish_daily_run` RPC는 PostgreSQL 서버 시각과 행 잠금·revision CAS를 사용합니다.

## 예상 디렉터리 구조

```text
.
├── AGENTS.md
├── README.md
├── coder/                 # 시니어 프로그래머 역할 프로필
├── src/
│   ├── app/               # 페이지와 서버 엔드포인트
│   ├── components/        # 갤러리 및 게시물 UI
│   ├── contracts/         # 공용 TypeScript·런타임 데이터 계약
│   ├── db/                # 데이터 모델과 쿼리
│   ├── pipeline/          # 수집부터 발행까지의 작업 단계
│   ├── prompts/           # 버전 관리되는 생성·평가 프롬프트
│   └── lib/               # 공통 설정과 유틸리티
├── tests/                 # 단위·통합·브라우저 테스트
└── scripts/               # 로컬 실행 및 운영 보조 스크립트
```

현재 `src/app`, `src/components`, `src/contracts`, `src/db/firestore`, `src/pipeline`, `src/prompts`, `src/repositories`, `src/styles`, `scripts`, `tests`가 구현되어 있습니다.

## 현재 구현

### 공용 계약과 안전 경계

- Zod 런타임 스키마와 TypeScript 타입을 한곳에서 정의해 기사, 근거, 후보 점수, 생성 글, 공개 게시물, 품질 결과와 파이프라인 실행 상태가 같은 계약을 사용합니다.
- KST 게시일과 엄격한 RFC 3339 시각을 구분하며 존재하지 않는 날짜, 중복 식별자, 고아 주장·근거와 모순된 성공·실패 상태를 거부합니다.
- 파이프라인 단계별 시각·오류·재개 상태, 실행 한도 초과 시 `blocked` 전환 같은 불변 조건을 검사합니다.
- 생성 호출의 목적·시도 번호·공급자·모델·프롬프트 버전·근거 ID·토큰·예상 비용·응답 ID를 검증하는 감사 계약과 최대 2회 생성 예산 계약을 추가했습니다.
- 서버 요청용 URL은 HTTPS만 허용하고 자격 증명, `localhost`, 리터럴 루프백·사설 IP를 차단합니다. 실제 수집 단계에서는 DNS 해석 결과와 리다이렉트 목적지도 요청 직전에 다시 검사해야 합니다.
- 환경 변수는 `SITE_URL`, `DATASTORE_PROVIDER`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, 서버 전용 `SUPABASE_SECRET_KEY`, `LLM_API_KEY`, 16자 이상의 `CRON_SECRET`을 런타임에서 검증합니다. 실제 값은 `.env.local`에만 두고 저장소에는 placeholder만 기록합니다.
- 공개 문장은 하나 이상의 고유 출처를 가져야 하며 KST 게시일은 실제 `publishedAt` 순간과 일치해야 합니다.

### Supabase 저장소와 보안

- `DATASTORE_PROVIDER=memory`는 자격 증명 없이 샘플을 사용하고, `supabase`는 서버의 공개 게시물 저장소를 지연 로드합니다.
- 공개 목록·상세는 publishable key로 `public.published_posts`만 조회하고, 반환 행을 기존 Zod 계약으로 다시 검증합니다. 비공개 상태, 중복 slug, 잘못된 정렬·커서·JSON은 fail-closed 처리합니다.
- private schema의 모든 테이블은 RLS를 활성화하고 `anon`·`authenticated`에 권한을 주지 않습니다. 공개 투영은 `status = 'published'` SELECT 정책만 제공합니다.
- 2026-08-13 기존 Supabase 프로젝트에 migration을 적용했습니다. 원격 확인 결과 private 테이블 14개, 서버 전용 RPC 5개, 강제 RLS가 생성됐고 공개 투영은 초기값 0건입니다.
- publishable key를 사용한 Data API smoke test에서 공개 투영은 `200 []`, private 테이블은 `404`, 서버 전용 RPC는 `401`로 확인했습니다. 샘플 데이터와 기존 프로젝트 데이터는 변경하지 않았습니다.
- 일일 실행 저장소는 서버 전용 secret key로만 RPC를 호출합니다. 키가 없으면 구성 단계에서 `STORE_UNAVAILABLE`로 중단하며 브라우저 번들·로그·README에 비밀값을 넣지 않습니다.
- 외부 오류는 행·키·cause를 노출하지 않는 안정 오류 코드로 바꾸고, RPC 응답의 날짜·run ID·token·fence·revision을 애플리케이션에서도 재검증합니다.
- 후속 migration `202608130002_pipeline_workspace_rpcs.sql`은 private schema를 Data API에 노출하지 않고 `generate`·`validate` artifact를 서버 전용 RPC로 put-once 저장합니다. DB 서버 시각의 lease, token, fence, journal revision과 현재 단계를 한 트랜잭션에서 확인하며 `collect`·`score`의 범용 artifact-only 쓰기는 거부합니다.
- 후속 migration `202608130003_content_persistence_rpcs.sql`은 수집원·기사·근거·collect artifact를 한 트랜잭션으로, 선정 주제·관계·score artifact를 다른 한 트랜잭션으로 저장합니다. 입력 payload와 artifact, 정확한 부모 참조가 일치하지 않거나 동일 지문이 다른 ID와 충돌하면 fail-closed 처리합니다.
- 서버 쓰기 어댑터는 content persistence, pipeline workspace와 `publish_post`만 호출하며 private table REST/DML을 사용하지 않습니다. 발행 전에는 통과한 generation artifact와 결정론적으로 변환한 publication artifact의 품질 결과·부모 계보·공개 게시물 내용을 다시 대조합니다.
- 일일 단계 컨텍스트는 로그에 남기지 않는 lease token과 fence, running checkpoint 이후 journal revision을 어댑터에 전달합니다. 결정론적 `validate`는 모델 호출 단계가 아니며, `generate`만 비용·미가격 호출 회수 규칙의 적용 대상입니다.
- 2026-08-13 최종 002~005 SQL을 운영 PostgreSQL의 단일 트랜잭션에서 컴파일한 뒤 `ROLLBACK`하고 잔여 객체가 없음을 확인했습니다. 이후 002→003→004→005를 순서대로 적용했고, 006 출처 예약, 007 모델 호출 장부, 008 발행 영수증 조정도 각각 원격 컴파일·권한 확인 후 적용했습니다. 현재 기존 프로젝트에는 001~008이 모두 반영돼 있습니다.
- 기존 Firestore 구현·설정 파일은 과거 수직 절편 재현을 위해 보존하지만 현재 선택 경로와 향후 운영 DB는 Supabase입니다.

### 샘플 저장소와 공개 화면

- 실제 뉴스가 아닌 15건의 결정론적 한국어 샘플 게시물을 인메모리 저장소로 제공합니다. 목록은 공개 게시물만 최신순으로 정렬하고 기본·최대 12건, 검증된 불투명 커서를 사용합니다.
- 메인은 12건 갤러리, 이전·최신 기록 이동, 빈 상태와 잘못된 커서 복구 화면을 제공합니다.
- 상세는 한 줄 요약, 사실·맥락, 생각 질문, 출처의 네 영역과 문장별 각주, 동적 메타데이터, 404를 제공합니다.
- 대표 이미지는 외부 파일 없이 게시물 ID로 만든 4:3 CSS 추상 패턴이며 모바일 1열, 태블릿 2열, 데스크톱 3열로 바뀝니다.
- 메인과 상세에 `개발용 샘플` 안내를 표시합니다. 실제 DB와 검증된 출처로 전환할 때 독립 컴포넌트 호출을 제거합니다.
- App Router의 Server Component를 기본으로 사용하며 오류 경계만 Client Component입니다. Next.js 16의 비동기 `params`와 `searchParams` 계약을 적용했습니다.

### 선정·구조화 생성·품질 게이트

- `topic-signals-v1`은 한국어 키워드 taxonomy로 초등 관련성, AI·디지털 구체성, 사회적 의미를 산출하고 출처 등록부와 과거 제목·지문으로 신뢰도와 새로움을 결정합니다. 교육 맥락이 없는 AI 산업 기사와 AI·디지털 내용이 없는 일반 초등 기사는 낮게 평가합니다.
- `scoreTopicSignals`는 30/20/20/20/10 가중치로 결정론적 100점 점수를 만들고, `evaluateTopicScoreThresholds`가 총점·초등 관련성·AI·디지털 구체성·신뢰도·새로움 최소값을 별도로 판정합니다. AI·디지털 구체성 최소값은 10/20입니다.
- 같은 `publisherGroupId`의 여러 피드는 독립 출처로 중복 계산하지 않습니다. RSS의 짧은 요약은 HTML을 평문으로 정제해 40~800자의 `locator="RSS 요약"` 근거 후보로 만들며, 직접 사실 권한은 `none`으로 강등합니다. 따라서 공공기관 RSS 요약도 단일출처 예외를 열거나 게시 승인을 뜻하지 않습니다.
- `validateGeneratedPost`는 형식과 길이, claim-evidence 연결, 화면에 실제 쓰인 주장과 근거, 핵심 주장 출처, 출처 독립성, 근거 ID의 정확성을 검사합니다.
- 사실·맥락뿐 아니라 한 줄 요약과 본문의 공개 문장에 쓰인 해석 주장도 하나 이상의 실제 근거 연결이 없으면 `UNSUPPORTED_CLAIM`으로 차단합니다. 따라서 품질 통과본은 공개 게시물 변환의 출처 필수 계약과 모순되지 않습니다.
- 단일 출처 예외는 기본 거부하며 명시적으로 확인된 공공기관 1차 자료가 직접 입증하는 단순 사실 주장만 허용합니다.
- AI SDK 7의 `generateText`와 `Output.object`를 사용하는 공급자 중립 어댑터가 `generatedPostSchema` 구조화 출력을 두 번 검증합니다. 실제 API 없이 재현 가능한 fake 공급자도 제공하며 실제 LLM 공급자·모델 패키지는 아직 연결하지 않았습니다.
- `generated-post-v2`는 짧은 근거 passage만 JSON 데이터로 전달하고, passage 안의 명령을 따르거나 외부 사실을 추가하지 못하도록 명시합니다. 내부 기사 ID·해시와 원문 URL은 모델 입력에서 제외하며 이메일·전화번호는 제거합니다.
- `semantic-quality-v1`은 제목·요약·본문·질문·claim 전 영역의 보수적인 홍보·과장 표현, claim별 단일 publisher/provenance 계열 근거의 효과·인과·전망 단정, 연결 passage에 없는 공개 문장과 claim의 아라비아 숫자·날짜를 차단합니다.
- 선택적 외부 `SemanticReview`는 현재 게시물의 claim/evidence ID와 스키마를 다시 검사하며 불일치하면 `SOURCE_CONFLICT`로 보류합니다. 구조·의미 품질 결과는 어느 한쪽의 실패도 지우지 않는 방식으로 병합합니다.
- `runPostGeneration`은 생성 후 예산과 품질을 검사하고 수정 가능한 실패만 한 번 재작성합니다. 출처 부족·근거 누락처럼 글만 고쳐 해결할 수 없는 실패에는 재호출하지 않으며, 모든 검사를 통과한 게시물만 `post` 필드로 반환합니다. 의미 평가기도 호출 감사·토큰·비용을 같은 최대 4회 모델 장부에 제출해야 하며, 평가기가 없거나 가격 계산식이 없거나 전체 한도를 넘으면 결과를 보류합니다.

### DB 독립 일일 자동 실행 골격

- `runDailyPipeline`은 현재 KST 날짜를 실행 키로 정하고 단계별 입력 지문, 출력 참조, 시도 번호, 사용량과 종료 사유를 `daily-run-v1` 저널에 기록합니다.
- 같은 날짜의 활성 실행에는 한 작업자만 임대를 얻습니다. 만료된 실행은 단조 증가하는 fencing token으로 회수하고, 이전 작업자의 checkpoint와 finish를 거부합니다.
- 성공한 단계는 입력 지문과 출력 참조를 다시 검증한 뒤 재사용합니다. 파이프라인 버전·단계 구성·저장 출력이 달라지면 실행을 `PIPELINE_VERSION_MISMATCH`로 차단합니다.
- 재시도는 단계별 최대 횟수, 지수 백오프, 단계 제한 시간과 전체 실행 마감 안에서만 수행합니다. 외부 중단은 `RUN_ABORTED`, 실행권 만료는 `LEASE_EXPIRED`로 구분합니다.
- 모델 가능 단계의 실패도 사용량을 장부에 합산합니다. 사용량을 알 수 없는 유료 호출은 미가격 호출로 기록하고 추가 모델 호출 없이 `BUDGET_EXCEEDED`로 차단합니다.
- 만료된 모델 단계는 설정·부모 계보가 같은 저장 산출물이 확인될 때만 재개합니다. 산출물로 완료를 증명하지 못하면 유료 호출이 이미 발생한 것으로 보고 미가격 1회를 기록한 뒤 재호출 없이 차단합니다.
- `publish`는 성공한 `validate` 뒤에만 올 수 있고 자동 재시도하지 않습니다. 발행 중 제한 시간·중단·알 수 없는 예외는 모두 `PUBLISH_TIMEOUT_AMBIGUOUS`로 보수적으로 차단합니다. `cache_refresh` 실패나 실행권 만료는 이미 성공한 발행을 되돌리지 않고 `published_with_warning`으로 보존합니다.
- 정상 보류, 예산 차단, 비재시도 실패와 경고 종료는 중간 checkpoint 없이 저장소의 한 번의 CAS finish로 기록해 종료 직전 중단 후 발행 단계가 되살아나지 않게 합니다.
- 현재 `MemoryDailyRunRepository`의 원자성과 하루 한 번 기록은 단일 Node.js 프로세스 안에서만 유효합니다. 운영 다중 인스턴스에서는 서버 시각과 트랜잭션 CAS를 사용하는 영속 저장소가 필요합니다.
- 선택적인 `runDate` 지정은 테스트와 승인된 내부 backfill 전용입니다. 향후 Cron·HTTP 입력과 연결하지 않고 일반 예약 실행은 항상 서버가 계산한 현재 KST 날짜를 사용합니다.

### 메모리 뉴스→선정→생성 수직 절편

- `MemoryPipelineWorkspaceRepository`는 `collect → news_ingestion`, `score → topic_selection`, `generate → post_generation` 조합만 허용하고, payload·설정·부모 참조를 포함한 SHA-256 출력 참조를 생성합니다.
- 같은 실행 단계의 산출물은 덮어쓰지 않습니다. 재개 시 현재 설정 지문과 정확한 부모 참조가 모두 일치해야만 기존 산출물을 사용하며, 불일치는 `PIPELINE_VERSION_MISMATCH`로 차단합니다.
- 주제 선정은 제목 유사도가 그룹의 모든 기사와 기준 이상인 경우에만 같은 사건으로 묶습니다. 입력 순서와 무관하게 근거를 정렬하며 공식 자료+독립 보도 또는 서로 다른 독립 보도 두 건을 직접 확인한 그룹만 통과시킵니다.
- 현재 활성 수집원은 과기정통부 공식 RSS 한 곳뿐이고 RSS 요약의 직접 사실 권한은 `none`입니다. 따라서 실제 기본 실행은 `NO_ELIGIBLE_TOPIC`으로 정상 보류하며 모델 호출은 0회입니다.
- 독립 출처를 주입한 통합 테스트에서는 기존 fake 생성 공급자와 fake 의미 평가기로 생성·품질 흐름을 검증합니다. 생성 산출물 저장 직후 체크포인트 중단도 재현해 외부 호출 없이 산출물을 재사용하고 모델 사용량을 정확히 한 번 합산합니다.
- 이 수직 절편은 프로세스 메모리에만 쓰고 `publish` 단계를 포함하지 않습니다. Supabase, 실제 LLM, 웹 공개 저장소에는 쓰지 않습니다.
- 메모리 workspace 자체는 lease fence와 원자 결합되지 않습니다. 실제 장시간 모델 호출과 영속 저장을 연결하기 전에는 호출 intent·fence CAS 또는 공급자 멱등 장부가 필요합니다.
- 복합 생성 단계의 기본 lease는 단계 제한 시간보다 안전 여유가 길도록 자동 계산합니다. 생성 설정에 공급자와 독립 의미 평가기 중 하나라도 없으면 첫 모델 호출 전에 설정을 거부합니다.

## 로컬 실행

요구 환경은 Node.js 22 이상과 npm입니다.

```bash
npm install
cp .env.example .env.local
npm run dev
```

기본 주소는 `http://localhost:3000`입니다. 이미 사용 중인 포트가 있으면 Next.js가 다른 로컬 포트를 선택합니다. 기본 `memory` 화면과 생성 회귀 테스트에는 Supabase와 LLM 키가 필요하지 않습니다. 현재 실제 LLM 공급자나 모델을 설정하지 않았으므로 개발 명령이 유료 API를 호출하지 않습니다.

외부 DB 쓰기 없이 실제 RSS 수집부터 정규화·중복 제거·후보 평가까지 실행하려면 다음 명령을 사용합니다. 이 명령은 인메모리 저장소에서만 처리하고 웹사이트나 외부 서비스에 게시하지 않으며, 기사 본문을 로그에 출력하지 않습니다.

```bash
npm run news:collect
```

현재 명령은 한 번의 수집 실행을 검증하는 CLI입니다. 프로세스가 끝나면 인메모리 기사는 사라집니다. 운영용 `daily:memory` 경로는 006 RPC를 통해 출처별 요청 간격을 서버 시각으로 예약하지만 이 단독 수집 CLI에는 그 예약이 없으므로 반복 실행용으로 사용하지 않습니다.

외부 뉴스·모델·DB·게시 서비스를 호출하지 않고 일일 실행 저널과 단계 순서를 검증하려면 다음 명령을 사용합니다.

```bash
npm run daily:dry-run
```

이 dry-run은 `collect → normalize → deduplicate → score → retrieve → generate → validate`를 결정론적 가짜 단계로 실행합니다. 실제 뉴스 수집, 모델 호출, 외부 쓰기와 게시를 모두 `false`로 출력하며 프로세스가 끝나면 메모리 저널도 사라집니다.

실제 공식 RSS를 읽어 메모리에서 수집·선정까지 KST 일일 실행으로 조립하려면 다음 명령을 사용합니다.

```bash
npm run daily:memory
```

이 명령은 네트워크로 등록된 공식 RSS를 한 번 읽지만 기사 제목·본문·근거 passage를 로그에 출력하지 않습니다. 네트워크 요청 직전에 Supabase 006 RPC가 등록부의 24시간 정책과 대조해 서버 시각으로 간격을 예약하며, 너무 이른 재실행은 `TOO_SOON`으로 중단합니다. 현재 독립 보도 출처가 없어 정상 상태에서는 생성·게시 없이 보류하고 공개 DB에는 쓰지 않습니다.

새 Supabase 프로젝트에서 공개 조회를 켜려면 `supabase/migrations`의 001~008을 번호 순서대로 적용한 뒤 다음 값을 `.env.local`에 설정합니다. 현재 연결된 기존 프로젝트에는 001~008이 적용돼 있습니다. 실제 키는 커밋하거나 `NEXT_PUBLIC_` 접두사로 노출하지 않습니다.

```bash
DATASTORE_PROVIDER=supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

공개 갤러리 조회에는 publishable key만 사용합니다. 일일 실행·artifact·발행 RPC를 실제 연결할 때만 서버 환경에 `SUPABASE_SECRET_KEY`를 별도로 설정하며, 이 값은 브라우저 코드와 클라이언트 응답에 포함하면 안 됩니다. 현재 마이그레이션은 빈 공개 투영을 만들 뿐 샘플 기사나 기존 데이터를 넣지 않습니다.

검증 명령은 다음과 같습니다.

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## 개발 계획

### M0 — 프로젝트 기반과 계약

- Next.js·TypeScript 프로젝트와 테스트 도구 초기화
- 안정 버전 고정 및 환경 변수 검증 골격 구성
- 공용 TypeScript 타입과 런타임 스키마 정의
- KST 날짜, 상태 전이, 오류 코드와 출처 독립성 계약 확정
- 계약을 통과하는 고정 픽스처 작성

완료 조건: 빌드·린트·타입 검사·테스트가 실행되고 세 영역이 같은 픽스처로 독립 개발할 수 있습니다.

상태: **완료**. 기반 설정, 환경 변수 검증, 공용 런타임 계약, 결정론적 픽스처와 회귀 테스트를 구현했습니다.

### M1 — DB에서 갤러리까지 수직 절편

- Firestore 문서 스키마 버전, 브라우저 전면 차단 규칙과 복합 인덱스
- `published` 전용 읽기 저장소와 12건 커서 조회
- 픽스처 게시물을 사용하는 갤러리·상세·404·빈 상태
- 불변 ID 기반 추상 비주얼과 반응형 1·2·3열 화면

완료 조건: 초안은 노출되지 않고 목록·상세가 같은 활성 리비전을 보여주며 모바일과 키보드로 이용할 수 있습니다.

상태: **코드 완료, Firebase 작업 보류**. 메모리·Firestore 저장소 전환, published-only 조회, 활성 리비전 검증, 멱등 Emulator 전용 시드, 규칙·인덱스와 갤러리·상세 수직 절편을 구현했습니다. 현재 기본값은 `memory`이며 실제 Firebase 프로젝트/ADC 연결과 Emulator 통합 검증은 사용자가 다시 진행하기로 할 때 수행합니다.

### M2 — 실제 뉴스 수집과 근거화

- 이용 조건을 확인한 RSS·공식 API 중심 소스 2~4개 연결
- 소스 등록부, 호출 제한, 장애 격리와 수집 기록 구현
- URL 정규화, 기사 지문, 전재·원출처 계열과 중복 판정
- 허용된 짧은 passage 단위 `EvidenceItem` 생성

완료 조건: 같은 입력을 반복 수집해도 기사 수가 증가하지 않고 출처 독립성 판정 이유를 추적할 수 있습니다.

상태: **1차 수직 절편 완료**. 과학기술정보통신부의 공식 보도자료 RSS 한 곳을 실제 연결하고, 네트워크 안전 검사부터 후보 점수까지 Firebase 없이 실행합니다. 이용 허락이 확인된 독립 교육 보도 출처가 아직 없으므로 실제 자동 게시에는 사용할 수 없습니다.

#### 현재 수집원과 이용 정책

- 활성 수집원은 과학기술정보통신부 공식 보도자료 RSS `https://www.msit.go.kr/user/rss/rss.do?bbsSeqNo=94` 한 곳입니다. 공식 RSS 안내를 확인했고 최소 간격은 24시간, 한 번에 최대 50건, 15초 제한, 1.5MB 응답 상한입니다. 2026-08-13 실제 1회 측정에서 첫 바이트 6.824초, 전체 9.828초, 700,119바이트로 확인돼 기존 10초 제한을 유한하게 조정했습니다. DNS·응답 시작·본문 읽기 timeout을 구분하고 멈춘 본문 reader를 직접 취소합니다.
- 피드의 `title`, `link`, `pubDate`, 짧은 `description`만 읽습니다. 실제 피드의 매우 긴 `content:encoded`, HWP 변환 JSON, 이미지, 첨부파일과 상세 `/bbs` 본문은 저장하거나 추가 크롤링하지 않습니다.
- 날짜만 제공하는 `YYYY.MM.DD` 값은 KST 자정 시각으로 변환하고 `publishedAtPrecision: "date"`로 원래 정밀도를 보존합니다.
- 2026-08-13 재조사에서 교육플러스 전체 RSS와 AI타임스 교육 RSS가 정상 응답했지만 각각 `All rights reserved`·무단전재 금지 또는 사전승낙 없는 복제·전송 금지 조건이라 `needs_review`로 유지했습니다. 에듀프레스는 GPTBot 전면 차단과 `All rights reserved`를 확인해 초기 제외했습니다. 공개 RSS와 robots 허용은 AI 재가공 라이선스가 아니므로 세 매체 모두 서면허락 전 운영 등록부·LLM 입력·공개 재가공에 넣지 않습니다.
- 정책브리핑 RSS는 2026년 7월 1일 공식 중단됐고, 교육부와 KERIS는 검증 가능한 공개 RSS/API를 찾지 못해 HTML 크롤링으로 우회하지 않았습니다.
- 과기정통부 공공데이터 OpenAPI는 무료·자동 승인 후보지만 키가 필요하므로 현재 연결하지 않았습니다. 추후 사용하면 RSS와 같은 기관으로 묶어 독립 출처 두 개로 계산하지 않습니다.
- 공식 발표 한 건은 발표일·대상 같은 직접 사실의 후보일 뿐, 효과·현장 반응·안전성·전망을 단독으로 뒷받침하지 않습니다. 독립 출처가 없으면 게시를 보류합니다.

구현된 안전 경계는 HTTPS와 자격 증명 없는 URL, DNS의 IPv4·IPv6 로컬·사설·예약 대역 차단, 같은 origin으로 제한된 리다이렉트와 홉별 재검증, 응답 형식·크기·시간 제한, DTD·외부 엔티티 거부, 항목별 오류 격리입니다. 수집기가 예외를 던지거나 잘못된 source 결과를 반환해도 해당 출처의 실패로 바꾸고 다른 출처 처리를 계속합니다. DNS 검사와 실제 연결 사이의 재해석 가능성은 남아 있어 운영 전에는 주소 고정 전송 계층으로 한 번 더 강화합니다.

Supabase `006` migration은 DB에 고정한 MSIT 24시간 정책과 호출자 값을 대조하고, 출처별 실제 요청 직전에 PostgreSQL 서버 시각으로 `last_attempt_at`을 원자 예약합니다. 실패한 요청도 간격을 소비하며 이른 중복 요청은 `TOO_SOON`으로 차단합니다. 메모리 운영 CLI도 이 예약을 통과한 뒤에만 RSS를 호출하며 Supabase Secret Key나 적용된 006 RPC가 없으면 수집 전에 중단합니다. 2026-08-13 기존 프로젝트에 migration을 적용했고 Secret Key RPC 인증, 정책 불일치 무변경 차단, MSIT 냉각 시간 초기화와 즉시 재예약 `TOO_SOON`을 확인했습니다. 같은 날 002~005도 최종 SQL을 통합 transaction에서 compile 후 rollback하고 잔여 객체가 없음을 확인한 뒤 순서대로 적용했습니다. 보도자료 재작성본을 독립 출처로 잘못 세지 않도록 기사 단위 upstream provenance를 확인할 수 없는 신규 언론 소스는 향후에도 `supporting`으로만 시작합니다.

### M3 — 선정·작성·품질 게이트

- 결정론적 100점 후보 평가와 과거 전체 게시물 중복 검색
- claim·evidence 구조화 글 생성과 리비전 이력
- 형식·근거·출처 독립성·중복·표현·의미 품질 검사
- 모델 호출·토큰·비용 한도와 실패 후 제한 수정

완료 조건: 근거 없는 주장, 중복 주제, 출처 부족, 비용 초과와 품질 실패 결과가 공개되지 않습니다.

상태: **1차 수직 절편 완료, 실제 LLM 연결 보류**. 공급자 중립 구조화 생성, 근거 전용 프롬프트, 감사·예산 기록, 결정론적 의미 검사, 최대 1회 수정과 최종 보류 흐름을 fake 공급자로 검증했습니다. 실제 LLM 공급자·모델·가격표, 감사 가능한 외부 의미 평가기, 과거 전체 게시물 사건 중복 검색과 모델 기반 모순 검사는 아직 연결하지 않았습니다.

### M4 — 멱등 일일 자동화

- 순수 TypeScript 일일 실행 함수와 외부 쓰기 없는 dry-run CLI
- 저장소 중립 임대·저널 계약, 단계 입출력 지문, 재시도와 실패 지점 재개
- 원자적 발행 상태 전이와 별도 캐시 무효화 단계
- 보류·장애·비용 한도 알림과 수동 재실행

완료 조건: 같은 날짜의 동시·중복 실행에서도 최대 한 건만 발행되고 중단 지점부터 안전하게 복구합니다.

상태: **DB 독립 골격과 메모리 수직 절편 완료, Supabase 영속 경계 구현**. KST 실행일, 메모리 임대·fencing token·revision CAS, 불변 시도 저널, 단계 지문 재사용, 제한 재시도·중단·예산 차단, 발행 모호성·캐시 경고 보존을 구현했습니다. M2 수집·선정과 M3 복합 생성·품질을 메모리 artifact로 연결했고, Supabase에는 서버 시각·행 잠금·fence·revision CAS 기반 일일 실행 RPC와 서버 쓰기 어댑터를 추가했습니다. 실제 공급자·독립 출처, Cron, 알림과 실행 단계의 Supabase 조립은 아직 남았습니다.

### M5 — 운영 검증과 승인 배포

- 전체 린트·타입·단위·통합·UI·접근성·빌드 검증
- 운영 Supabase RLS·권한, 백업·복구, secret key와 비용 한도 설정
- 프리뷰에서 예약 실행, 중복 호출, 발행 보류, 캐시 실패 시험
- 사용자 승인 후 프로덕션 배포 및 다음 KST 예약 결과 확인

완료 조건: 사람의 일일 개입 없이 실행되고 실패 시 미완성 글을 공개하지 않으며 운영자가 원인을 확인할 수 있습니다.

### M6 — 기존 Supabase 프로젝트 연결

- `news_clipping_private` 전용 schema와 `public.published_posts` 공개 투영 migration
- publishable key 기반 published-only 목록·상세 Data API 저장소
- server-only secret key 기반 일일 실행 RPC 저장소
- 서버 시각 lease·fence·revision CAS와 원자 `publish_post` 함수
- RLS·GRANT로 브라우저 private 접근과 공개 쓰기 차단

완료 조건: 기존 프로젝트의 다른 테이블을 변경하지 않고 새 schema를 적용하며, 익명 사용자는 발행된 공개 투영만 읽고 자동화 쓰기는 서버 전용 RPC로만 수행합니다.

상태: **코드·001~008 migration 적용과 공개·서버 권한 smoke test 완료**. URL, publishable key와 server secret key는 Git에서 제외된 로컬 환경에만 설정했습니다. 공개 투영 조회, private 접근 차단, 서버 전용 RPC 허용과 publishable key 거부를 원격에서 확인했습니다. 공개 데이터는 아직 0건이며 운영 stage factory가 미연결이라 자동화 쓰기와 발행은 실행되지 않습니다.

### M7 — Supabase 영속 자동화 경계

- lease token·fence·journal revision을 단계 실행에서 서버 쓰기 어댑터까지 전달
- 수집 domain rows와 collect artifact, 선정 rows와 score artifact의 원자 저장 RPC
- generate·validate artifact의 계보·설정 지문·put-once 영속 workspace
- 검증 통과 generation에서 공개 게시물로 가는 결정론적 publication mapping과 원자 발행 어댑터
- private schema 직접 Data API 접근 금지, service-role 전용 `SECURITY DEFINER` RPC

완료 조건: 중단·재개와 stale worker 상황에서도 domain 데이터, artifact, 품질 결과와 발행물이 갈라지지 않고 서버 전용 권한으로만 저장됩니다.

상태: **어댑터·forward migration·원격 적용 완료, 운영 실행 조립 보류**. 002~005는 통합 compile+rollback 뒤 순차 적용했고 006~008도 개별 원격 검증 후 적용했습니다. collect·score·generate·validate·publish의 서버 전용 저장 경계, 모델 호출 전 예산 예약·fence 장부와 발행 응답 유실 조정 RPC가 준비됐습니다. 남은 핵심은 이 저장소들을 실제 일일 실행 stage factory에 조립하고, 실제 모델·발행은 그 통합 테스트를 통과한 뒤에만 활성화하는 것입니다.

### M10 — 모델 호출 장부와 발행 조정

- 007은 물리 모델 호출 전에 run·score evidence·lease·fence·revision과 일일 호출·토큰·비용 상한을 원자 예약합니다. fresh `prepared` 영수증만 실제 호출을 허용하고 `reserved`는 중복 호출 없이 보류합니다.
- 모델 응답의 audit는 예약 범위 안에서만 finalize되며, generate artifact의 audit·usage 합계와 관계형 `model_calls`가 정확히 일치해야 합니다. 사용량은 모델 호출 수·입력 토큰·출력 토큰·추정 비용 모두 exact equality를 요구합니다.
- 008은 발행 RPC 응답 유실 시 같은 run·revision·validation artifact의 공개 결과를 읽어 commit 여부를 조정합니다. 발행 자체 자동 재호출은 계속 금지합니다.
- 두 RPC는 Secret Key에서만 접근 가능하고 publishable key에서는 차단됩니다. 007 원격 빈 조회는 `null`, publishable 호출은 HTTP 401을 확인했습니다.

상태: **migration·저장소·서버 설정 factory·원격 권한 검증 완료, 일일 stage 조립 보류**. 모델 호출 성공 후 audit finalize와 generation artifact 저장 사이에 프로세스가 종료되면 중복 호출은 막지만 생성 결과 본문은 복원하지 못해 그날 실행을 안전 보류합니다. 자동 복원보다 중복 모델 호출 금지를 우선한 현재 정책입니다.

## 개발 역할

프로젝트의 개발 관점은 다음 네 프로필로 나뉩니다.

- [김도윤 — 백엔드·데이터 아키텍트](coder/01_김도윤_백엔드_아키텍트.md)
- [박서연 — AI·콘텐츠 파이프라인 엔지니어](coder/02_박서연_AI_콘텐츠_엔지니어.md)
- [이현우 — 프런트엔드·제품 엔지니어](coder/03_이현우_프런트엔드_엔지니어.md)
- [최민재 — 플랫폼·신뢰성 엔지니어](coder/04_최민재_플랫폼_신뢰성_엔지니어.md)

공통 구현 규칙과 작업 방식은 [`AGENTS.md`](AGENTS.md)를 따릅니다.

## 토론 결과와 문서 기록 책임

2026-08-12에 네 프로필이 독립 제안과 교차 검토를 진행했습니다.

- 김도윤은 수집 정책, 데이터 모델, 출처 독립성, 중복 방지와 멱등 실행을 설계했습니다.
- 박서연은 결정론적 후보 선정, claim·evidence 연결, LLM 역할 제한과 품질 게이트를 설계했습니다.
- 이현우는 12건·최대 3열 갤러리, 절제된 각주, 추상 비주얼과 공개 조회 계약을 설계했습니다.
- 최민재는 발행·캐시 분리, 비용·재시도 한도, 통합 게이트와 단계별 개발 계획을 확정했습니다.

README의 단일 기록 책임자는 **최민재 역할을 맡는 루트 에이전트**입니다. 서브 에이전트는 README를 직접 수정하지 않고 완료 보고에 `README 반영 항목`을 제출합니다. 루트는 모든 통합 작업에서 코드·계약·환경 변수·사용자 동작·검증·제한 사항의 변경을 README의 현재 상태와 변경 기록에 함께 반영합니다. README 갱신이 끝나지 않은 작업은 완료로 처리하지 않습니다.

Git은 세부 파일 차이를 보존하고 README는 사람이 이해할 수 있는 작업 단위의 변경 이유와 결과를 보존합니다.

## 변경 기록

| 날짜 | 작업 ID | 기록자 | 참여 프로필 | 변경 요약 | 영향 파일 | 검증 | 남은 결정 |
|---|---|---|---|---|---|---|---|
| 2026-08-12 | PLAN-001 | 최민재(루트) | 전체 | 서비스 목적, 네 영역 게시물, 갤러리형 UI와 하루 한 번 자동 운영 범위 정의 | `README.md` | 사용자 요구와 문서 대조 | 서비스명 확정 |
| 2026-08-12 | PLAN-002 | 최민재(루트) | 김도윤·박서연·이현우·최민재 | 역할별 시니어 프로필과 완료 기준 작성 | `coder/*.md` | 프로필 4개 파일 확인 | 없음 |
| 2026-08-12 | PLAN-003 | 최민재(루트) | 전체 | 서브 에이전트 파일 소유권, 계약 우선, 단계별 병렬 개발과 검토 게이트 수립 | `AGENTS.md`, `README.md` | 문서 구조·역할 경계 검토 | 없음 |
| 2026-08-12 | PLAN-004 | 최민재(루트) | 전체 | 두 차례 역할 토론으로 기술 구성, 근거 정책, 콘텐츠·UI 계약, M0~M5 계획 확정 | `README.md`, `AGENTS.md` | 네 역할의 수용·수정·반대 의견 통합 | LLM·DB·배포 공급자와 정확한 실행 시각 |
| 2026-08-12 | M0-BASE-001 | 최민재(루트) | 최민재 | Next.js·TypeScript 애플리케이션, 고정 의존성, 환경 변수·린트·테스트·빌드 설정 초기화 | `package*.json`, `.env.example`, `.gitignore`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts` | 설치 감사 취약점 0, lint·typecheck·test·build 통과 | 운영 DB·LLM·배포 공급자 |
| 2026-08-12 | M0-CONTRACT-001 | 최민재(루트) | 김도윤·박서연·최민재 | 기사·근거·주제·콘텐츠·공개 조회·파이프라인 계약과 교차 검토 보완 구현 | `src/contracts/**`, `src/lib/config/env.ts`, `tests/contracts/**`, `tests/config/**`, `tests/fixtures/**` | 엄격 날짜·URL·주장 그래프·상태 불변 조건 포함 전체 38개 테스트 통과 | DNS·리다이렉트 SSRF 방어는 실제 수집기에 추가 |
| 2026-08-12 | M0-DATA-001 | 최민재(루트) | 김도윤 | 15건 샘플의 공개 전용 인메모리 저장소, 최신순 12건 조회, 안전한 불투명 커서와 상세 조회 구현 | `src/repositories/**`, `tests/backend/**` | 저장소 테스트 7개 및 전체 검사 통과 | 후속 M1에서 Firestore 선택 경계 추가 완료 |
| 2026-08-12 | M0-AI-001 | 최민재(루트) | 박서연 | 100점 후보 점수·임계값, claim-evidence 1차 품질 게이트, 단일 출처 제한과 생성 프롬프트 골격 구현 | `src/pipeline/scoring/**`, `src/pipeline/quality/**`, `src/prompts/**`, `tests/content/**` | 콘텐츠 테스트 15개 및 전체 검사 통과 | 신호 산출기·LLM 공급자·의미 품질·주제 중복 검사 |
| 2026-08-12 | M0-FRONTEND-001 | 최민재(루트) | 이현우 | 12건 갤러리, 상세 네 영역·각주, 추상 패턴, 페이지네이션, 복구·404·오류·샘플 안내 화면 구현 | `src/app/**`, `src/components/**`, `src/styles/**`, `tests/ui/**` | 390/768/1280px 1/2/3열, 홈·상세·잘못된 커서·404, 콘솔 경고·오류 0 | 실제 DB 연결, axe·색 대비·완전한 키보드 자동 검사 |
| 2026-08-12 | M0-INTEGRATION-001 | 최민재(루트) | 전체 | 교차 검토 지적을 계약·품질 게이트에 반영하고 Next.js·React 지침에 맞춰 통합 검증, Next 개발 서버 자동 에이전트 규칙 유지 | `AGENTS.md`, `README.md`, 전체 구현 | lint·typecheck·38 tests·production build·브라우저 검증 통과 | M1 DB 수직 절편 착수 |
| 2026-08-12 | M1-FIREBASE-DECISION-001 | 최민재(루트) | 김도윤·최민재 | PostgreSQL·Drizzle 계획을 Firebase Cloud Firestore Standard와 공식 Node.js 서버 클라이언트로 변경 | `package*.json`, `.env.example`, `next.config.ts`, `AGENTS.md`, `coder/*.md`, `README.md` | 공식 문서 대조, 의존성 audit 취약점 0 | 실제 Firebase 프로젝트와 배포 환경 |
| 2026-08-12 | M1-FIRESTORE-001 | 최민재(루트) | 김도윤 | 메모리/Firestore 선택, KST 날짜 컨테이너·불변 리비전·slug 예약, published-only 커서 조회와 Emulator 전용 멱등 시드 구현 | `src/db/firestore/**`, `src/repositories/**`, `scripts/seed-firestore.ts`, `firestore.*`, `firebase.json`, `tests/backend/**` | backend 16개 및 전체 58개 테스트, lint·typecheck·build 통과 | 실제 Emulator·ADC 통합 검증 |
| 2026-08-12 | M1-FIRESTORE-REVIEW-001 | 최민재(루트) | 박서연·최민재 | 공개 출처 필수·중복 차단, KST 날짜·리비전 시각 불변 조건, 고아 slug 오류, 운영 Emulator·named DB 차단과 IAM 경계 보완 | `src/contracts/**`, `src/lib/config/env.ts`, `src/repositories/firestore-published-post.repository.ts`, `tests/**`, `README.md` | 교차 검토 게이트, 전체 58개 테스트와 audit 0 통과 | 원자 발행기·IAM 분리·Emulator 동시성 smoke test |
| 2026-08-12 | M2-SOURCE-001 | 최민재(루트) | 김도윤·박서연 | 공식 RSS·API, robots와 이용 조건 조사 후 MSIT 공식 RSS만 활성 채택하고 에듀프레스·정책브리핑·교육부·KERIS 제외 사유 기록 | `README.md`, `src/pipeline/collectors/source-registry.ts` | 공식 안내·실제 HTTPS XML·robots 확인 | 이용 허락이 명확한 독립 교육 보도 출처 확보 |
| 2026-08-12 | M2-CONTRACT-001 | 최민재(루트) | 김도윤·박서연·최민재 | 수집원 정책·요청 한도·부분 실패 계약, 발행일 정밀도와 AI·디지털 최소 선정점수 추가 | `src/contracts/**`, `tests/contracts/**`, `tsconfig.json` | 계약 테스트 18개, typecheck 통과 | 운영 전 DNS 재해석 방어 강화 |
| 2026-08-12 | M2-BACKEND-001 | 최민재(루트) | 김도윤 | 안전한 RSS 수집, 날짜·URL·제목 정규화, SHA-256 지문, 연결 중복 제거와 인메모리 멱등 저장 구현 | `src/pipeline/{collectors,normalize,deduplicate}/**`, `src/repositories/article-memory.repository.ts`, `tests/backend/**` | 백엔드 신규 18개 테스트, 실제 MSIT RSS 50건 수집 성공 | 실행 간격 영속 강제와 기사 영속 저장 |
| 2026-08-12 | M2-AI-001 | 최민재(루트) | 박서연 | 한국어 주제 신호·과거 제목/지문 새로움·출처 그룹 신뢰도와 RSS 요약 근거 후보 생성 구현 | `src/pipeline/{scoring,retrieval}/**`, `tests/content/**` | 콘텐츠 신규 테스트 및 전체 검사 통과 | 실제 기사 회귀세트, 단일 공식 출처 효과·전망 의미 차단 |
| 2026-08-12 | M2-INTEGRATION-001 | 최민재(루트) | 김도윤·박서연·최민재 | Firebase 없는 `collect → normalize → deduplicate → memory upsert → score → evidence candidate` 부분 실패 흐름과 CLI 연결 | `src/pipeline/orchestrator/**`, `scripts/run-news-ingestion.ts`, `package*.json`, `tests/integration/**`, `README.md` | 부분 실패·재실행·전체 실패 통합 테스트, 실제 CLI는 50건·게시 0건 | 영속 저장·독립 근거·LLM·Cron 연결 |
| 2026-08-13 | M2-REVIEW-001 | 최민재(루트) | 박서연·최민재 | 교차검토에서 수집기 throw·잘못된 결과 격리, outcome source 일치, RSS 요약 권한 강등, 발행일 정밀도 필수화와 same-origin 리다이렉트 제한 보완 | `src/contracts/**`, `src/pipeline/{collectors,retrieval,orchestrator}/**`, `tests/**`, `README.md` | P0 없음, lint·typecheck·전체 test·build 통과 | DNS 재바인딩 방어, 실행 간격 영속 강제, 사건 단위 유사도 개선 |
| 2026-08-13 | M3-CONTRACT-001 | 최민재(루트) | 박서연·최민재 | 생성 목적·모델 사용량·호출 감사·2회 예산·의미 finding 계약과 AI SDK 7 핵심 의존성 추가 | `package*.json`, `src/contracts/generation.ts`, `tests/contracts/**` | 계약 테스트·typecheck·audit 취약점 0 | 실제 공급자·모델·가격표 선택 |
| 2026-08-13 | M3-AI-002 | 최민재(루트) | 박서연 | 공급자 중립 구조화 생성, 근거 전용 v2 프롬프트·연락처 제거, AI SDK 어댑터와 실제 호출 없는 fake 공급자 구현 | `src/pipeline/generation/**`, `src/prompts/**`, `tests/content/generation.test.ts` | 생성 테스트 8개, 출력·사용량·오류·인젝션 경계 통과 | 실제 공급자 구조화 출력 호환성 검증 |
| 2026-08-13 | M3-QUALITY-003 | 최민재(루트) | 박서연 | 홍보·과장, claim별 단일계열 인과·전망, 공개 문장·claim 수치 근거와 외부 의미 결과를 fail-closed 검사 | `src/pipeline/quality/**`, `tests/content/semantic-quality.test.ts`, `tests/fixtures/content/semantic.ts` | 의미 품질 테스트 22개 통과 | 패턴 밖 동의어·한글 수량·과거 사건 중복 |
| 2026-08-13 | M3-INTEGRATION-001 | 최민재(루트) | 박서연·최민재 | 생성→구조·의미 검사→최대 1회 수정→재검사→통과본만 반환하는 보류 오케스트레이터와 생성·평가·실패 호출의 통합 감사·예산 누적 구현 | `src/pipeline/orchestrator/**`, `tests/integration/**`, `README.md` | lint·typecheck·17파일 140테스트·build·audit 0 통과 | 감사 가능한 실제 의미 평가기, 영속 일일 예산 ledger |
| 2026-08-13 | M3-REVIEW-001 | 최민재(루트) | 박서연·최민재 | 미평가 환각 통과, claim 혼합 인과 희석, 공개 수치 우회, 실패·평가 호출 예산 누락을 교차검토로 재현하고 fail-closed·통합 ledger로 보완 | `src/pipeline/{generation,quality,orchestrator}/**`, `src/prompts/**`, `tests/**`, `README.md` | 4차 검토에서 P0/P1 없음, 전체 검사 통과 | 호출 전 비용 hard cap과 외부 evaluator 버전 감사 |
| 2026-08-13 | M4-CONTRACT-001 | 최민재(루트) | 김도윤·최민재 | KST 일일 실행 저널, lease·fence, 단계 시도·재시도 정책, 사용량·종료 상태 불변 계약 구현 | `src/contracts/{automation,pipeline}.ts`, `tests/contracts/**` | 계약 회귀 테스트와 typecheck 통과 | 운영 저장소의 서버 시각·트랜잭션 CAS |
| 2026-08-13 | M4-BACKEND-001 | 최민재(루트) | 김도윤 | 단일 프로세스 메모리 일일 실행 저장소, 원자 acquire, 만료 회수, token·fence·revision CAS와 append-only 저널 구현 | `src/repositories/memory-daily-run.repository.ts`, `src/pipeline/orchestrator/daily-run-store.ts`, `tests/backend/**` | 저장소 13개 회귀 테스트, stale writer·만료 finish·저널 회귀 차단 | 다중 인스턴스 영속 저장소 |
| 2026-08-13 | M4-INTEGRATION-001 | 최민재(루트) | 최민재 | 단계 지문 재개, 제한 재시도, 예산·중단 차단, validate→publish 순서, 발행 모호성·캐시 경고와 외부 쓰기 없는 dry-run 구현 | `src/pipeline/orchestrator/run-daily-pipeline.ts`, `scripts/run-daily-dry-run.ts`, `package.json`, `tests/integration/**` | 일일 실행 14개 회귀 테스트와 dry-run 성공 | 실제 단계 조립, Cron·알림 |
| 2026-08-13 | M4-REVIEW-001 | 최민재(루트) | 김도윤·최민재 | 종료 직전 중단 후 publish 부활, 만료 finish 선점, 실패 모델 비용 재시도, cache crash 상태 강등을 재현하고 원자 finish·fencing·fail-closed 예산으로 보완 | `src/contracts/**`, `src/pipeline/orchestrator/**`, `src/repositories/**`, `tests/**`, `README.md` | P0 해소, lint·typecheck·19파일 170테스트·build·audit 0·dry-run 통과 | 서버 시각 영속 저장, 실제 발행 사후 조정 |
| 2026-08-13 | M5-AI-001 | 최민재(루트) | 박서연 | M3 생성 결과를 검증 완료·품질 보류·예산 차단·공급자 실패로 안전하게 변환하고 사용량을 보존하는 일일 단계 매핑 구현 | `src/pipeline/generation/daily-generation-mapping.ts`, `tests/content/daily-generation-mapping.test.ts` | 신규 매핑 17개, 콘텐츠 72개 테스트·typecheck·lint 통과 | 실제 공급자·의미 평가기 선택 |
| 2026-08-13 | M5-BACKEND-001 | 최민재(루트) | 김도윤 | 설정·부모 계보·payload 지문, 단계-kind 제한, put-once와 중단 후 단계 조회를 갖춘 인메모리 실행 workspace 구현 | `src/repositories/memory-pipeline-workspace.repository.ts`, `tests/backend/memory-pipeline-workspace.repository.test.ts` | 신규 13개, 백엔드 61개 테스트·typecheck·lint 통과 | 영속 workspace의 fence CAS·호출 장부 |
| 2026-08-13 | M5-INTEGRATION-001 | 최민재(루트) | 김도윤·박서연·최민재 | RSS 중단 신호, 결정론적 complete-link 주제 묶음, 단일 공식 RSS 0-call 보류와 M2→M3→M4 메모리 수직 절편·안전 재개 CLI 구현 | `src/pipeline/{collectors,orchestrator}/**`, `scripts/run-memory-daily-pipeline.ts`, `package.json`, `tests/integration/**`, `README.md` | lint·typecheck·23파일 213테스트·build·audit 0 통과 | 이용 허락된 독립 출처, 실제 모델·평가기, 영속 실행 저장소·Cron |
| 2026-08-13 | M5-REVIEW-001 | 최민재(루트) | 최민재 | 0-call 보류·계보 일치·중단 후 사용량·미증명 모델 회수·외부 비게시를 교차 검토하고 최대 제한 시간 lease와 평가기 사전검사를 보완 | `src/pipeline/orchestrator/**`, `tests/integration/**`, `README.md` | P0/P1 없음, 최종 lint·typecheck·23파일 213테스트·build·audit 0·dry-run 통과 | 실제 모델 전 영속 invocation fence ledger |
| 2026-08-13 | M6-SUPABASE-DECISION-001 | 최민재(루트) | 김도윤·최민재 | 운영 DB를 기존 Supabase PostgreSQL 프로젝트로 확정하고 publishable/secret 권한과 환경 경계로 문서·프로필 갱신 | `AGENTS.md`, `coder/*.md`, `.env.example`, `src/lib/config/env.ts`, `package*.json`, `README.md` | 환경 계약 9개, 의존성 audit 취약점 0 | secret key와 Cron 배포 환경 |
| 2026-08-13 | M6-SUPABASE-SCHEMA-001 | 최민재(루트) | 김도윤 | private 핵심·관계 테이블, 공개 published 투영, 불변 감사 trigger, 검증 publication artifact, 일일 실행·원자 발행 RPC와 RLS/GRANT migration 구현 | `supabase/migrations/**`, `tests/backend/supabase-schema.test.ts` | 정적 schema 테스트 7개·lint·typecheck 통과 | 사용자 승인 후 실제 PostgreSQL 컴파일·적용 검증 |
| 2026-08-13 | M6-SUPABASE-REPO-001 | 최민재(루트) | 김도윤 | Data API 기반 published-only 공개 조회와 Supabase RPC 기반 fenced DailyRunStore, 서버 전용 client factory 구현 | `src/db/supabase/**`, `src/repositories/supabase-*.ts`, `tests/backend/supabase-*.test.ts` | 전체 28파일 251테스트·lint·typecheck·build·audit 0 통과 | 실제 원격 RLS·RPC smoke test |
| 2026-08-13 | M6-GIT-001 | 최민재(루트) | 최민재 | 프로젝트 전체를 GitHub `moodoocoding/schoolnews`의 `main` 브랜치 최초 이력으로 기록하고 로컬 비밀·빌드 산출물을 제외 | 전체 추적 파일, `.gitignore`, `README.md` | 커밋 전 비밀값·추적 대상 검사 및 전체 검증 결과 재확인 | 후속 변경은 기능 단위 커밋으로 기록 |
| 2026-08-13 | M6-SUPABASE-DEPLOY-001 | 최민재(루트) | 김도윤·최민재 | 기존 Supabase 프로젝트에 forward-only migration을 적용하고 공개 조회·private/RPC 차단·강제 RLS를 원격 검증 | 원격 Supabase schema, `.env.local`, `README.md` | private 14개·RPC 5개·RLS 강제, 공개 Data API `200 []`, private `404`, 서버 RPC `401` | secret key·영속 workspace·발행 어댑터 연결 |
| 2026-08-13 | M7-SUPABASE-WORKSPACE-001 | 최민재(루트) | 김도윤·최민재 | DB 서버 시각 lease·token·fence·revision CAS에 묶인 generate·validate artifact RPC와 Supabase workspace 저장소 구현 | `supabase/migrations/202608130002_*`, `src/db/supabase/pipeline-workspace.data-source.ts`, `src/repositories/supabase-pipeline-workspace.repository.ts`, `tests/backend/supabase-pipeline-workspace*` | 실제 PostgreSQL rollback 컴파일, workspace 18개 회귀 테스트 | 운영 migration 적용과 stage factory 연결 |
| 2026-08-13 | M7-SUPABASE-CONTENT-001 | 최민재(루트) | 김도윤·최민재 | 수집 domain+artifact와 선정 domain+artifact를 각각 한 트랜잭션에 저장하고 동일 ID의 모든 관계형 필드를 불변 비교하는 server-only RPC·저장소 구현 | `supabase/migrations/202608130003_*`, `src/db/supabase/content-persistence.data-source.ts`, `src/repositories/supabase-content-persistence.repository.ts`, `tests/backend/supabase-content-persistence*` | 초기 PostgreSQL rollback 컴파일, 최종 정적 content persistence 회귀 통과 | 최종 통합 SQL 컴파일과 canonical survivor 정책 |
| 2026-08-13 | M7-SUPABASE-PUBLISH-001 | 최민재(루트) | 김도윤·박서연·최민재 | 검증 generation의 품질·계보를 결정론적 publication과 대조하고 모호 응답을 자동 재시도하지 않는 원자 발행 어댑터 구현 | `src/pipeline/{quality,orchestrator}/**`, `src/db/supabase/publisher.data-source.ts`, `src/repositories/supabase-publisher.repository.ts`, `tests/{backend,content,integration}/**` | 전체 검사와 공개 문장 근거 회귀 통과 | commit receipt 조정 RPC와 승인된 실제 발행 시험 |
| 2026-08-13 | M7-RUNNER-AUTHORITY-001 | 최민재(루트) | 최민재 | 일일 단계에 비로그 lease token·fence·journal revision을 전달하고 결정론적 validate를 모델 비용 단계에서 제외 | `src/pipeline/orchestrator/run-daily-pipeline.ts`, `tests/integration/**`, `src/db/supabase/configured-write.repositories.ts` | stale lease 컨텍스트 회귀 포함 전체 검사 통과 | Supabase 운영 stage 조립 |
| 2026-08-13 | M7-SUPABASE-LOCKED-CLOCK-001 | 최민재(루트) | 김도윤·최민재 | 적용된 001을 수정하지 않고 acquire/checkpoint/finish/publish가 daily row lock 뒤 서버 시각을 읽도록 네 RPC를 교체하는 forward migration 추가 | `supabase/migrations/202608130004_*`, `tests/backend/supabase-locked-server-clock-schema.test.ts` | 001과 clock 위치 외 exact 비교 10개·backend/typecheck/lint 통과 | 적용 전 실제 PostgreSQL 통합 컴파일·lock wait 회귀 |
| 2026-08-13 | M8-GEMINI-001 | 최민재(루트) | 박서연·최민재 | Google Gemini 기사 생성·외부 의미 평가와 최신 Flash→Flash-Lite 제한적 자동 강등, 물리 호출별 감사·예산 경계 추가 | `src/lib/ai/**`, `src/pipeline/{generation,orchestrator}/**`, `src/contracts/generation.ts`, `supabase/migrations/202608130005_*`, `.env.example`, `package*.json`, `tests/**` | 실제 키 모델 목록 조회와 Gemini 3.6 최소 생성 성공, fallback 회귀·전체 검사 | 무료 등급 정책 정기 확인, 영속 invocation intent/fence ledger |
| 2026-08-13 | M9-COLLECT-SAFETY-001 | 최민재(루트) | 김도윤·박서연·최민재 | MSIT 응답 실측에 따른 15초 제한과 단계별 timeout, 출처별 24시간 서버 예약 RPC·CLI 연결, Gemini 전송 전 학생 식별정보·전체 입력량 차단 및 독립 출처 권리 재조사 | `src/pipeline/collectors/**`, `src/prompts/**`, `src/pipeline/generation/generation-support.ts`, `src/{db,repositories}/**`, `scripts/run-memory-daily-pipeline.ts`, `supabase/migrations/202608130006_*`, `tests/**`, `README.md` | 실제 MSIT 요청 1회, 수집·개인정보·간격 예약 회귀와 전체 검사 | 독립 언론 서면허락, upstream provenance |
| 2026-08-13 | M9-SUPABASE-006-APPLY | 최민재(루트) | 최민재 | 기존 Supabase 프로젝트에 source collection reservation migration 적용 및 오늘의 MSIT 냉각 시간 안전 초기화 | `supabase/migrations/202608130006_*`, `.env.local`(Git 제외), `README.md` | SQL Editor 성공, Secret Key 읽기 RPC, 정책 불일치 무변경 검사, allowed→TOO_SOON 확인 | 다음 허용 시각 이후 실제 일일 수집 검증 |
| 2026-08-13 | M10-SUPABASE-002-005-APPLY | 최민재(루트) | 김도윤·박서연·최민재 | workspace·content persistence·locked server clock·Gemini fallback audit migration을 rollback compile 후 기존 프로젝트에 순차 적용 | `supabase/migrations/202608130002_*`~`005_*`, `.env.local`(Git 제외), `README.md` | 정적 26 tests/typecheck, 원격 통합 compile+rollback, 기존 행·제약·RPC 대조, 네 migration 성공, Secret 허용·publishable 42501 확인 | invocation ledger·publish receipt 후 운영 stage 연결 |
| 2026-08-13 | M10-MODEL-LEDGER-001 | 최민재(루트) | 김도윤·최민재 | score evidence 계보·lease/fence/revision·일일 예산에 묶인 모델 호출 intent 예약, strict audit finalize와 generate artifact 결속 구현·적용 | `supabase/migrations/202608130007_*`, `src/{db,repositories}/**model-invocation*`, `tests/backend/model-invocation*`, `README.md` | 원격 compile+rollback·적용 성공, Secret 빈 조회 `null`, publishable HTTP 401, 관련 39 tests·typecheck·lint 통과 | 운영 stage factory에서 Gemini 물리 호출 전후 조립 |
| 2026-08-13 | M10-PUBLISH-RECEIPT-001 | 최민재(루트) | 김도윤·최민재 | 발행 응답 유실 때 run·revision·validation artifact 기준으로 commit 여부만 조정하는 server-only receipt RPC·저장소 구현·적용 | `supabase/migrations/202608130008_*`, `src/{db,repositories}/**publish-receipt*`, `tests/backend/publish-receipt*`, `README.md` | 원격 compile+rollback·적용·권한 smoke, receipt 회귀 포함 관련 39 tests·typecheck·lint 통과 | publisher timeout 경로에 조회 1회 연결 |

## 현재 상태

**단계: M0 완료 / M1 Firestore 이력 보존 / M2 인메모리 뉴스 수집 완료 / M3 생성·품질 수직 절편 완료 / M4 DB 독립 자동화 완료 / M5 메모리 E2E 완료 / M6~M10 Supabase 001~008 적용·서버 쓰기 경계 완료 / 운영 stage 조립·예약 배포 보류**

- 제품 범위와 게시물 구조: 확정
- 기술 방향과 MVP 제외 항목: 확정
- 데이터·콘텐츠·공개 화면 계약: 런타임 스키마와 회귀 테스트 구현 완료
- 서브 에이전트 개발·검토·README 기록 방식: 확정
- 실행 가능한 애플리케이션: 메모리 샘플과 Supabase 기반 메인·상세 화면 구현 완료. 로컬 선택값은 `supabase`이며 공개 게시물이 아직 없어 빈 갤러리 상태를 표시합니다.
- Supabase: 기존 프로젝트에 001~008을 적용해 private schema·공개 투영·RLS, server-clock 일일 실행/발행, immutable workspace, collect/topic 원자 저장, Gemini route 감사, MSIT 24시간 예약, 모델 호출 intent·예산 장부와 발행 영수증 조정 RPC가 존재합니다. URL·publishable·server secret key는 Git에서 제외된 `.env.local`에만 저장했고 공개 조회, private 차단, Secret Key RPC 인증, publishable 거부, 강제 RLS와 즉시 재예약 차단을 확인했습니다. migration ledger schema는 없으므로 당분간 SQL Editor 순차 적용만 사용하고 CLI `db push/repair/include-all`은 사용하지 않습니다.
- Firestore: 이전 구현은 이력 보존용이며 활성 운영 경로가 아님
- 실제 뉴스 수집: MSIT 공식 RSS 1개에서 안전한 메타데이터 수집, 정규화, 중복 제거, 인메모리 멱등 저장, 후보 점수·근거 후보 생성까지 연결
- 후보 점수와 생성 품질 게이트: 한국어 신호, Gemini 구조화 생성·외부 의미 평가, 결정론적 의미 검사, 최대 1회 수정·보류까지 구현. 사용자의 무료 등급 데이터 사용 확인에 따라 로컬 Gemini opt-in을 활성화했습니다. Gemini 3.6 최소 호출은 성공했고, 학생·보호자 식별 패턴이나 전체 근거 6,000 grapheme 초과 시 모델 호출 전에 보류합니다. 첫 `daily:memory` timeout 원인은 수정했지만 24시간 정책 때문에 같은 날 원격 재실행하지 않았습니다.
- 일일 자동 실행: KST 날짜별 메모리 lease·fence·저널과 설정·부모 계보를 가진 artifact workspace를 연결했습니다. 실제 RSS 수집→결정론적 주제 선정→복합 생성·품질 단계를 재개할 수 있고, 기본 단일 출처에서는 모델 0회로 정상 보류합니다. Supabase 서버 저장소는 구현됐지만 운영 stage factory에는 아직 조립하지 않았으며 dry-run과 실제 RSS 메모리 CLI 모두 외부 게시를 하지 않습니다.
- 통합 검증: ESLint 경고 0, TypeScript 통과, 49개 파일 377개 테스트, 프로덕션 빌드와 npm audit 취약점 0을 확인했습니다. 002~005 통합 compile+rollback 및 순차 적용, 006~008 개별 원격 compile·적용을 확인했습니다. workspace RPC는 Secret Key에서 null을 반환하고 publishable key에서는 `42501`, 모델 장부 RPC는 publishable key에서 HTTP 401로 차단됩니다. 다중 세션 lock-wait 회귀는 남았습니다.
- 실제 RSS 검증: 50건 수집·정규화·삽입 성공, 점수 기준 통과 0건, 근거 후보 0건, 게시 시도 없음
- 브라우저 검증: 홈 12건, 상세 네 영역·출처 2개, 잘못된 커서 복구, 404, 390/768/1280px 1/2/3열, 가로 넘침·콘솔 경고·오류 없음
- 알려진 제한: Supabase pipeline workspace·content persistence·publisher·model invocation·publish receipt 저장소와 001~008 DB 객체는 준비됐지만 운영 stage factory는 아직 연결하지 않았습니다. 따라서 Supabase 기반 Gemini 호출과 실제 예약 발행은 계속 비활성입니다. 로컬 메모리 Gemini opt-in은 현재 공식 RSS 한 곳만으로 독립 근거 기준을 통과하지 않아 실제 기사 생성 대신 0-call 보류됩니다. 공개 근거만으로 AI 재가공을 허용하는 독립 언론 출처도 아직 없으며 교육플러스에 서면허락을 받는 것이 우선입니다. 같은 콘텐츠 지문의 과거 기사와 새 URL을 연결하는 canonical survivor 정책, DNS 사전 검사와 실제 연결 사이의 재바인딩 방어, 제목 휴리스틱을 넘는 사건 동일성 판정도 운영 전 강화해야 합니다. Cron·알림은 미연결이고 공개 데이터도 아직 0건입니다. 전용 axe·색 대비·완전한 키보드 자동 검사도 미실행입니다.
- 007은 호출·입력·출력·비용을 모델 호출 전에 영속 예약하고 실제 audit를 exact 합계로 결속합니다. 다만 공급자 성공 후 audit finalize와 generation artifact 저장 사이에 중단되면 모델을 중복 호출하지 않는 대신 생성 본문을 자동 복원하지 못해 해당 실행을 안전 보류합니다.
- 결정론적 의미 검사는 보수적인 한국어 패턴과 아라비아 숫자만 다룹니다. 동의어·우회 표현, 한글 수량과 깊은 모순·주제 중복은 감사 가능한 외부 의미 평가기로 보완해야 하며, 해당 평가기가 없으면 `runPostGeneration`은 결과를 공개하지 않고 보류합니다.

바로 다음 작업은 **운영 stage factory를 연결해 `006 예약 → 003 collect/score → 007 모델 호출 장부 → 002 validate publication → publish_post → 008 receipt 조정` 흐름을 fake 공급자로 먼저 통합 검증하는 것**입니다. 그 뒤 승인된 테스트 게시물 1건의 원자 발행과 공개 갤러리 반영, Cron·알림·배포를 순서대로 진행합니다. 콘텐츠 측 병행 과제는 이용 허락이 명확한 독립 교육 보도 출처 확보입니다. 현재 공식 RSS 한 곳만으로는 의도대로 AI 호출 없이 보류되므로 두 번째 독립 출처가 있어야 실제 일일 글 작성 검증으로 넘어갈 수 있습니다.
