/**
 * 슬랙 없이 파이프라인 전체를 한 번 관통시킨다.
 *
 * 가짜 스레드를 저장한 뒤 두 가지를 묻는다.
 *   1. 관련 있는 질문 → 그 기록을 찾아내는가
 *   2. 완전히 무관한 질문 → 없다고 답하는가   ← 이쪽이 더 중요하다
 *
 * 2번이 이 봇의 신뢰를 결정한다. 벡터 검색은 언제나 무언가를 돌려주므로,
 * "없다"고 말할 수 있는지가 설계가 작동하는지의 판정 기준이다.
 *
 * 실제 API를 호출하므로 비용이 든다. 넣은 데이터는 마지막에 지운다.
 *
 *   bun run smoke
 */
import { db } from "../src/lib/db";
import { findRelatedKnowledge } from "../src/domain/knowledge/related";
import { forgetThread, saveThreadAsKnowledge } from "../src/domain/knowledge/save";
import type { SourceThread } from "../src/domain/knowledge/types";

const at = (minutes: number) => new Date(Date.UTC(2026, 2, 12, 1, minutes));

const paymentIncident: SourceThread = {
  key: "smoke:C_DEV:1",
  channelId: "C_DEV",
  channelName: "#dev-alert",
  messages: [
    { authorName: "지수", text: "결제 왜 이렇게 느리죠? 지금 결제창에서 계속 도네요", postedAt: at(0) },
    { authorName: "민호", text: "저도요 방금 테스트했는데 30초 넘게 걸리다 실패합니다", postedAt: at(2) },
    { authorName: "민호", text: "로그에 ERR_PAYMENT_5031 찍혀요", postedAt: at(3) },
    { authorName: "태현", text: "확인해볼게요", postedAt: at(4) },
    { authorName: "태현", text: "PG사 응답은 정상인데 우리쪽에서 커넥션을 못 잡고 있네요", postedAt: at(20) },
    { authorName: "태현", text: "커넥션 풀 사이즈가 10인데 다 물려있습니다. 어제 배포에서 타임아웃 설정이 빠진듯", postedAt: at(28) },
    { authorName: "태현", text: "풀 30으로 올리고 타임아웃 3초 다시 넣었습니다. 정상화됐어요", postedAt: at(45) },
    { authorName: "지수", text: "확인했습니다 감사합니다 🙏", postedAt: at(47) },
  ],
};

const viewerIncident: SourceThread = {
  key: "smoke:C_DEV:2",
  channelId: "C_DEV",
  channelName: "#dev-alert",
  messages: [
    { authorName: "수빈", text: "뷰어에서 일부 도서 표지가 깨져서 나옵니다", postedAt: at(0) },
    { authorName: "태현", text: "어떤 책인가요? 재현이 되나요?", postedAt: at(5) },
    { authorName: "수빈", text: "특정 책만 그런것 같은데 지금 다시 보니 정상이네요...", postedAt: at(30) },
    { authorName: "태현", text: "CDN 캐시 문제였을 수도 있는데 재현이 안 되면 확인이 어렵네요", postedAt: at(35) },
    { authorName: "수빈", text: "일단 지켜보겠습니다", postedAt: at(40) },
  ],
};

/** 관련 있는 질문 — 위 결제 장애와 같은 상황이다. */
const relatedQuestion: SourceThread = {
  key: "smoke:C_DEV:3",
  channelId: "C_DEV",
  messages: [
    { authorName: "예린", text: "결제가 또 안 되는데요? 한참 돌다가 실패합니다", postedAt: at(0) },
    { authorName: "예린", text: "ERR_PAYMENT_5031 나옵니다", postedAt: at(1) },
  ],
};

/** 무관한 질문 — 지식베이스에 이런 기록은 없다. */
const unrelatedQuestion: SourceThread = {
  key: "smoke:C_DEV:4",
  channelId: "C_DEV",
  messages: [
    { authorName: "예린", text: "회원가입하면 인증 메일이 안 옵니다", postedAt: at(0) },
    { authorName: "예린", text: "스팸함에도 없대요", postedAt: at(1) },
  ],
};

async function ask(label: string, thread: SourceThread) {
  console.log(`\n=== ${label} ===`);
  const result = await findRelatedKnowledge(thread);
  console.log(`검색 기준: ${result.situation}`);
  console.log(`판정: ${result.related.length > 0 ? "관련 기록 있음" : "관련 기록 없음"}`);
  for (const match of result.related) {
    console.log(`  · ${match.entry.title} — ${match.why}`);
  }
  if (result.adjacent.length > 0) {
    console.log(`  (참고) ${result.adjacent.map((entry) => entry.title).join(", ")}`);
  }
}

async function main() {
  for (const thread of [paymentIncident, viewerIncident]) {
    const { entry, created } = await saveThreadAsKnowledge(thread, "smoke");
    console.log(`저장${created ? "" : "(갱신)"}: ${entry.title}`);
    console.log(`  kind=${entry.kind} status=${entry.status}`);
    console.log(`  situation: ${entry.situation}`);
    console.log(`  cause: ${entry.cause ?? "(없음)"}`);
    console.log(`  resolution: ${entry.resolution ?? "(없음)"}`);
    console.log(`  systems: ${entry.systems.join(", ")}`);
  }

  await ask("관련 있는 질문", relatedQuestion);
  await ask("무관한 질문 (여기서 '없음'이 나와야 한다)", unrelatedQuestion);

  for (const thread of [paymentIncident, viewerIncident]) {
    await forgetThread(thread.key);
  }
  console.log("\n합성 데이터 삭제 완료.");

  await db().end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
