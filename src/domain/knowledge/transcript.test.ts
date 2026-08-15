import { describe, expect, test } from "bun:test";
import { renderTranscript } from "./transcript";
import type { SourceThread } from "./types";

function thread(messages: SourceThread["messages"]): SourceThread {
  return { key: "slack:C123:1712345678.000100", channelId: "C123", messages };
}

describe("renderTranscript", () => {
  test("한 줄에 시각·화자·내용을 담는다", () => {
    const rendered = renderTranscript(
      thread([
        { authorName: "Dan", text: "결제가 안 돼요", postedAt: new Date("2026-03-01T04:00:00Z") },
        { authorName: "Jin", text: "확인해볼게요", postedAt: new Date("2026-03-01T04:01:00Z") },
      ]),
    );

    expect(rendered).toBe(
      "[2026-03-01T04:00:00.000Z] Dan: 결제가 안 돼요\n[2026-03-01T04:01:00.000Z] Jin: 확인해볼게요",
    );
  });

  test("입력 순서를 그대로 지킨다", () => {
    // 추출은 "누가 먼저 말했나"에서 인과를 읽는다. 순서가 흔들리면 원인과 결과가 뒤집힌다.
    const rendered = renderTranscript(
      thread(
        ["첫째", "둘째", "셋째"].map((text, index) => ({
          authorName: "Dan",
          text,
          postedAt: new Date(Date.UTC(2026, 2, 1, 4, index)),
        })),
      ),
    );

    expect(rendered.split("\n").map((line) => line.split(": ")[1])).toEqual([
      "첫째",
      "둘째",
      "셋째",
    ]);
  });

  test("빈 스레드는 빈 문자열이 된다", () => {
    expect(renderTranscript(thread([]))).toBe("");
  });
});
