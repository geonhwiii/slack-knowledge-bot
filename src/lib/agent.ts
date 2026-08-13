import { ToolLoopAgent, tool } from "ai";
import type { Thread } from "chat";
import { z } from "zod";
import { findRelatedKnowledge } from "@/domain/knowledge/related";
import { forgetThread, saveThreadAsKnowledge } from "@/domain/knowledge/save";
import type { KnowledgeEntry } from "@/domain/knowledge/types";
import { reasoningModel } from "@/lib/models";
import { toSourceThread } from "@/lib/slack-thread";

/**
 * 사용자가 자유 문장으로 말하면 에이전트가 알아서 도구를 고른다.
 *
 * 인텐트 분류기를 두지 않은 이유는 확장 때문이다. Jira나 GitHub을 붙일 때
 * 분류기 방식이면 라벨을 늘리고 라우터를 고치고 프롬프트를 다시 맞춰야 하지만,
 * 도구 방식이면 목록에 하나 추가하면 끝난다. "검색해보고 없으면 저장해줘" 같은
 * 복합 요청이 공짜로 처리되는 것도 덤이다.
 */

const INSTRUCTIONS = `너는 슬랙 스레드의 지식을 관리하는 봇이다. 사용자가 지금 있는 스레드에 대해
요청하면 적절한 도구를 써서 처리하고, 결과를 한국어로 간결하게 전한다.

과거 기록을 찾았을 때:
- 도구가 관련 기록을 찾아냈으면 무엇이 어떻게 관련되는지 말하고 링크를 함께 준다.
- 도구가 관련 기록이 없다고 하면 없다고 분명히 말한다. 여기서 얼버무리지 않는다.
  "비슷한 게 있을 수도 있습니다" 같은 표현은 쓰지 않는다. 사람들이 이 봇을 믿는 근거는
  봇이 뭔가 말했을 때 그게 사실이라는 것뿐이다.
- 인접 기록(adjacent)은 관련 있다고 주장하는 것이 아니다. "직접 관련은 없지만 참고할 만한 것"으로
  분명히 구분해서 보여주고, 판단은 사람에게 맡긴다.
- 관련 기록이 없다는 것은 이 논의가 새로운 것이라는 뜻이기도 하다. 정리되면 저장해두겠냐고
  덧붙이면 좋다.

저장했을 때는 이 기록이 워크스페이스 전원의 검색 대상이 된다는 점을 함께 알린다.
저장을 지시한 사람이 공개를 선택한 것이므로, 그 사실을 모르고 지나가지 않게 한다.

도구가 실패하면 실패했다고 말한다. 성공한 척하지 않는다.`;

function describeEntry(entry: KnowledgeEntry) {
  return {
    title: entry.title,
    situation: entry.situation,
    cause: entry.cause,
    resolution: entry.resolution,
    status: entry.status,
    kind: entry.kind,
    channel: entry.channelName,
    recordedAt: entry.createdAt.toISOString().slice(0, 10),
    link: entry.permalink,
  };
}

export interface AgentContext {
  thread: Thread;
  /** 요청한 사람. 저장 기록에 남는다. */
  requestedBy: string;
}

export function createKnowledgeAgent({ thread, requestedBy }: AgentContext) {
  return new ToolLoopAgent({
    model: reasoningModel,
    instructions: INSTRUCTIONS,
    providerOptions: { anthropic: { effort: "high" } },
    tools: {
      find_related_knowledge: tool({
        description:
          "지금 스레드의 논의와 같은 상황을 다룬 과거 기록이 지식베이스에 있는지 찾는다. " +
          "'이거 전에 있었던 이슈야?', '전에 이런 적 있었나?' 같은 질문에 쓴다.",
        inputSchema: z.object({}),
        execute: async () => {
          const source = await toSourceThread(thread);
          const result = await findRelatedKnowledge(source);

          return {
            searchedFor: result.situation,
            verdict: result.related.length > 0 ? "related_found" : "no_related_record",
            related: result.related.map((match) => ({
              ...describeEntry(match.entry),
              why: match.why,
            })),
            adjacent: result.adjacent.map(describeEntry),
          };
        },
      }),

      save_knowledge: tool({
        description:
          "지금 스레드를 지식베이스에 저장한다. 이미 저장된 스레드면 새로 만들지 않고 " +
          "스레드를 다시 읽어 기존 기록을 갱신한다. '이 스레드 저장해줘', '지식으로 남겨줘'에 쓴다.",
        inputSchema: z.object({}),
        execute: async () => {
          // DM에 저장하면 출처 채널이 그 DM이라 아무도 찾을 수 없다. 저장했다고
          // 답해놓고 아무도 못 찾는 상태가 제일 나쁘므로 여기서 막는다.
          if (thread.isDM) {
            return {
              saved: false,
              reason: "DM에서는 저장하지 않습니다. 채널에서 저장해야 다른 사람이 찾을 수 있습니다.",
            };
          }

          const source = await toSourceThread(thread, { withChannelName: true });
          const { entry, created } = await saveThreadAsKnowledge(source, requestedBy);

          return {
            saved: true,
            created,
            visibility: "워크스페이스 전원이 검색할 수 있습니다.",
            entry: describeEntry(entry),
          };
        },
      }),

      delete_knowledge: tool({
        description:
          "지금 스레드의 기록을 지식베이스에서 지운다. 공개돼선 안 될 내용이 저장됐을 때 쓴다.",
        inputSchema: z.object({}),
        execute: async () => {
          const deleted = await forgetThread(thread.id);
          return deleted
            ? { deleted: true, entry: describeEntry(deleted) }
            : { deleted: false, reason: "이 스레드는 지식베이스에 저장된 적이 없습니다." };
        },
      }),
    },
  });
}
