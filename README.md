# Slack Knowledge Bot (지식봇)

슬랙(Slack) 스레드에서 오고 간 논의와 문제 해결 과정을 구조화된 지식으로 축적하고, 축적된 지식을 바탕으로 팀원들의 질문에 정확하게 답변해주는 AI 지식 봇입니다.

---

## 목차

- [소개](#소개)
- [주요 기능](#주요-기능)
- [작동 원리 및 설계 철학](#작동-원리-및-설계-철학)
- [기술 스택](#기술-스택)
- [사전 준비물](#사전-준비물)
- [단계별 설치 및 세팅 가이드](#단계별-설치-및-세팅-가이드)
- [사용 방법 및 대화 예시](#사용-방법-및-대화-예시)
- [제공 스크립트](#제공-스크립트)
- [테스트 및 검증](#테스트-및-검증)
- [운영 비용 안내](#운영-비용-안내)
- [자주 묻는 질문 및 문제 해결 (FAQ)](#자주-묻는-질문-및-문제-해결-faq)
- [프로덕션 배포](#프로덕션-배포)
- [라이선스](#라이선스)

---

## 소개

개발 및 운영 과정에서 수많은 기술적 논의, 장애 원인 규명, 아키텍처 결정이 슬랙 스레드에서 이루어집니다. 하지만 시간이 지나면 대화가 묻히고, 동일한 문제가 발생했을 때 과거의 해결 경험을 찾기 어렵습니다.

**Slack Knowledge Bot**은 이러한 문제를 해결하기 위해 만들어졌습니다.

- 스레드의 복잡한 대화를 **핵심 상황, 원인, 해결책, 관련 시스템**으로 자동 구조화하여 저장합니다.
- 유사한 장애나 질문이 들어왔을 때, **정밀도 우선(Precision-First) 하이브리드 검색**을 통해 확실한 과거 기록과 원본 스레드 링크를 제시합니다.
- 근거가 없는 경우 억지로 답변을 꾸며내지 않고 솔직하게 기록이 없음을 안내하여 높은 신뢰도를 유지합니다.

---

## 주요 기능

### 1. 📌 스레드 지식 자동 추출 및 저장 (`save_knowledge`)

- 대화가 진행된 스레드에서 봇을 호출하여 저장을 요청하면, LLM이 스레드 전체를 분석하여 지식 항목(`Knowledge Entry`)으로 변환합니다.
- 단순한 텍스트 요약이 아니라 **상황(Situation), 원인(Cause), 해결책(Resolution), 관련 시스템(Systems), 태그(Tags)**를 분리하여 데이터베이스에 저장합니다.
- 같은 스레드에서 다시 저장을 요청하면 새로운 항목을 중복 생성하지 않고 **기존 기록을 최신 상태로 갱신**합니다.

### 2. 🔍 정밀도 우선 하이브리드 지식 검색 (`find_related_knowledge`)

- "이 이슈 전에도 있었어?", "결제 오류 관련 선례 있어?"와 같은 질문에 답변합니다.
- **벡터 의미 검색(pgvector)**과 **키워드 유사도 검색(pg_trgm)**을 결합하고 RRF(Reciprocal Rank Fusion)로 후보군을 추립니다.
- 추출된 후보군을 바탕으로 LLM이 2차로 **실제 관련 여부를 엄격하게 판정**하여, 확실한 관련 기록만 원본 링크와 함께 제공합니다.

### 3. 📝 스레드 맥락 요약 (`read_thread`)

- 긴 논의가 오간 스레드의 원문을 직접 읽고 **논의 배경, 결정된 사항, 아직 미해결된 과제**를 일목요연하게 정리해 드립니다.

### 4. 💡 사내 선례 기반 기술 검토

- 새로운 기술 제안이나 아키텍처 논의 시 사내 지식베이스의 과거 결정 사례를 검색하여, 제안 요약, 사내 선례, 추가 확인이 필요한 질문, 잠재적 위험 요소를 체계적으로 짚어줍니다.

### 5. 🗑️ 지식 삭제 및 관리 (`delete_knowledge`)

- 민감한 정보가 포함되었거나 잘못 저장된 스레드 기록은 명령을 통해 즉시 지식베이스에서 안전하게 삭제할 수 있습니다.

---

## 작동 원리 및 설계 철학

```
[ Slack Event ] ──> [ /api/webhooks/slack ] ──> (즉시 200 OK 응답)
                             │
                             ▼ (Next.js after() 백그라운드 처리)
                  [ Chat SDK / Knowledge Agent ]
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   [ 도구 실행: 검색 / 저장 ]            [ LLM 응답 스트리밍 ]
   - Hybrid Search (Vector + Trigram)        │
   - LLM 2차 관련성 판정                      ▼
            │                         [ Slack Thread 실시간 표시 ]
            ▼
   [ Postgres (pgvector) ]
```

1. **초고속 웹훅 응답과 비동기 백그라운드 처리**
   - 슬랙은 3초 이내에 웹훅 응답을 요구합니다. 본 봇은 요청을 받는 즉시 `200 OK`를 반환하고, Next.js의 `after()`를 통해 백그라운드에서 20~40초의 정밀 LLM 추론을 안정적으로 처리합니다.
   - 응답 대기 중 사용자에게 `thread.startTyping("스레드를 읽는 중...")` 상태를 표시하여 쾌적한 UX를 제공합니다.

2. **비대칭 텍스트 비교 (Asymmetric Comparison)**
   - 질문이 진행 중인 스레드는 아직 '해결책'이 없는 상태입니다. 따라서 벡터 검색 시 저장된 문서에서도 해결책을 제외하고 **상황(Situation)과 시스템명 중심**으로만 임베딩을 비교합니다. 이를 통해 장애가 발생한 긴급한 순간에도 과거의 유사 사례를 정확하게 매칭할 수 있습니다.

3. **후보 검색과 LLM 판정의 분리**
   - 벡터 검색은 특성상 질문과 전혀 상관없는 내용이라도 '가장 덜 무관한' 문서를 상위 결과로 반환합니다. 본 봇은 검색 엔진이 가져온 후보를 LLM이 직접 읽고 관련성을 엄격히 판정하게 하여, 엉뚱한 정보를 사실처럼 안내하는 할루시네이션을 원천 차단합니다.

4. **스레드 원문(Transcript) 영구 보관**
   - 슬랙 무료 플랜의 90일 메시지 제한이나 채널 아카이브, 메시지 삭제에 대비하여 추출 결과와 함께 원문 텍스트를 안전하게 보관합니다. 프롬프트나 모델이 발전했을 때 언제든 기존 데이터를 고품질로 재가공할 수 있습니다.

5. **도메인 로직과 플랫폼 어댑터의 완전한 분리**
   - `src/domain/` 디렉터리의 핵심 지식 관리 로직은 슬랙이나 특정 프레임워크에 의존하지 않는 순수 TypeScript 함수로 구성되어 있습니다. 슬랙 연결 없이도 CLI 스크립트(`bun run smoke`) 및 테스트 코드로 전체 파이프라인을 검증할 수 있습니다.

---

## 기술 스택

- **Runtime & Package Manager**: [Bun](https://bun.sh)
- **Framework**: [Next.js 16](https://nextjs.org) (App Router), React 19, TypeScript
- **Chat Bot Framework**: [Chat SDK](https://chat-sdk.dev) (`chat`, `@chat-adapter/slack`, `@chat-adapter/state-pg`)
- **AI & LLM**: [Vercel AI SDK](https://sdk.vercel.ai)
  - 추론/추출/판정: Anthropic `claude-opus-5`
  - 임베딩: OpenAI `text-embedding-3-large` (1536차원)
- **Database**: PostgreSQL (`pgvector`, `pg_trgm` 확장 지원, 예: [Neon](https://neon.com))

---

## 사전 준비물

본 프로젝트를 실행하기 위해 아래 계정 및 환경이 필요합니다. 모두 무료 티어로 시작하실 수 있습니다.

1. **[Bun](https://bun.sh)** (v1.0 이상)
2. **[Neon](https://neon.com)** — Serverless PostgreSQL (`pgvector` 지원)
3. **[Anthropic Console](https://console.anthropic.com)** — Claude API Key 발급
4. **[OpenAI Platform](https://platform.openai.com)** — Embedding API Key 발급
5. **[Slack API](https://api.slack.com/apps)** — 슬랙 봇 앱 생성 및 워크스페이스 권한

---

## 단계별 설치 및 세팅 가이드

### 1단계: 저장소 복제 및 패키지 설치

터미널에서 저장소를 클론하고 의존성 패키지를 설치합니다.

```bash
git clone <저장소_URL>
cd slack-knowledge-bot
bun install
```

---

### 2단계: PostgreSQL 데이터베이스 준비

1. [Neon](https://neon.com)에 로그인하여 새로운 프로젝트를 생성합니다.
2. 대시보드의 Connection Details에서 **Pooled connection** 문자열(호스트명에 `-pooler`가 포함된 주소)을 복사합니다.
3. _참고: 로컬 Docker 환경을 사용하실 경우 `pgvector/pgvector:pg17` 이미지를 사용하시면 `pgvector`와 `pg_trgm`이 기본 활성화되어 있습니다._

---

### 3단계: 환경 변수 1차 설정

환경 변수 예시 파일을 복사하여 `.env.local` 파일을 생성합니다.

```bash
cp .env.example .env.local
```

`.env.local` 파일을 열고 아래 3가지 항목을 먼저 입력합니다. (슬랙 관련 키는 5단계에서 입력합니다.)

```env
POSTGRES_URL=postgresql://<유저>:<비밀번호>@<호스트>/<DB이름>?sslmode=verify-full
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...
```

> 💡 **참고**: `pg` 드라이버 안정성을 위해 연결 문자열 끝의 SSL 모드는 `sslmode=verify-full`로 명시하시는 것을 권장합니다.

---

### 4단계: DB 마이그레이션 및 정합성 검증

데이터베이스 테이블 및 인덱스를 생성하고 정상 동작하는지 검증합니다.

```bash
# 1. 스키마 마이그레이션 실행
bun run migrate

# 2. 데이터베이스 확장, 인덱스 및 쿼리 동작 검증
bun run check-db
```

`bun run check-db` 스크립트는 `pgvector`와 `pg_trgm` 확장, 인덱스를 확인하고 합성 데이터를 잠깐 삽입하여 하이브리드 검색 쿼리를 검증한 후 자동 정리합니다. (외부 LLM 호출이 없어 비용이 발생하지 않습니다.)

---

### 5단계: Slack 앱 생성 및 매니페스트 설정

1. [Slack API Apps 페이지](https://api.slack.com/apps)로 이동하여 **Create New App** 버튼을 클릭합니다.
2. **From an app manifest**를 선택하고 앱을 추가할 워크스페이스를 지정합니다.
3. 아래의 매니페스트 YAML 내용을 그대로 붙여넣고 생성을 완료합니다.

```yaml
display_information:
  name: 지식봇
  description: 슬랙 스레드의 지식을 저장하고 찾아주는 AI 봇
features:
  bot_user:
    display_name: knowledgebot
    always_online: true
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - groups:history
      - groups:read
      - im:history
      - chat:write
      - users:read
settings:
  socket_mode_enabled: false
  org_deploy_enabled: false
  token_rotation_enabled: false
```

> ⚠️ **주의**: 매니페스트의 `bot_user.display_name`은 봇의 핸들(슬러그) 역할을 하므로 영문 소문자, 숫자, 하이픈만 허용됩니다. 한글 표시 이름은 이후 7단계에서 설정합니다.

4. 좌측 메뉴의 **Install App**으로 이동하여 **Install to Workspace**를 클릭하여 워크스페이스에 앱을 설치합니다.
5. 설치 후 발급된 키 값을 `.env.local`에 추가합니다:
   - **`SLACK_BOT_TOKEN`**: **OAuth & Permissions** 메뉴의 _Bot User OAuth Token_ (`xoxb-`로 시작)
   - **`SLACK_SIGNING_SECRET`**: **Basic Information** 메뉴의 _Signing Secret_

---

### 6단계: 봇 이름과 핸들(`BOT_USERNAME`) 설정

슬랙에서 봇의 이름은 다음 3가지 영역에서 다르게 사용되므로 주의가 필요합니다.

| 위치                                 | 용도 및 규칙                                     | 한글 지원 여부    |
| ------------------------------------ | ------------------------------------------------ | ----------------- |
| `display_information.name`           | 앱의 공식 이름 (설치 화면, 앱 목록 노출)         | 가능 (최대 35자)  |
| `bot_user.display_name` (매니페스트) | 시스템 핸들 (영문 소문자, 숫자, `_`, `-`)        | 불가 (ASCII 전용) |
| **App Home → Your App's Presence**   | **스레드 대화창에 표시되는 이름 (Display Name)** | **가능**          |

- **한글 이름을 원하시는 경우**: 슬랙 앱 관리 페이지의 **App Home → Your App's Presence → Edit**에서 Display Name을 `지식봇` 등으로 변경해 주세요.
- **`.env.local`의 `BOT_USERNAME`**: 표시 이름이 아닌 **기본 username(핸들)**을 입력해야 Chat SDK가 `@멘션`을 정확히 인식합니다. (예: `knowledgebot`)

```env
BOT_USERNAME=knowledgebot
```

---

### 7단계: 로컬 개발 서버 실행 및 터널링

슬랙 웹훅 이벤트를 로컬 환경에서 수신하기 위해 개발 서버를 켜고 터널을 실행합니다.

```bash
# 터미널 1: Next.js 개발 서버 실행
bun run dev
```

```bash
# 터미널 2: Cloudflare Tunnel을 통한 외부 공개 URL 생성
# (설치되어 있지 않다면: brew install cloudflared)
cloudflared tunnel --url http://localhost:3000
```

터널이 실행되면 출력되는 `https://<랜덤문자열>.trycloudflare.com` 형태의 주소를 확인합니다.

---

### 8단계: 슬랙 연결 및 웹훅 사전 검증

슬랙 앱 설정에 URL을 등록하기 전에, 토큰과 서명, 웹훅 통신이 정상인지 진단 스크립트로 확인합니다.

```bash
bun run check-slack https://<터널주소>.trycloudflare.com/api/webhooks/slack
```

모든 항목에 `✓` 체크가 표시되면 슬랙 웹훅 검증(URL Verification)을 통과할 준비가 완료된 것입니다.

---

### 9단계: Slack 이벤트 구독(Event Subscriptions) 등록

1. 슬랙 앱 설정 페이지의 **Event Subscriptions** 메뉴로 이동하여 기능을 **On**으로 활성화합니다.
2. **Request URL**에 `https://<터널주소>.trycloudflare.com/api/webhooks/slack`을 입력합니다. (잠시 후 `Verified ✓` 문구가 나타납니다.)
3. 하단의 **Subscribe to bot events** 섹션에서 다음 2가지 이벤트를 추가합니다:
   - `app_mention` — 채널에서 봇이 멘션되었을 때 수신
   - `message.im` — 봇과의 1:1 다이렉트 메시지(DM) 수신
4. 페이지 하단의 **Save Changes**를 클릭하고, 상단에 재설치 안내 노란색 배너가 뜨면 **Reinstall your app**을 눌러 변경사항을 적용합니다.

---

### 10단계: 채널 초대 및 동작 확인

1. 봇을 사용할 슬랙 채널로 이동하여 봇을 초대합니다.
   ```
   /invite @지식봇
   ```
2. 스레드에서 대화를 나눈 뒤 봇을 멘션하여 지식 저장 및 조회를 테스트해 보세요!

---

## 사용 방법 및 대화 예시

### 채널 내 사용 (스레드 멘션 필수)

채널에서는 불필요한 호출과 간섭을 방지하기 위해 **봇을 직접 멘션(`@지식봇`)했을 때만** 응답합니다.

```
# 지식 저장 요청
@지식봇 이 스레드 내용 지식베이스에 저장해줘

# 과거 유사 사례 검색
@지식봇 이 이슈 전에도 발생한 적 있었어?

# 긴 논의 요약
@지식봇 지금까지 나온 논의 내용 핵심만 요약해줘

# 아키텍처 및 기술 검토
@지식봇 이 방식으로 캐시 구조 변경하는 것 기술검토해줘

# 저장된 기록 삭제
@지식봇 이 스레드 기록 지식베이스에서 삭제해줘
```

### 1:1 DM 사용

봇과의 1:1 다이렉트 메시지(DM)에서는 `@멘션` 없이 자유롭게 질문하실 수 있습니다. (단, 개인정보 보호 및 공유 목적을 위해 DM 대화는 지식베이스에 저장되지 않으며 읽기/검색 기능만 지원됩니다.)

---

## 제공 스크립트

프로젝트 관리를 위해 유용한 스크립트들이 `package.json`에 준비되어 있습니다.

| 명령어                | 설명                                        | 비고                             |
| --------------------- | ------------------------------------------- | -------------------------------- |
| `bun run dev`         | 로컬 개발 서버 실행                         | Next.js Dev Server               |
| `bun run build`       | 프로덕션 번들 빌드                          | Next.js Build                    |
| `bun run start`       | 프로덕션 서버 실행                          | Next.js Production               |
| `bun run migrate`     | 데이터베이스 마이그레이션 적용              | `migrations/*.sql` 순차 실행     |
| `bun run check-db`    | DB 확장, 인덱스, 검색 쿼리 정합성 검사      | 비용 발생 없음                   |
| `bun run check-slack` | 슬랙 토큰, 봇 핸들, 서명 검증 수행          | 공개 URL 전달 시 웹훅까지 테스트 |
| `bun run smoke`       | 저장-검색 전체 파이프라인 E2E 검증          | 실제 LLM API 호출 (비용 발생)    |
| `bun run reembed`     | 임베딩 모델/레시피 변경 시 벡터 일괄 재생성 | `--dry-run` 지원                 |
| `bun run test`        | 단위 및 통합 테스트 실행                    | 순수 로직 및 DB 테스트           |
| `bun run typecheck`   | TypeScript 정적 타입 검사                   | `tsc --noEmit`                   |

> 💡 **토큰 및 비용 모니터링 팁**: 실행 명령어 앞에 `LOG_LLM_USAGE=1`을 붙이면 LLM 호출마다 소비된 입력/출력 토큰 수와 예상 비용이 콘솔에 상세히 출력됩니다.
>
> ```bash
> LOG_LLM_USAGE=1 bun run smoke
> ```

---

## 테스트 및 검증

### 1. 자동화 테스트 (`bun run test`)

- 순수 도메인 함수(텍스트 전처리, 프롬프트 구성, 타입 변환 등)에 대한 단위 테스트가 수행됩니다.
- `.env.local`에 `POSTGRES_URL`이 설정되어 있는 경우 실제 데이터베이스 통합 테스트가 함께 진행됩니다. (테스트 데이터는 `test:` 접두사를 사용하여 실제 데이터와 충돌하지 않으며 테스트 종료 후 자동 정리됩니다.)

### 2. E2E 스모크 테스트 (`bun run smoke`)

- 슬랙 연결 없이도 가상 스레드 데이터를 기반으로 **추출 → 저장 → 관련 질문 검색 → 무관한 질문 필터링**의 전체 파이프라인을 실전 테스트합니다.

### 3. 벡터 데이터 재생성 (`bun run reembed`)

- 임베딩 모델을 변경하거나 임베딩 대상 필드 레시피(`EMBEDDING_RECIPE_VERSION`)를 변경한 경우, 기존 데이터의 벡터 좌표계를 일치시키기 위해 실행합니다.

```bash
bun run reembed --dry-run   # 갱신 대상 건수 먼저 확인
bun run reembed             # 실제 벡터 재생성 및 업데이트 진행
```

---

## 운영 비용 안내

메시지 5~8건 규모의 일반적인 한국어 스레드를 기준으로 측정한 실측 비용입니다. (`claude-opus-5`, `text-embedding-3-large` 기준)

| 작업 유형                     | 평균 입력 토큰 | 평균 출력 토큰 | 1회당 비용 (USD)   |
| ----------------------------- | -------------- | -------------- | ------------------ |
| 지식 추출 (저장 및 검색 공통) | 2,400 ~ 2,800  | 180 ~ 310      | 약 $0.017 ~ $0.022 |
| 검색 후보 관련성 판정         | 약 1,700       | 10 ~ 190       | 약 $0.009 ~ $0.013 |

- **명령 1회 기준**: 저장 요청 시 약 **$0.02 (약 30원)**, 검색 요청 시 약 **$0.03 (약 45원)** 내외입니다.
- **예상 월간 비용**:
  - 일 5회 호출 시: 월 약 $4 (약 5,500원)
  - 일 50회 호출 시: 월 약 $38 (약 52,000원)
  - 일 200회 호출 시: 월 약 $150 (약 200,000원)
- **인프라 비용**:
  - Neon DB 무료 티어(0.5GB)로 약 60,000건 이상의 지식 항목(`Knowledge Entry`)을 저장할 수 있어 초기 비용이 거의 들지 않습니다.

---

## 자주 묻는 질문 및 문제 해결 (FAQ)

### Q. Event Subscriptions의 URL 검증(Verify) 시 "응답이 없다"며 실패합니다.

- 슬랙은 검증 실패 시 상세 원인을 알려주지 않습니다. `bun run check-slack <터널주소>/api/webhooks/slack`을 실행하여 원인을 단계별로 확인해 보세요.
- 터널(cloudflared) 프로세스가 켜져 있어도 오랜 시간 방치 시 내부 연결이 끊겼을 수 있습니다. 터널을 재시작해 보세요.
- 만약 `401 Unauthorized`가 발생한다면 `.env.local`의 `SLACK_SIGNING_SECRET`이 현재 앱의 값과 일치하는지 확인하고 개발 서버를 재시작해 주세요.

### Q. 봇을 멘션해도 아무런 대답이 없습니다.

1. 해당 슬랙 채널에 봇이 초대되어 있는지 확인하세요. (`/invite @지식봇`)
2. Event Subscriptions에 `app_mention` 이벤트가 추가되어 있는지 확인하세요.
3. 이벤트를 추가한 후 슬랙 앱을 워크스페이스에 **Reinstall**했는지 확인하세요.
4. `.env.local`의 `BOT_USERNAME`이 봇의 실제 핸들과 일치하는지 `bun run check-slack`으로 점검하세요.

### Q. 저장된 기록이 있는데 검색 시 항상 "관련 기록 없음"으로 나옵니다.

- 최근에 임베딩 모델이나 입력 레시피를 변경하셨다면 기존 벡터와의 호환성이 어긋났을 수 있습니다. `bun run reembed`를 실행하여 벡터를 재생성해 주세요.

### Q. 질문과 무관한 과거 스레드를 관련이 있다고 안내합니다.

- 지식베이스의 데이터가 적은 초기 상태에서는 검색 후보군 상위에 있는 항목이 LLM에 전달됩니다. 판정 기준을 더욱 엄격하게 조정하려면 `src/domain/knowledge/related.ts`의 `JUDGE_PROMPT`를 수정하여 판정 조건을 강화할 수 있습니다.

---

## 프로덕션 배포

### Vercel 배포 시 권장사항

1. GitHub 저장소를 Vercel에 임포트하고 `.env.local`에 설정했던 환경 변수들을 Vercel 대시보드의 **Environment Variables**에 등록합니다.
2. 배포 완료 후 발급된 프로덕션 URL(`https://<프로젝트>.vercel.app/api/webhooks/slack`)을 슬랙 앱 설정의 **Event Subscriptions Request URL**로 변경합니다.
3. **함수 실행 시간(Function Timeout)**: 스레드가 길어질 경우 LLM 추론에 20~40초 이상 소요될 수 있습니다. 안정적인 운영을 위해 Vercel Pro 플랜의 300초 타임아웃 설정을 권장합니다.

---

## 라이선스

이 프로젝트는 [MIT 라이선스](LICENSE)에 따라 자유롭게 수정 및 배포가 가능합니다.
지식베이스 설계 철학 및 도메인 용어 정의에 대한 자세한 내용은 [CONTEXT.md](CONTEXT.md)를 참고해 주시기 바랍니다.
