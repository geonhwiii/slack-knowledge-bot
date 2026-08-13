import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { reasoningModel } from "@/lib/models";
import type { EntryDraft, SourceThread } from "./types";

/**
 * 스레드에서 Knowledge Entry의 내용을 뽑아낸다.
 *
 * 저장할 때도, "이거 전에 있었어?"를 물을 때도 같은 추출기를 쓴다. 검색은 결국
 * 지금 스레드에서 뽑은 situation과 과거 Entry들의 situation을 비교하는 일이라,
 * 양쪽이 같은 방식으로 만들어져야 비교가 성립한다.
 */

const draftSchema = z.object({
  kind: z
    .enum(["issue", "decision", "howto"])
    .describe(
      "issue: 무언가 잘못됐고 그에 대한 논의. decision: 무언가를 이렇게 하기로 정함. howto: 원래 이렇게 하는 것이라는 운영 지식. 섞여 있으면 스레드의 무게중심을 따른다.",
    ),
  status: z
    .enum(["resolved", "unresolved"])
    .describe(
      "스레드가 결론에 도달했으면 resolved. 원인을 못 찾았거나 흐지부지됐으면 unresolved.",
    ),
  title: z.string().describe("한 줄 제목. 검색 결과 목록에 그대로 노출된다."),
  situation: z
    .string()
    .describe(
      "무엇이 문제였는가 / 무엇을 정하려 했는가. 나중에 같은 상황을 만난 사람이 검색창에 칠 법한 말로 쓴다. 해결책은 여기 넣지 않는다.",
    ),
  cause: z
    .string()
    .nullable()
    .describe("밝혀진 원인. 스레드에서 규명되지 않았으면 null."),
  resolution: z
    .string()
    .nullable()
    .describe("어떻게 처리했는가. 결론이 나지 않았으면 null."),
  systems: z
    .array(z.string())
    .describe(
      "관련된 시스템·서비스·에러 코드를 스레드에 등장한 표기 그대로. 키워드 검색이 이걸로 걸린다.",
    ),
  tags: z.array(z.string()).describe("분류용 짧은 키워드 몇 개."),
});

const SYSTEM_PROMPT = `너는 사내 슬랙 스레드를 읽고 나중에 검색될 지식으로 정리하는 역할이다.

이 기록은 몇 달 뒤 비슷한 상황을 만난 동료가 검색해서 읽게 된다. 그 사람에게
도움이 되는 것만 남기고, 인사·맞장구·잡담은 버린다.

스레드에 없는 내용을 지어내지 않는다. 원인이 규명되지 않았으면 cause를 null로 두고
status를 unresolved로 둔다. 미해결 기록도 그대로 가치가 있다 — "그때도 원인을 못 찾았다"는
것 자체가 다음 사람에게 중요한 정보다. 그럴듯한 추측으로 빈칸을 메우면 그 가치가 사라진다.

에러 코드, 서비스 이름, 라이브러리 이름은 스레드에 쓰인 표기 그대로 옮긴다. 번역하거나
다듬으면 나중에 그 코드로 검색했을 때 걸리지 않는다.

한국어로 쓴다.`;

/** LLM에게 넘길 형태로 스레드를 펼친다. */
function renderTranscript(thread: SourceThread): string {
  return thread.messages
    .map((message) => `[${message.postedAt.toISOString()}] ${message.authorName}: ${message.text}`)
    .join("\n");
}

export interface ExtractOptions {
  /** 테스트에서 갈아끼우기 위한 자리. 평소에는 기본 모델을 쓴다. */
  model?: LanguageModel;
}

export async function extractDraft(
  thread: SourceThread,
  options: ExtractOptions = {},
): Promise<EntryDraft> {
  if (thread.messages.length === 0) {
    throw new Error(`빈 스레드에서는 지식을 뽑을 수 없습니다: ${thread.key}`);
  }

  const { object } = await generateObject({
    model: options.model ?? reasoningModel,
    schema: draftSchema,
    schemaName: "knowledge_entry",
    system: SYSTEM_PROMPT,
    prompt: renderTranscript(thread),
    // Opus 5는 thinking이 기본으로 켜져 있고 max_tokens가 thinking과 응답을 함께
    // 제한한다. 결과물 자체는 짧지만 여유를 둬야 중간에 잘리지 않는다.
    maxOutputTokens: 4000,
    providerOptions: {
      // 추출 품질이 나쁘면 그 Entry는 영원히 나쁜 채로 검색된다. 나중에 비용이
      // 문제가 되면 여기부터 내린다.
      anthropic: { effort: "high" },
    },
  });

  return object;
}

/** 참여자와 메시지 수는 LLM에게 물을 이유가 없다. 세면 된다. */
export function collectParticipants(thread: SourceThread): string[] {
  return [...new Set(thread.messages.map((message) => message.authorName))];
}
