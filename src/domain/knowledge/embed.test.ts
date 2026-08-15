import { describe, expect, test } from "bun:test";
import { toVectorLiteral } from "./embed";

describe("toVectorLiteral", () => {
  test("pgvector가 읽는 형태로 만든다", () => {
    expect(toVectorLiteral([1, 2, 3])).toBe("[1,2,3]");
  });

  test("음수와 소수를 그대로 보낸다", () => {
    // 임베딩 값은 대부분 이 모양이다. 반올림이 끼어들면 거리 계산이 미묘하게 어긋난다.
    expect(toVectorLiteral([-0.0123, 0.5, -1])).toBe("[-0.0123,0.5,-1]");
  });

  test("아주 작은 값은 지수 표기가 된다", () => {
    // 1536차원이면 0에 아주 가까운 성분이 반드시 섞이고, JS는 1e-7부터 지수 표기로
    // 넘어간다. pgvector는 이걸 그대로 받는다(repository.db.test.ts에서 실제로 확인한다).
    // 여기서는 그 사실을 못 박아둔다 — 나중에 누가 "지수 표기가 위험해 보인다"며
    // 포맷을 손대면 불필요한 변환이 들어가기 때문이다.
    expect(toVectorLiteral([1e-7, 0.5])).toBe("[1e-7,0.5]");
  });

  test("차원 수를 그대로 보존한다", () => {
    // 잘리거나 늘면 vector(1536) 컬럼이 거부한다. 그 에러는 저장 시점에야 나온다.
    const literal = toVectorLiteral(new Array(1536).fill(0.1));
    expect(literal.split(",")).toHaveLength(1536);
  });
});
