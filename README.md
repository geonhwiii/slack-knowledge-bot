# slack-knowledge-bot

슬랙 스레드에서 오간 논의를 검색 가능한 지식으로 축적하고, 축적된 지식을 근거로 질문에 답하는 봇.

- `@봇 이 스레드 요약해줘` — 스레드를 읽고 요약
- `@봇 이 이슈 원래 있던 거야?` — 지식베이스에서 비슷한 과거 기록을 찾아 근거와 함께 답변
- `@봇 이 스레드 지식 저장해줘` — 스레드를 구조화된 기록으로 저장
- `@봇 이거 기술검토해줘` — 사내 선례를 근거로 확인이 필요한 지점을 제시

용어와 설계 결정은 [CONTEXT.md](CONTEXT.md)에 정리되어 있습니다.

## Getting Started

1. 환경변수 파일을 만들고 값을 채웁니다.

```bash
cp .env.example .env.local
```

2. Postgres에 pgvector 확장을 켭니다.

```bash
psql "$POSTGRES_URL" -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

3. 개발 서버를 띄웁니다.

```bash
bun run dev
```

4. 로컬 서버를 외부에 노출하고 Slack 앱의 Event Subscriptions URL로 등록합니다.

## Endpoints

- Slack: `/api/webhooks/slack`

## Project Structure

```
src/
  lib/bot.ts                              봇 설정과 핸들러 (슬랙에 의존하는 얇은 층)
  app/api/webhooks/[platform]/route.ts    웹훅 엔드포인트
CONTEXT.md                                용어집과 설계 결정
.env.example                              필요한 환경변수
```

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | 개발 서버 실행 |
| `bun run build` | 프로덕션 빌드 |
| `bun run start` | 프로덕션 서버 실행 |
| `bun run typecheck` | 타입 검사 |

## License

MIT

## Learn More

- [Chat SDK Documentation](https://chat-sdk.dev/docs)
- [Adapter Setup Guides](https://chat-sdk.dev/adapters)
