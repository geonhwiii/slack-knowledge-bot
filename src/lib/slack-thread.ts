import type { Thread } from "chat";
import type { SourceMessage, SourceThread } from "@/domain/knowledge/types";

/**
 * Chat SDK의 Thread를 도메인이 이해하는 SourceThread로 옮긴다.
 *
 * 슬랙에 대한 지식은 이 파일까지만 온다. 도메인 층은 permalink가 어떻게 생겼는지,
 * 봇 자신의 메시지를 어떻게 걸러내는지 알 필요가 없다.
 */

/** `slack:C123:1712345678.123456` → 채널 ID와 스레드 타임스탬프. */
function parseThreadKey(threadKey: string): { channelId: string; ts: string } | null {
  const [adapter, channelId, ts] = threadKey.split(":");
  if (adapter !== "slack" || !channelId || !ts) return null;
  return { channelId, ts };
}

/**
 * 슬랙 원문으로 돌아가는 링크. 봇이 "3월에 비슷한 게 있었습니다"라고 말할 때
 * 근거를 함께 주기 위한 것이라, 이게 없으면 답변의 신뢰가 떨어진다.
 *
 * 워크스페이스 도메인은 SDK가 알려주지 않으므로 환경변수로 받는다.
 */
export function buildSlackPermalink(threadKey: string): string | undefined {
  const base = process.env.SLACK_WORKSPACE_URL?.replace(/\/+$/, "");
  if (!base) return undefined;

  const parsed = parseThreadKey(threadKey);
  if (!parsed) return undefined;

  return `${base}/archives/${parsed.channelId}/p${parsed.ts.replace(".", "")}`;
}

/**
 * 슬랙이 보내는 멘션은 서식을 벗겨도 `@U0BPXE20EA2` 같은 사용자 ID로 남는다.
 * 그대로 두면 봇을 부르는 말이 프롬프트에 잡음으로 섞이고, 저장된 지식의 검색
 * 텍스트에도 의미 없는 ID가 들어간다. 누가 말했는지는 authorName이 이미 담고 있으므로
 * 여기서는 지운다.
 */
export function stripMentionIds(text: string): string {
  return text
    .replace(/<?@[UW][A-Z0-9]{2,}>?/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export interface ToSourceThreadOptions {
  /**
   * 채널 이름까지 가져올지. 슬랙 API 호출이 한 번 더 들기 때문에, 저장처럼
   * 오래 남을 기록을 만들 때만 켠다.
   */
  withChannelName?: boolean;
}

export async function toSourceThread(
  thread: Thread,
  options: ToSourceThreadOptions = {},
): Promise<SourceThread> {
  const messages: SourceMessage[] = [];

  // allMessages는 오래된 것부터 돌며 자동으로 페이지를 넘긴다.
  for await (const message of thread.allMessages) {
    // 봇 자신의 발언과 플랫폼이 만든 알림은 지식이 아니다.
    if (message.author.isMe || message.author.isSystem) continue;

    const text = stripMentionIds(message.text);
    if (!text) continue;

    messages.push({
      authorName: message.author.fullName || message.author.userName,
      text,
      postedAt: message.metadata.dateSent,
    });
  }

  let channelName: string | undefined;
  if (options.withChannelName) {
    try {
      await thread.channel.fetchMetadata();
      channelName = thread.channel.name ?? undefined;
    } catch {
      // 이름은 있으면 좋은 정보일 뿐이다. 못 가져왔다고 저장을 막지 않는다.
    }
  }

  return {
    key: thread.id,
    channelId: thread.channelId,
    channelName,
    permalink: buildSlackPermalink(thread.id),
    messages,
  };
}
