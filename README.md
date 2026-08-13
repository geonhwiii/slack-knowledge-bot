# slack-knowledge-bot

슬랙 스레드에서 오간 논의를 검색 가능한 지식으로 쌓고, 쌓인 지식을 근거로 답하는 봇.

```
@봇 이 스레드 요약해줘          → 스레드를 읽고 요약
@봇 이 이슈 전에도 있었어?      → 지식베이스에서 같은 상황을 찾아 원문 링크와 함께 답변
@봇 이 스레드 지식 저장해줘     → 스레드를 구조화된 기록으로 저장
@봇 이거 기술검토해줘           → 사내 선례를 근거로 확인이 필요한 지점을 제시
@봇 이 기록 삭제해줘            → 지식베이스에서 제거
```

한 번 부르면 그 스레드를 계속 듣기 때문에, 이후에는 멘션 없이 말을 걸어도 됩니다.

설계 배경과 용어 정의는 [CONTEXT.md](CONTEXT.md)에 있습니다.

---

## 어떻게 동작하나

```
슬랙에서 @봇 멘션
      │
      ▼  슬랙이 우리 서버로 웹훅 전송 (3초 안에 응답해야 함)
/api/webhooks/slack  ──► 즉시 200 응답, 실제 처리는 백그라운드로
      │
      ▼
에이전트(claude-opus-5)가 도구를 고른다
      │
      ├─ read_thread            스레드 원문 읽기
      ├─ find_related_knowledge 과거 기록 검색
      ├─ save_knowledge         지식으로 저장
      └─ delete_knowledge       기록 삭제
      │
      ▼
답변을 스트리밍으로 슬랙에 출력
```

**검색은 두 갈래를 함께 돌립니다.** 벡터 검색은 "결제 안 됨"과 "구매 실패"가 같은 말인 걸 잡지만 `ERR_PAYMENT_5031` 같은 코드에는 약하고, 트라이그램 키워드 검색은 그 반대입니다. 두 결과를 RRF로 합쳐 후보를 추린 뒤, **LLM이 후보를 실제로 읽고 관련 여부를 판정**합니다.

이 판정 단계가 핵심입니다. 벡터 검색은 구조상 언제나 무언가를 돌려주기 때문에, 그대로 답하면 봇이 무관한 스레드를 자신 있게 링크합니다. 그래서 후보를 뽑는 일과 "관련 있다"고 말하는 일을 분리했고, 판정 프롬프트는 **관련된 게 없으면 없다고 답하도록** 명시합니다.

---

## 사전 준비

계정 네 개가 필요합니다. 전부 무료로 시작할 수 있습니다.

