import { createSlackAdapter } from "@chat-adapter/slack";
import { createPostgresState } from "@chat-adapter/state-pg";
import { Chat, type Message, type Thread } from "chat";
import { createKnowledgeAgent } from "@/lib/agent";
import { stripMentionIds } from "@/lib/slack-thread";

/**
 * 봇은 첫 요청 때 만든다.
 *
 * 어댑터가 생성 시점에 SLACK_SIGNING_SECRET을 검증하기 때문에, 모듈 최상위에서
 * 만들면 빌드 중 라우트를 평가할 때 secret이 없다고 실패한다. 빌드에 운영 secret이
 * 필요한 상태는 CI에서도 로컬에서도 불편하다.
 */
let instance: Chat | undefined;

export function getBot(): Chat {
  if (!instance) {
    instance = new Chat({
      userName: process.env.BOT_USERNAME ?? "slack-knowledge-bot",
      adapters: {
        slack: createSlackAdapter(),
      },
      state: createPostgresState(),
    });

    registerHandlers(instance);
  }

  return instance;
}

/**
 * 핸들러는 얇게 유지한다. 판단은 전부 도메인 층과 에이전트가 하고, 여기서는
 * 스레드를 넘기고 결과를 뿌리는 일만 한다.
 */
async function respond(thread: Thread, message: Message) {
  const requestedBy = message.author.fullName || message.author.userName;

  try {
    // 추출 → 검색 → 판정까지 20초 넘게 걸릴 수 있다. 그동안 사람이 방치된
    // 느낌을 받지 않도록 상태를 먼저 띄운다.
    await thread.startTyping("스레드를 읽는 중...");

    const agent = createKnowledgeAgent({ thread, requestedBy });
    // 봇을 부르는 멘션 자체는 요청 내용이 아니다. 빼고 넘긴다.
    const result = await agent.stream({ prompt: stripMentionIds(message.text) });

    // fullStream을 그대로 넘기면 슬랙 네이티브 스트리밍으로 렌더링된다.
    await thread.post(result.fullStream);
  } catch (error) {
    console.error("[respond] 처리 실패", { threadId: thread.id, error });
    await thread.post("처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

function registerHandlers(chat: Chat) {
  // 채널에서는 부를 때만 답한다.
  //
  // 스레드를 구독해두면 이후 모든 메시지가 에이전트를 한 번씩 돌린다. 30개가 오가는
  // 장애 스레드면 호출 30회에 봇이 30번 끼어드는 셈인데, 대응 중에는 그게 방해다.
  // 비용도 스레드 길이에 비례해 늘어난다. 부를 때만 오는 편이 예측 가능하고, 봇이
  // 채널의 모든 메시지를 받아볼 이유도 없어진다.
  chat.onNewMention(respond);

  // DM은 다르다. 둘만 있는 대화에서 매번 멘션하라는 건 어색하다.
  chat.onDirectMessage(respond);
}
