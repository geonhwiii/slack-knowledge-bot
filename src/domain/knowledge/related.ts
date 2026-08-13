import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { reasoningModel } from "@/lib/models";
import { embedText } from "./embed";
import { extractDraft } from "./extract";
import { findCandidates, type Candidate } from "./search";
import { buildSearchText, type EntryDraft, type KnowledgeEntry, type SourceThread } from "./types";

/**
 * "이 이슈 원래 있던 이슈야?"에 답한다.
 *
 * 벡터 검색은 구조상 언제나 무언가를 돌려준다. 지식베이스에 결제 관련 기록만 있는데
 * "회원가입 메일이 안 온다"를 물으면, 그중 제일 덜 무관한 것이 1등으로 나온다. 그걸
 * 그대로 답하면 봇은 전혀 상관없는 스레드를 자신 있게 링크한다. 그런 일이 한 번만
 * 일어나도 사람들은 이 봇에게 다시 묻지 않는다 — 특히 장애 대응 중에는 잘못된 단서가
 * 무응답보다 훨씬 해롭다.
 *
 * 그래서 후보를 뽑는 일과 관련 있다고 말하는 일을 분리한다. 후보는 검색이 뽑고,
 * 관련 여부는 LLM이 실제로 읽어보고 판정하며, 아무것도 아니면 아무것도 아니라고 답한다.
 */

/** 봇이 "관련 있다"고 단정하는 것들. */
export interface RelatedMatch {
  entry: KnowledgeEntry;
  /** 왜 같은 건이라고 보는지. 사람이 검증할 수 있도록 함께 보여준다. */
  why: string;
}

export interface RelatedKnowledgeResult {
  /** 무엇을 기준으로 찾았는지. 봇이 엉뚱한 걸 찾았을 때 사람이 알아챌 수 있어야 한다. */
  situation: string;
  /** 지금 스레드에서 뽑은 내용. 관련 기록이 없을 때 그대로 저장 제안에 쓸 수 있다. */
  draft: EntryDraft;
  related: RelatedMatch[];
  /**
   * 직접 관련은 없지만 인접해 보이는 것들. 봇은 이것들이 관련 있다고 주장하지 않는다.
   * 응답에서도 단정하는 자리와 분리해서 보여줘야 한다.
   */
  adjacent: KnowledgeEntry[];
}

const MAX_ADJACENT = 2;

const judgementSchema = z.object({
  related: z
    .array(
      z.object({
        candidate: z.number().int().describe("관련 있다고 판단한 후보의 번호."),
        why: z.string().describe("같은 건이라고 보는 이유를 한 문장으로."),
      }),
    )
    .describe("관련된 것이 없으면 빈 배열."),
});

const JUDGE_PROMPT = `너는 지금 벌어지고 있는 논의와, 지식베이스에서 검색된 과거 기록들을 비교한다.
과거 기록 중 지금 논의와 **같은 상황**을 다룬 것이 있으면 골라낸다.

검색은 언제나 무언가를 돌려주기 때문에, 후보 목록에 관련 있는 것이 하나도 없는 경우가
흔하다. 그럴 때는 빈 배열을 돌려주는 것이 정답이다. 억지로 하나 고르는 것은 틀린 답이며,
장애 대응 중이라면 팀을 엉뚱한 방향으로 30분 보내는 일이 된다.

같은 시스템을 언급한다는 것만으로는 부족하다. 같은 증상이나 같은 논점이어야 한다.
"결제 API가 느리다"와 "결제 화면 문구 수정"은 둘 다 결제지만 같은 건이 아니다.

확신이 서지 않으면 고르지 않는다.`;

function renderCandidates(candidates: Candidate[]): string {
  return candidates
    .map(({ entry }, index) => {
      const lines = [
        `[후보 ${index + 1}]`,
        `제목: ${entry.title}`,
        `상황: ${entry.situation}`,
        entry.cause ? `원인: ${entry.cause}` : `원인: (규명되지 않음)`,
        entry.resolution ? `처리: ${entry.resolution}` : `처리: (결론 없음)`,
        `상태: ${entry.status}`,
        entry.systems.length > 0 ? `관련 시스템: ${entry.systems.join(", ")}` : null,
        `기록 시점: ${entry.createdAt.toISOString().slice(0, 10)}`,
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function renderCurrent(draft: EntryDraft): string {
  return [
    `제목: ${draft.title}`,
    `상황: ${draft.situation}`,
    draft.systems.length > 0 ? `관련 시스템: ${draft.systems.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface FindRelatedOptions {
  model?: LanguageModel;
  /** 검색이 넘길 후보 수. 늘리면 놓치는 건 줄지만 판정 비용이 는다. */
  candidateLimit?: number;
}

export async function findRelatedKnowledge(
  thread: SourceThread,
  options: FindRelatedOptions = {},
): Promise<RelatedKnowledgeResult> {
  // 지금 스레드도 저장할 때와 똑같이 추출한다. 상황 대 상황을 비교해야 맞는 비교다.
  const draft = await extractDraft(thread, { model: options.model });

  const embedding = await embedText(buildSearchText(draft));
  const keywordQuery = [draft.situation, ...draft.systems].join(" ");

  const candidates = await findCandidates({
    keywordQuery,
    embedding,
    excludeThreadKey: thread.key,
    limit: options.candidateLimit ?? 5,
  });

  // 지식베이스가 비어 있으면 판정할 것도 없다. LLM을 부르지 않는다.
  if (candidates.length === 0) {
    return { situation: draft.situation, draft, related: [], adjacent: [] };
  }

  const { object } = await generateObject({
    model: options.model ?? reasoningModel,
    schema: judgementSchema,
    schemaName: "relevance_judgement",
    system: JUDGE_PROMPT,
    prompt: `## 지금 논의\n${renderCurrent(draft)}\n\n## 검색된 과거 기록\n${renderCandidates(candidates)}`,
    maxOutputTokens: 4000,
    providerOptions: { anthropic: { effort: "high" } },
  });

  // 번호는 모델이 만들어낸 값이라 범위를 벗어날 수 있다. 조용히 버린다.
  const seen = new Set<number>();
  const related: RelatedMatch[] = [];
  for (const item of object.related) {
    const index = item.candidate - 1;
    const candidate = candidates[index];
    if (!candidate || seen.has(index)) continue;
    seen.add(index);
    related.push({ entry: candidate.entry, why: item.why });
  }

  const adjacent = candidates
    .filter((_, index) => !seen.has(index))
    .slice(0, MAX_ADJACENT)
    .map((candidate) => candidate.entry);

  return { situation: draft.situation, draft, related, adjacent };
}