| 서비스 | 용도 | 비용 |
|---|---|---|
| [Neon](https://neon.com) | Postgres (지식베이스 + 봇 상태) | 무료 티어 |
| [Anthropic](https://console.anthropic.com) | 추출·판정·응답 | 종량제 |
| [OpenAI](https://platform.openai.com) | 임베딩 | 종량제 |
| [Slack](https://api.slack.com/apps) | 봇 앱 | 무료 |

로컬에는 [Bun](https://bun.sh)이 필요합니다.

---

## 세팅

### 1. 설치

```bash
git clone <이 저장소>
cd slack-knowledge-bot
bun install
```

### 2. Postgres 준비 (Neon)

[neon.com](https://neon.com)에서 프로젝트를 만듭니다. 리전은 사용자와 가까운 곳(한국이면 Singapore 또는 Tokyo)을 고르십시오.

대시보드에서 **Pooled connection** 문자열을 복사합니다(호스트에 `-pooler`가 붙어 있습니다). 서버리스 환경은 요청마다 연결이 생겼다 사라지므로 풀러를 거치는 편이 맞습니다.

> Neon이 아니어도 됩니다. `pgvector`와 `pg_trgm` 확장을 켤 수 있는 Postgres면 무엇이든 동작합니다 (Supabase, RDS, 로컬 Docker의 `pgvector/pgvector:pg17` 이미지 등).

### 3. 환경변수 파일 만들기

```bash
cp .env.example .env.local
```

지금은 세 개만 채웁니다. 슬랙 값은 5단계에서 받습니다.

```bash
POSTGRES_URL=postgresql://...?sslmode=verify-full
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

> `sslmode=require`로 두면 `pg` 드라이버가 경고를 냅니다. 다음 메이저 버전부터 이 값의 의미가 약해지기 때문에, 지금 `verify-full`로 명시해두는 편이 안전합니다.

### 4. 스키마 만들기

```bash
bun run migrate    # 테이블 + 확장 + 인덱스 생성
bun run check-db   # 제대로 만들어졌는지 확인
```

`check-db`는 확장과 인덱스를 확인하고, 합성 데이터를 잠깐 넣어 검색 쿼리를 끝까지 돌려본 뒤 지웁니다. 이런 출력이 나오면 정상입니다.

```
확장: pg_trgm 1.6, vector 0.8.6
인덱스: knowledge_entry_embedding_idx, knowledge_entry_search_text_idx, ...
후보 3건:
  0.0328  결제 API 타임아웃
```

### 5. 슬랙 앱 만들기

[api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest** → 워크스페이스 선택 후 아래 YAML을 붙여넣습니다.

```yaml
display_information:
  name: 지식봇
  description: 슬랙 스레드의 지식을 저장하고 찾아주는 봇
features:
  bot_user:
    display_name: 지식봇
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

> **이벤트 구독은 일부러 빼놨습니다.** 슬랙은 Request URL을 등록할 때 그 주소로 검증 요청을 보내는데, 그 요청에도 서명이 붙어 있어 **Signing Secret 없이는 통과할 수 없습니다.** 앱을 먼저 만들어 시크릿을 받고, 그 다음에 URL을 등록해야 순환에 빠지지 않습니다.

**Install to Workspace**를 눌러 설치합니다.

| 값 | 위치 |
|---|---|
| `SLACK_BOT_TOKEN` (`xoxb-`로 시작) | OAuth & Permissions → Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | Basic Information → App Credentials → Signing Secret |

`.env.local`에 두 값을 넣습니다.

### 6. 서버 실행

```bash
bun run dev
```

확인:

```bash
curl -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/webhooks/slack
```

**401**이 나와야 정상입니다. 서명 없는 요청을 제대로 거부한다는 뜻입니다. 500이 나오면 시크릿이 로드되지 않은 것이니 서버를 재시작하십시오.

### 7. 로컬을 인터넷에 노출

슬랙은 인터넷에서 우리 서버로 접속해야 하는데 `localhost`는 외부에서 닿지 않습니다. 개발 중에는 터널로 임시 공개 주소를 만듭니다.

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

출력되는 `https://....trycloudflare.com` 주소를 복사합니다. **재시작할 때마다 주소가 바뀝니다.**

### 8. 이벤트 구독 등록

앱 설정 → **Event Subscriptions** → Enable Events **On**

Request URL에 입력:

```
https://<터널주소>/api/webhooks/slack
```

**Verified ✓** 가 뜨면 **Subscribe to bot events**에 네 개를 추가합니다.

| 이벤트 | 필요한 이유 |
|---|---|
| `app_mention` | 봇을 부르는 순간을 받는다 |
| `message.channels` | 공개 채널에서 멘션 없이 이어 말하기 |
| `message.groups` | 비공개 채널에서 같은 동작 |
| `message.im` | DM |

**Save Changes** 후 재설치 배너가 뜨면 **Reinstall**.

### 9. 채널에 초대하고 테스트

```
/invite @지식봇
```

스레드에 대화를 몇 줄 남긴 뒤:

```
@지식봇 이 스레드 요약해줘
@지식봇 이 스레드 지식 저장해줘
```

다른 스레드에서 비슷한 증상을 적고 `@지식봇 관련 이슈 있었어?` 를 물어보면 저장된 기록을 찾아옵니다.

**마지막으로 무관한 질문을 던져보십시오.** 지식베이스에 없는 주제를 물었을 때 **"관련 기록 없어요"** 라고 답해야 합니다. 억지로 뭔가를 물어온다면 판정이 느슨한 것이니 [related.ts](src/domain/knowledge/related.ts)의 프롬프트를 조여야 합니다.

---

## 배포 (Vercel)

터널은 개발용입니다. 배포하면 주소가 고정되고 노트북을 꺼도 봇이 삽니다.

1. Vercel에 저장소를 임포트합니다.
2. `.env.local`의 값을 **Environment Variables**에 그대로 넣습니다.
3. 배포 후 Event Subscriptions의 Request URL을 `https://<프로젝트>.vercel.app/api/webhooks/slack`으로 바꿉니다.

> **Hobby 플랜의 함수 최대 실행 시간은 60초입니다.** 이 봇의 파이프라인은 20~40초가 걸리므로 들어가긴 하지만 여유가 크지 않습니다. 긴 스레드에서 타임아웃이 나면 Pro(최대 300초)를 검토하십시오.

---

## 비용

### 실측값

아래는 `bun run smoke`를 `LOG_LLM_USAGE=1`로 돌려 **실제로 측정한 값**입니다. 메시지 5~8개짜리 한국어 스레드 기준입니다.

| 동작 | 입력 토큰 | 출력 토큰 | 비용 |
|---|---|---|---|
| 추출 (저장·검색이 공유) | 2,400 ~ 2,800 | 180 ~ 310 | **$0.017 ~ 0.022** |
| 관련성 판정 | ~1,700 | 9 ~ 190 | **$0.009 ~ 0.013** |

명령별로 환산하면:

| 명령 | 호출 구성 | 회당 비용 |
|---|---|---|
| 지식 저장 | 추출 1회 + 임베딩 | **약 $0.02** (약 30원) |
| 관련 이슈 검색 | 추출 1회 + 판정 1회 | **약 $0.03** (약 45원) |
| 요약 / 기술검토 | 에이전트 1~2스텝 | **약 $0.02 ~ 0.05** (미측정, 입력 크기 기준 추정) |

**입력 토큰은 스레드 길이에 비례합니다.** 메시지 50개짜리 긴 스레드면 입력이 5~10배가 되므로, 위 값은 하한으로 보시는 게 맞습니다. 한국어는 같은 내용이라도 영어보다 토큰이 더 나옵니다.

### 사용량별 월 비용

| 시나리오 | 하루 호출 | 월 LLM 비용 |
|---|---|---|
| 개인 실험 | 5회 | **약 $4** |
| 소규모 팀 | 50회 | **약 $38** |
| 전사 활용 | 200회 | **약 $150** |

### 단가

| 항목 | 단가 | 비고 |
|---|---|---|
| `claude-opus-5` 입력 | $5 / 1M 토큰 | 추출·판정·응답 |
| `claude-opus-5` 출력 | $25 / 1M 토큰 | |
| `text-embedding-3-large` | $0.13 / 1M 토큰 | 1536차원으로 축소 사용 |

**임베딩 비용은 사실상 0입니다.** Entry 1,000건 저장 + 검색 5,000회를 합쳐도 2M 토큰 미만이라 **$0.26** 수준입니다.

### 인프라

| 항목 | 무료 범위 | 넘어가면 |
|---|---|---|
| **Neon (Postgres)** | 0.5GB 저장 + 월 100 CU-hours | Entry 하나가 약 8KB(1536차원 벡터 6KB + 텍스트)라 **약 6만 건**까지 무료 티어에 들어갑니다 |
| **Vercel** | Hobby 무료 | **Hobby는 상업적 사용이 금지됩니다.** 회사에서 쓰려면 Pro($20/사용자/월, 연간 기준)가 필요합니다 |

즉 **개인이 실험하는 동안은 LLM 비용만 나갑니다.** 회사에 도입하면 Vercel Pro가 더해집니다.

### 비용을 줄이려면

첫 번째 손잡이는 `effort`입니다. [extract.ts](src/domain/knowledge/extract.ts)와 [related.ts](src/domain/knowledge/related.ts)에 `effort: "high"`로 되어 있습니다. 다만 **추출 품질이 나쁘면 그 기록은 영원히 나쁜 채로 검색되므로**, 저장 경로부터 내리는 건 권하지 않습니다. 요약처럼 판단이 덜 필요한 경로를 먼저 낮추거나, 모델을 `claude-sonnet-5`($3/$15)로 바꾸는 편이 낫습니다.

---

## 스크립트

| 명령 | 설명 |
|---|---|
| `bun run dev` | 개발 서버 |
| `bun run build` | 프로덕션 빌드 |
| `bun run migrate` | 마이그레이션 적용 |
| `bun run check-db` | 확장·인덱스·검색 쿼리 확인 (API 비용 없음) |
| `bun run smoke` | 저장→검색까지 실제 API로 관통 테스트 (**비용 발생**) |
| `bun run typecheck` | 타입 검사 |

`LOG_LLM_USAGE=1`을 붙이면 LLM 호출마다 토큰 사용량과 비용이 찍힙니다.

---

## 프로젝트 구조

```
src/domain/knowledge/     슬랙도 프레임워크도 모르는 층
  types.ts       도메인 타입 (SourceThread, EntryDraft, KnowledgeEntry)
  transcript.ts  스레드를 LLM이 읽을 형태로 펼치기
  extract.ts     스레드 → EntryDraft (저장과 검색이 공유)
  embed.ts       1536차원 임베딩
  repository.ts  SQL
  save.ts        저장 / 삭제
  search.ts      하이브리드 후보 수집 (벡터 + 트라이그램, RRF 병합)
  related.ts     LLM 판정

src/lib/                  슬랙과 만나는 얇은 층
  slack-thread.ts  Chat SDK Thread → SourceThread, permalink 조회
  agent.ts         도구를 쥔 에이전트
  bot.ts           핸들러
  db.ts, models.ts

migrations/    스키마
scripts/       마이그레이션·점검·스모크 테스트
```

도메인 로직이 슬랙과 프레임워크 바깥에 있는 이유는 **런타임을 갈아탈 때 껍데기만 다시 쓰기 위해서**입니다. 덤으로 슬랙 없이 테스트할 수 있습니다 — `bun run smoke`가 그 방식으로 돕니다.

---

## 만들어진 배경

[Chat SDK](https://chat-sdk.dev) 위에 올려서, 나중에 Teams나 Discord로 확장할 때 어댑터만 추가하면 되도록 했습니다.

설계 과정에서 내린 결정들 — 왜 스레드 하나에 기록 하나인지, 왜 미해결도 저장하는지, 왜 검색이 정밀도 우선인지, 왜 기술검토가 판정하지 않고 질문하는지 — 은 전부 [CONTEXT.md](CONTEXT.md)에 이유와 함께 적혀 있습니다.

## License

MIT
