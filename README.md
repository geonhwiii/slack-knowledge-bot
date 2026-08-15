# slack-knowledge-bot

슬랙 스레드에서 오간 논의를 검색 가능한 지식으로 쌓고, 쌓인 지식으로 답하는 봇.

```
@봇 이 스레드 요약해줘
@봇 이 이슈 전에도 있었어?      지식베이스를 뒤져 원문 링크와 함께 답한다
@봇 이 스레드 지식 저장해줘
@봇 이거 기술검토해줘           사내 선례를 근거로 확인할 지점을 짚는다
@봇 이 기록 삭제해줘
```

채널에서는 부를 때만 답한다. DM에서는 멘션 없이 그냥 말하면 된다.

설계 결정과 용어 정의는 [CONTEXT.md](CONTEXT.md)에 있다.

## 동작

슬랙이 웹훅을 보내면 `/api/webhooks/slack`이 즉시 200을 돌려주고, 실제 처리는 백그라운드에서 이어진다(슬랙은 3초 안에 응답을 요구한다). 에이전트가 요청을 읽고 도구를 고른다: `read_thread`, `find_related_knowledge`, `save_knowledge`, `delete_knowledge`.

검색은 벡터와 키워드를 함께 돌린다. 벡터는 "결제 안 됨"과 "구매 실패"를 같은 말로 보지만 `ERR_PAYMENT_5031` 같은 코드에 약하고, 트라이그램 키워드 검색은 반대다. 두 결과를 RRF로 합쳐 후보 5개를 추린 다음, LLM이 후보를 읽고 관련 여부를 판정한다.

두 검색은 서로 다른 텍스트를 본다. 벡터는 제목·상황·시스템만 보고, 키워드는 시스템 이름과 태그만 본다. 같은 텍스트를 주면 두 팔이 같은 것을 보게 되어 합칠 이유가 없어진다. 벡터에서 해결책을 빼는 게 특히 중요한데, 질문하는 쪽 스레드는 아직 진행 중이라 해결책이 없는 게 정상이기 때문이다. 저장된 쪽에만 그게 길게 들어가면, 해결책이 잘 적힌 좋은 기록일수록 상황 신호가 묽어진다.

판정 단계를 따로 둔 이유는 벡터 검색이 언제나 무언가를 돌려주기 때문이다. 거리 하한이 없고 상위 몇 개를 가져올 뿐이라, 결제 기록만 있는 지식베이스에 "회원가입 메일이 안 온다"를 물어도 제일 덜 무관한 결제 스레드가 1등으로 나온다. 그대로 답하면 봇이 무관한 링크를 자신 있게 내민다. 후보를 뽑는 일과 관련 있다고 말하는 일은 다른 일이다.

저장할 때는 추출 결과와 함께 스레드 원문도 남긴다. 추출 프롬프트와 모델은 앞으로도 바뀌는데, 원문이 없으면 이미 쌓인 기록은 그때 품질로 굳는다. 슬랙에 다시 가서 읽으면 될 것 같지만 그 길은 잘 끊긴다 — 무료 플랜은 90일이 지나면 안 보여주고, 채널은 아카이브되고, 사람은 자기 메시지를 지운다.

## 준비물

Bun, 그리고 계정 네 개. 모두 무료로 시작할 수 있다.

