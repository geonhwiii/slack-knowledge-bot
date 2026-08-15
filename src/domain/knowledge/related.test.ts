import { describe, expect, test } from "bun:test";
import { resolveJudgement } from "./related";
import type { Candidate } from "./search";
import type { KnowledgeEntry } from "./types";

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
      embeddingModel: "text-embedding-3-large",
      createdAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-03-01T00:00:00Z"),
    } satisfies KnowledgeEntry,
  };
}

const candidates = [candidate("가"), candidate("나"), candidate("다"), candidate("라")];

function titles(entries: { title: string }[]): string[] {
  return entries.map((entry) => entry.title);
}

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
