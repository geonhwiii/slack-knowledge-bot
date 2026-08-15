import { describe, expect, test } from "bun:test";
import { buildKeywordQuery, resolveJudgement } from "./related";
import type { Candidate } from "./search";
import type { EntryDraft, KnowledgeEntry } from "./types";

function candidate(title: string, score = 0.05): Candidate {
  return {
    score,
    entry: {
      id: `id-${title}`,
      threadKey: `slack:C123:${title}`,
      channelId: "C123",
      channelName: "incident",
      permalink: null,
      kind: "issue",
      status: "resolved",
      title,
      situation: `${title} 상황`,
      cause: null,
      resolution: null,
      systems: [],
      tags: [],
      participants: [],
      messageCount: 3,
      savedBy: "Dan",
      supersededBy: null,
      recurrenceOf: null,
      embeddingModel: "text-embedding-3-large",
      embeddingVersion: 2,
      createdAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-03-01T00:00:00Z"),
    } satisfies KnowledgeEntry,
  };
}

const candidates = [candidate("가"), candidate("나"), candidate("다"), candidate("라")];

function titles(entries: { title: string }[]): string[] {
  return entries.map((entry) => entry.title);
}

function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return {
    kind: "issue",
    status: "unresolved",
    title: "결제 승인 실패",
    situation: "결제 승인 요청이 30초 넘게 걸리다 실패하고, 재시도해도 같은 증상이 반복된다",
    cause: null,
    resolution: null,
    systems: ["payment-api", "ERR_PAYMENT_5031"],
    tags: ["결제"],
    ...overrides,
  };
}

describe("buildKeywordQuery", () => {
  test("고유명사만 넘긴다", () => {
    expect(buildKeywordQuery(draft())).toBe("payment-api ERR_PAYMENT_5031 결제");
  });

  test("상황 문장을 넣지 않는다", () => {
    // word_similarity는 연속된 구간을 비교하므로, 긴 문장을 넣으면 그 안의 에러 코드가
    // 묻힌다. 벡터가 못 잡는 걸 잡으라고 둔 팔이 벡터와 같은 것을 보게 된다.
    const query = buildKeywordQuery(draft());

    expect(query).not.toContain("30초");
    expect(query.length).toBeLessThan(draft().situation.length);
  });

  test("시스템도 태그도 없으면 제목으로 대신한다", () => {
    // 잡담에 가까운 스레드에서 실제로 일어난다. 빈 문자열을 넘기면 키워드 검색이
    // 통째로 죽는데, 제목은 그나마 짧고 구체적이다.
    expect(buildKeywordQuery(draft({ systems: [], tags: [] }))).toBe("결제 승인 실패");
  });

  test("빈 문자열이 섞여도 공백만 남기지 않는다", () => {
    expect(buildKeywordQuery(draft({ systems: ["", "payment-api"], tags: [""] }))).toBe(
      "payment-api",
    );
  });
});

describe("resolveJudgement", () => {
  test("1부터 세는 번호를 후보에 맞춘다", () => {
    const { related } = resolveJudgement([{ candidate: 2, why: "같은 증상" }], candidates);

    expect(titles(related.map((match) => match.entry))).toEqual(["나"]);
    expect(related[0].why).toBe("같은 증상");
  });

  test("범위를 벗어난 번호를 버린다", () => {
    // 모델이 만들어낸 값이라 후보가 4개인데 7번을 고르는 일이 실제로 있다.
    // 걸러내지 않으면 undefined가 응답까지 흘러가 봇이 빈 링크를 내민다.
    const { related } = resolveJudgement(
      [
        { candidate: 7, why: "없는 번호" },
        { candidate: 0, why: "0은 1부터 세는 규칙 밖" },
        { candidate: -3, why: "음수" },
        { candidate: 1, why: "이건 진짜" },
      ],
      candidates,
    );

    expect(titles(related.map((match) => match.entry))).toEqual(["가"]);
  });

  test("전부 범위 밖이면 관련 기록 없음이 된다", () => {
    // 억지로 하나 고르는 것보다 없다고 말하는 게 맞다는 원칙이 여기서도 지켜져야 한다.
    const { related, adjacent } = resolveJudgement([{ candidate: 99, why: "" }], candidates);

    expect(related).toEqual([]);
    expect(adjacent).toHaveLength(2);
  });

  test("같은 번호를 두 번 고르면 한 번만 남긴다", () => {
    const { related } = resolveJudgement(
      [
        { candidate: 3, why: "첫 번째 이유" },
        { candidate: 3, why: "같은 걸 또" },
      ],
      candidates,
    );

    expect(related).toHaveLength(1);
    expect(related[0].why).toBe("첫 번째 이유");
  });

  test("고른 것은 인접 기록에 들어가지 않는다", () => {
    // 같은 항목이 "관련 있음"과 "참고만 하세요" 양쪽에 나오면 봇이 자기 말을 뒤집는다.
    const { related, adjacent } = resolveJudgement(
      [{ candidate: 1, why: "관련" }],
      candidates,
    );

    expect(titles(related.map((match) => match.entry))).toEqual(["가"]);
    expect(titles(adjacent)).not.toContain("가");
  });

  test("인접 기록은 검색 순위대로 두 개까지만 보여준다", () => {
    const { adjacent } = resolveJudgement([], candidates);

    expect(titles(adjacent)).toEqual(["가", "나"]);
  });

  test("고른 것을 뺀 나머지에서 인접 기록을 고른다", () => {
    const { adjacent } = resolveJudgement([{ candidate: 1, why: "관련" }], candidates);

    expect(titles(adjacent)).toEqual(["나", "다"]);
  });

  test("전부 관련 있다고 판정되면 인접 기록은 없다", () => {
    const { related, adjacent } = resolveJudgement(
      candidates.map((_, index) => ({ candidate: index + 1, why: "관련" })),
      candidates,
    );

    expect(related).toHaveLength(4);
    expect(adjacent).toEqual([]);
  });

  test("후보가 없으면 양쪽 다 빈 배열이다", () => {
    const { related, adjacent } = resolveJudgement([{ candidate: 1, why: "" }], []);

    expect(related).toEqual([]);
    expect(adjacent).toEqual([]);
  });
});