- [Neon](https://neon.com) — Postgres
- [Anthropic](https://console.anthropic.com) — 추출·판정·응답
- [OpenAI](https://platform.openai.com) — 임베딩
- [Slack](https://api.slack.com/apps) — 봇 앱

## 세팅

### 1. 설치

```bash
git clone <저장소>
cd slack-knowledge-bot
bun install
```

### 2. Postgres

Neon에서 프로젝트를 만들고 Pooled connection 문자열(호스트에 `-pooler`가 붙은 쪽)을 복사한다. 서버리스는 요청마다 연결이 생겼다 사라지므로 풀러를 거치는 편이 낫다.

Neon이 아니어도 된다. `pgvector`와 `pg_trgm`을 켤 수 있는 Postgres면 무엇이든 동작한다. 로컬이면 `pgvector/pgvector:pg17` 도커 이미지에 둘 다 들어 있다.

### 3. 환경변수

```bash
cp .env.example .env.local
```

지금은 세 개만 채운다. 슬랙 값은 5단계에서 받는다.

```
POSTGRES_URL=postgresql://...?sslmode=verify-full
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

`sslmode=require`로 두면 `pg` 드라이버가 경고를 낸다. 다음 메이저 버전에서 이 값의 의미가 약해지므로 `verify-full`로 명시해두는 게 좋다.

### 4. 스키마

```bash
bun run migrate
bun run check-db
```

`check-db`는 확장과 인덱스를 확인하고 합성 데이터로 검색 쿼리를 한 번 돌려본 뒤 지운다. API 비용은 들지 않는다.

```
확장: pg_trgm 1.6, vector 0.8.6
인덱스: knowledge_entry_embedding_idx, knowledge_entry_search_text_idx, ...
후보 3건:
  0.0328  결제 API 타임아웃
```

### 5. 슬랙 앱

[api.slack.com/apps](https://api.slack.com/apps)에서 Create New App → From a manifest를 고르고 아래를 붙여넣는다.

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

이벤트 구독은 일부러 넣지 않았다. 슬랙은 Request URL을 등록할 때 그 주소로 검증 요청을 보내는데 그 요청에도 서명이 붙어 있어서, Signing Secret 없이는 통과할 수 없다. 앱을 먼저 만들어 시크릿을 받고 URL은 나중에 등록해야 순환에 빠지지 않는다.

Install to Workspace를 누른 뒤 두 값을 `.env.local`에 넣는다.

- `SLACK_BOT_TOKEN` — OAuth & Permissions의 Bot User OAuth Token (`xoxb-`로 시작)
- `SLACK_SIGNING_SECRET` — Basic Information의 Signing Secret

### 6. 서버

```bash
bun run dev
curl -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/webhooks/slack
```

401이 나오면 정상이다. 서명 없는 요청을 거부하고 있다는 뜻이다. 500이면 시크릿이 로드되지 않은 것이니 서버를 재시작한다.

### 7. 터널

슬랙은 인터넷에서 우리 서버에 접속해야 하는데 `localhost`는 외부에서 닿지 않는다. 개발 중에는 터널로 임시 주소를 만든다.

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

출력되는 `https://....trycloudflare.com` 주소를 쓴다. 재시작하면 주소가 바뀐다.

### 8. 이벤트 구독

앱 설정의 Event Subscriptions를 켜고 Request URL에 `https://<터널주소>/api/webhooks/slack`을 넣는다. Verified가 뜨면 Subscribe to bot events에 두 개를 추가한다.

- `app_mention` — 봇을 부르는 순간
- `message.im` — DM

채널 메시지 이벤트(`message.channels`, `message.groups`)는 구독하지 않는다. 봇은 자기를 부른 메시지만 받고, 스레드 원문은 불렸을 때 그 자리에서 읽어온다.

저장 후 재설치 배너가 뜨면 Reinstall을 누른다.

### 9. 테스트

```
/invite @지식봇
```

스레드에 대화를 몇 줄 남기고 요약과 저장을 시켜본다. 다른 스레드에 비슷한 증상을 적고 `관련 이슈 있었어?`를 물으면 저장한 기록을 찾아온다.

마지막으로 지식베이스에 없는 주제를 물어본다. "관련 기록 없어요"라고 답해야 한다. 억지로 무언가를 물어오면 [related.ts](src/domain/knowledge/related.ts)의 판정 프롬프트를 조인다.

## 배포

터널은 개발용이다. Vercel에 저장소를 임포트하고 `.env.local`의 값을 Environment Variables에 넣은 다음, Event Subscriptions의 Request URL을 `https://<프로젝트>.vercel.app/api/webhooks/slack`으로 바꾸면 된다.

Hobby 플랜의 함수 최대 실행 시간은 60초다. 이 봇은 20~40초를 쓰므로 들어가긴 하지만 여유가 크지 않다. 긴 스레드에서 타임아웃이 나면 Pro(300초)를 봐야 한다.

## 비용

`LOG_LLM_USAGE=1 bun run smoke`로 측정한 값이다. 메시지 5~8개짜리 한국어 스레드 기준.

| 호출 | 입력 | 출력 | 비용 |
|---|---|---|---|
| 추출 (저장과 검색이 공유) | 2,400~2,800 | 180~310 | $0.017~0.022 |
| 관련성 판정 | ~1,700 | 9~190 | $0.009~0.013 |

명령 단위로는 저장이 회당 약 $0.02(30원), 검색이 약 $0.03(45원)이다. 요약과 기술검토는 에이전트 호출이라 따로 재지 않았고, 입력 크기로 보면 $0.02~0.05 사이일 것이다.

입력 토큰은 스레드 길이에 비례한다. 메시지 50개짜리 스레드면 입력이 5~10배가 되므로 위 값은 하한이다. 한국어는 같은 내용이라도 영어보다 토큰을 더 먹는다.

하루 5회 쓰면 월 $4, 50회면 월 $38, 200회면 월 $150 정도다.

단가는 `claude-opus-5`가 입력 $5 / 출력 $25(1M 토큰당), `text-embedding-3-large`가 $0.13이다. 임베딩 쪽은 사실상 공짜다. Entry 1,000건에 검색 5,000회를 합쳐도 $0.26이다.

인프라는 Neon 무료 티어가 0.5GB인데 Entry 하나가 8KB 남짓(1536차원 벡터 6KB + 텍스트)이라 6만 건까지 들어간다. Vercel은 Hobby가 무료지만 상업적 사용이 금지돼 있어서, 회사에서 쓰려면 Pro가 필요하다(사용자당 월 $20, 연간 기준).

비용을 줄이려면 `effort`부터 손대게 되는데, 저장 경로는 건드리지 않는 편이 낫다. 추출이 나쁘면 그 기록은 계속 나쁜 채로 검색된다. 요약처럼 판단이 덜 필요한 경로를 먼저 낮추거나 모델을 `claude-sonnet-5`($3/$15)로 바꾸는 쪽이 낫다.

## 스크립트

| 명령 | |
|---|---|
| `bun run dev` | 개발 서버 |
| `bun run build` | 프로덕션 빌드 |
| `bun run migrate` | 마이그레이션 적용 |
| `bun run check-db` | 확장·인덱스·검색 쿼리 확인 |
| `bun run reembed` | 낡은 벡터 재생성 (`--dry-run`으로 대상만 확인) |
| `bun run test` | 테스트 |
| `bun run smoke` | 저장부터 검색까지 실제 API로 관통 (비용 발생) |
| `bun run typecheck` | 타입 검사 |

`LOG_LLM_USAGE=1`을 붙이면 LLM 호출마다 토큰과 비용이 찍힌다.

## 테스트

```bash
bun run test
```

순수 함수 테스트는 그냥 돌고, DB 테스트는 `.env.local`의 `POSTGRES_URL`이 있어야 돈다. 없으면 건너뛰면서 그 사실을 알린다. LLM은 부르지 않으므로 비용은 들지 않는다.

DB 테스트는 개발용 데이터베이스에 직접 붙는다. 만드는 행은 전부 `test:`로 시작하는 키를 갖고, 정리도 그 접두사로만 지운다. 실제 Entry의 키는 `slack:C123:...` 형태라 겹치지 않는다.

임베딩은 실제로 만들지 않고 지어낸다. 확인하려는 건 임베딩 품질이 아니라 SQL이 거리와 순위를 제대로 다루는가라서, 거리를 직접 정하는 편이 정확하고 공짜다.

## 벡터 재생성

임베딩 모델을 바꾸거나, 무엇을 임베딩할지를 바꾸면 기존 벡터와 좌표계가 어긋난다. 그런 행은 재생성 전까지 벡터 검색에서 빠진다(키워드로는 계속 찾힌다).

```bash
bun run reembed --dry-run   # 대상 확인
bun run reembed
```

`src/lib/models.ts`의 `EMBEDDING_RECIPE_VERSION`을 올렸다면 반드시 함께 돌려야 한다. 올리기만 하면 기존 기록이 조용히 의미 검색에서 사라진다.

## 구조

```
src/domain/knowledge/     슬랙도 프레임워크도 모르는 층
  types.ts       SourceThread, EntryDraft, KnowledgeEntry, 검색 텍스트 조립
  transcript.ts  스레드를 LLM이 읽을 형태로 펼치기 (길이 제한 포함)
  extract.ts     스레드에서 기록 뽑아내기
  embed.ts       1536차원 임베딩
  repository.ts  SQL
  save.ts        저장과 삭제
  search.ts      벡터 + 트라이그램 후보 수집
  related.ts     관련성 판정

src/lib/                  슬랙과 만나는 층
  slack-thread.ts  Chat SDK Thread를 SourceThread로, permalink 조회
  agent.ts         도구를 쥔 에이전트
  bot.ts           핸들러
  db.ts, models.ts

migrations/    스키마
scripts/       마이그레이션, 점검, 재임베딩, 스모크 테스트
test/          DB 통합 테스트와 공용 도구 (단위 테스트는 소스 옆에 있다)
```

도메인 로직을 슬랙과 프레임워크 밖에 둔 건 런타임을 옮길 때 껍데기만 다시 쓰기 위해서다. 슬랙 없이 테스트할 수 있는 것도 여기서 나온다. `bun run smoke`가 그 방식으로 돈다.

[Chat SDK](https://chat-sdk.dev) 위에 올려서 Teams나 Discord로 넓힐 때는 어댑터만 추가하면 된다.

## License

MIT
