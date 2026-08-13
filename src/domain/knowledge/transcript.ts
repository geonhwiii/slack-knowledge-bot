import type { SourceThread } from "./types";

/**
 * 스레드를 LLM이 읽을 형태로 펼친다.
 *
 * 추출할 때와 요약할 때가 같은 형태를 보게 해서, 같은 스레드가 상황에 따라 다르게
 * 읽히는 일이 없도록 한다.
 */
export function renderTranscript(thread: SourceThread): string {
  return thread.messages
    .map((message) => `[${message.postedAt.toISOString()}] ${message.authorName}: ${message.text}`)
    .join("\n");
}
