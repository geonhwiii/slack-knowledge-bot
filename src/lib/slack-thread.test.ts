import { describe, expect, test } from "bun:test";
import type { Thread } from "chat";
import { stripMentionIds, toSourceThread } from "./slack-thread";

describe("stripMentionIds", () => {
  test("서식이 붙은 멘션을 지운다", () => {
    expect(stripMentionIds("<@U0BPXE20EA2> 이 스레드 요약해줘")).toBe("이 스레드 요약해줘");
  });

  test("서식이 벗겨진 멘션도 지운다", () => {
    // 슬랙이 보내주는 text는 이 모양일 때가 많다.
    expect(stripMentionIds("@U0BPXE20EA2 이 스레드 요약해줘")).toBe("이 스레드 요약해줘");
  });

  test("엔터프라이즈 계정(W)도 지운다", () => {
    expect(stripMentionIds("<@W012ABCDEF> 확인해줘")).toBe("확인해줘");
  });

  test("여러 명을 멘션해도 다 지운다", () => {
    expect(stripMentionIds("<@U0BPXE20EA2> <@U0BPXE20EA3> 저장해줘")).toBe("저장해줘");
  });

  test("멘션을 지우고 남은 공백을 정리한다", () => {
    expect(stripMentionIds("앞 <@U0BPXE20EA2> 뒤")).toBe("앞 뒤");
  });

  test("멘션이 없으면 그대로 둔다", () => {
    expect(stripMentionIds("결제 API가 ERR_PAYMENT_5031로 실패해요")).toBe(
      "결제 API가 ERR_PAYMENT_5031로 실패해요",
    );
  });

  test("대문자 약어를 멘션으로 오인하지 않는다", () => {
    // 사용자 ID는 U 뒤에 8자 이상이 붙는다. 짧은 대문자 단어까지 지우면
    // 저장된 지식에서 고유명사가 조용히 사라진다.
    expect(stripMentionIds("우리 @UBER 쓰나요?")).toBe("우리 @UBER 쓰나요?");
    expect(stripMentionIds("@WAF 설정 확인")).toBe("@WAF 설정 확인");
  });

  test("이메일 주소를 건드리지 않는다", () => {
    expect(stripMentionIds("dan@Uber.com 으로 보내주세요")).toBe("dan@Uber.com 으로 보내주세요");
  });
});

/** Chat SDK의 Thread 중 toSourceThread가 실제로 만지는 부분만 흉내낸다. */
interface FakeMessage {
  text: string;
  author: { fullName?: string; userName?: string; isMe?: boolean; isSystem?: boolean };
  postedAt: string;
}

function fakeThread(messages: FakeMessage[]): Thread {
  return {
    id: "slack:C123:1712345678.000100",
    channelId: "C123",
    allMessages: (async function* () {
      for (const message of messages) {
        yield {
          text: message.text,
          author: {
            fullName: message.author.fullName ?? "",
            userName: message.author.userName ?? "",
            isMe: message.author.isMe ?? false,
            isSystem: message.author.isSystem ?? false,
          },
          metadata: { dateSent: new Date(message.postedAt) },
        };
      }
    })(),
  } as unknown as Thread;
}

describe("toSourceThread", () => {
  const at = "2026-03-01T04:00:00Z";

  test("사람이 쓴 메시지만 남긴다", async () => {
    // 봇 자신의 답변이 지식으로 저장되면, 다음 추출이 그걸 다시 읽고 요약의 요약을
    // 만든다. 시스템 알림("~님이 채널에 참여했습니다")도 지식이 아니다.
    const source = await toSourceThread(
      fakeThread([
        { text: "결제가 안 돼요", author: { fullName: "Dan" }, postedAt: at },
        { text: "확인해볼게요!", author: { fullName: "지식봇", isMe: true }, postedAt: at },
        { text: "Jin님이 참여했습니다", author: { userName: "slackbot", isSystem: true }, postedAt: at },
        { text: "커넥션 풀 문제였어요", author: { fullName: "Jin" }, postedAt: at },
      ]),
    );

    expect(source.messages.map((message) => message.authorName)).toEqual(["Dan", "Jin"]);
  });

  test("멘션만 있던 메시지는 통째로 버린다", async () => {
    // "@봇" 한 줄은 지우고 나면 빈 문자열이다. 빈 줄이 트랜스크립트에 남으면
    // 추출이 읽을 내용 없는 발화를 하나 더 보게 된다.
    const source = await toSourceThread(
      fakeThread([
        { text: "<@U0BPXE20EA2>", author: { fullName: "Dan" }, postedAt: at },
        { text: "<@U0BPXE20EA2> 저장해줘", author: { fullName: "Dan" }, postedAt: at },
      ]),
    );

    expect(source.messages).toHaveLength(1);
    expect(source.messages[0].text).toBe("저장해줘");
  });

  test("표시 이름이 없으면 사용자명으로 대체한다", async () => {
    const source = await toSourceThread(
      fakeThread([{ text: "안녕", author: { fullName: "", userName: "dan" }, postedAt: at }]),
    );

    expect(source.messages[0].authorName).toBe("dan");
  });

  test("읽기만 할 때는 채널 이름과 링크를 가져오지 않는다", async () => {
    // forStorage를 켜야만 슬랙 API를 두 번 더 부른다. 요약 한 번에 불필요한
    // 왕복이 붙지 않도록 하는 부분이다.
    const source = await toSourceThread(
      fakeThread([{ text: "안녕", author: { fullName: "Dan" }, postedAt: at }]),
    );

    expect(source.channelName).toBeUndefined();
    expect(source.permalink).toBeUndefined();
    expect(source.key).toBe("slack:C123:1712345678.000100");
    expect(source.channelId).toBe("C123");
  });
});
