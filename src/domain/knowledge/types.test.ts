import { describe, expect, test } from "bun:test";
import { buildSearchText, buildSituationText, type EntryDraft } from "./types";

function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return {
    kind: "issue",
    status: "resolved",
    title: "결제 API 타임아웃",
    situation: "결제 승인 요청이 30초 후 타임아웃",
    cause: "커넥션 풀 고갈",
    resolution: "풀 크기를 50으로 올림",
    systems: ["payment-api", "ERR_PAYMENT_5031"],
    tags: ["결제", "타임아웃"],
    ...overrides,
  };
}

describe("buildSearchText", () => {
  test("모든 필드를 줄바꿈으로 잇는다", () => {
    expect(buildSearchText(draft())).toBe(
      [
        "결제 API 타임아웃",
        "결제 승인 요청이 30초 후 타임아웃",
        "커넥션 풀 고갈",
        "풀 크기를 50으로 올림",
        "payment-api",
        "ERR_PAYMENT_5031",
        "결제",
        "타임아웃",
      ].join("\n"),
    );
  });

  test("미해결 기록에서 null 필드를 건너뛴다", () => {
    // 진행 중인 장애가 정확히 이 모양이다. 원인도 처리도 아직 없다.
    const text = buildSearchText(draft({ cause: null, resolution: null, status: "unresolved" }));

    expect(text).toBe(
      ["결제 API 타임아웃", "결제 승인 요청이 30초 후 타임아웃", "payment-api", "ERR_PAYMENT_5031", "결제", "타임아웃"].join("\n"),
    );
    expect(text).not.toContain("null");
  });

  test("빈 배열은 아무것도 더하지 않는다", () => {
    const text = buildSearchText(draft({ systems: [], tags: [], cause: null, resolution: null }));
    expect(text).toBe("결제 API 타임아웃\n결제 승인 요청이 30초 후 타임아웃");
  });

  test("빈 문자열은 빈 줄을 남기지 않는다", () => {
    // 빈 줄이 섞이면 트라이그램 인덱스에 의미 없는 토큰이 들어간다.
    const text = buildSearchText(draft({ cause: "", resolution: null, systems: [""], tags: [] }));
    expect(text.split("\n")).not.toContain("");
  });

  test("에러 코드를 그대로 남긴다", () => {
    // 키워드 검색이 걸리는 유일한 자리다. 여기서 표기가 바뀌면 검색이 안 된다.
    expect(buildSearchText(draft())).toContain("ERR_PAYMENT_5031");
  });
});

describe("buildSituationText", () => {
  test("제목·상황·시스템만 담는다", () => {
    expect(buildSituationText(draft())).toBe(
      ["결제 API 타임아웃", "결제 승인 요청이 30초 후 타임아웃", "payment-api", "ERR_PAYMENT_5031"].join("\n"),
    );
  });

  test("원인과 해결책을 넣지 않는다", () => {
    // 이게 이 함수가 존재하는 이유 전부다. 진행 중인 스레드에는 원인도 해결책도
    // 없는 게 정상이라, 저장된 쪽에만 그게 들어가면 비교가 어긋난다.
    const text = buildSituationText(draft());

    expect(text).not.toContain("커넥션 풀 고갈");
    expect(text).not.toContain("풀 크기를 50으로 올림");
  });

  test("해결 여부와 무관하게 같은 모양이 나온다", () => {
    // 질의 쪽(미해결)과 문서 쪽(해결됨)이 같은 축을 가리켜야 거리가 의미를 갖는다.
    const resolved = buildSituationText(draft());
    const unresolved = buildSituationText(
      draft({ cause: null, resolution: null, status: "unresolved" }),
    );

    expect(resolved).toBe(unresolved);
  });

  test("태그는 넣지 않는다", () => {
    // 태그는 분류용 짧은 낱말이라 의미 축을 흔들기만 한다. 트라이그램 쪽에는 남는다.
    expect(buildSituationText(draft())).not.toContain("타임아웃\n결제\n");
  });
});
