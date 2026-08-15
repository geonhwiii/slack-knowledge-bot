import { describe, expect, test } from "bun:test";
import { MAX_TRANSCRIPT_CHARS, renderTranscript } from "./transcript";
import type { SourceThread } from "./types";

function thread(messages: SourceThread["messages"]): SourceThread {
  return { key: "slack:C123:1712345678.000100", channelId: "C123", messages };
}

/** 길이만 중요한 자리에서 쓰는 스레드. 각 메시지에 몇 번째인지 적어둔다. */
function longThread(count: number, textLength: number): SourceThread {
  return thread(
    Array.from({ length: count }, (_, index) => ({
      authorName: `사람${index}`,
      text: `${index}번 ${"가".repeat(textLength)}`,
      postedAt: new Date(Date.UTC(2026, 2, 1, 0, index)),
    })),
  );
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

describe("renderTranscript 길이 제한", () => {
  test("한도 안이면 아무것도 건드리지 않는다", () => {
    const rendered = renderTranscript(longThread(10, 20));

    expect(rendered).not.toContain("생략");
    expect(rendered.split("\n")).toHaveLength(10);
  });

  test("한도를 넘으면 한도 안으로 줄인다", () => {
    // 200개짜리 장애 스레드가 그대로 들어가면 저장 한 번이 열 배 비싸지고
    // Vercel 60초 제한에도 걸린다.
    const rendered = renderTranscript(longThread(400, 200));

    expect(rendered.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS);
  });

  test("앞과 뒤를 남기고 가운데를 버린다", () => {
    // 앞에는 증상이, 뒤에는 결론이 있다. 가운데는 대개 디버깅 왕복이다.
    const rendered = renderTranscript(longThread(400, 200), { maxChars: 4000 });

    expect(rendered).toContain("0번");
    expect(rendered).toContain("399번");
    expect(rendered).not.toContain("200번");
  });

  test("생략했다는 사실을 남긴다", () => {
    // 이게 없으면 모델이 끊긴 두 발언을 이어 읽고 없던 인과를 만들어낸다.
    expect(renderTranscript(longThread(400, 200), { maxChars: 4000 })).toContain(
      "중간 메시지 생략",
    );
  });

  test("앞쪽을 뒤쪽보다 많이 남긴다", () => {
    // situation이 앞에서 나오고, 그건 검색이 비교하는 필드다. 부실하면 그 Entry는
    // 영영 안 찾힌다. 뒤가 부실한 기록은 찾히기라도 한다.
    const rendered = renderTranscript(longThread(400, 200), { maxChars: 4000 });
    const [head, tail] = rendered.split("[… 중간 메시지 생략 …]");

    expect(head.length).toBeGreaterThan(tail.length);
  });

  test("발언 하나가 한도를 넘겨도 잘라서 돌려준다", () => {
    // 로그를 통째로 붙여넣는 사람이 있다. 여기서 빈 문자열이 나오면 추출이
    // "빈 스레드"라며 터진다.
    const rendered = renderTranscript(longThread(1, 10_000), { maxChars: 500 });

    expect(rendered.length).toBeLessThanOrEqual(500);
    expect(rendered.length).toBeGreaterThan(0);
  });

  test("잘려도 첫 줄은 온전한 발언이다", () => {
    const rendered = renderTranscript(longThread(400, 100), { maxChars: 4000 });

    expect(rendered.split("\n")[0]).toMatch(/^\[2026-03-01T00:00:00\.000Z\] 사람0: 0번/);
  });
});
