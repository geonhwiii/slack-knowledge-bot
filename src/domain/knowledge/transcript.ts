import type { SourceMessage, SourceThread } from "./types";

/**
 * 스레드를 LLM이 읽을 형태로 펼친다.
 *
 * 추출할 때와 요약할 때가 같은 형태를 보게 해서, 같은 스레드가 상황에 따라 다르게
 * 읽히는 일이 없도록 한다.
 */

/**
 * 트랜스크립트에 허용하는 최대 글자 수.
 *
 * 장애 스레드는 200개를 넘기기도 한다. 그대로 넣으면 입력 토큰이 열 배가 되어
 * 저장 한 번이 $0.02가 아니라 $0.2가 되고, Vercel Hobby의 60초 제한에도 걸린다.
 * 한국어는 대략 두 글자에 한 토큰이라, 이 값이면 입력이 1만 토큰 언저리에서 멈춘다.
 *
 * 넉넉하게 잡았다. 대부분의 스레드는 여기 한참 못 미치고, 잘리는 건 예외적인
 * 경우여야 한다 — 잘라내는 건 정보를 버리는 일이다.
 */
export const MAX_TRANSCRIPT_CHARS = 24_000;

/**
 * 잘라야 할 때 앞쪽에 주는 몫.
 *
 * 앞을 더 남기는 이유는 `situation`이 거기서 나오기 때문이다. situation은 검색이
 * 비교하는 필드라, 이게 부실하면 그 Entry는 영영 안 찾힌다. 뒤쪽(resolution)이
 * 부실한 기록은 찾히기는 하므로 회복이 가능하다.
 */
const HEAD_SHARE = 0.6;

const OMISSION_MARKER = "\n[… 중간 메시지 생략 …]\n";

function renderMessage(message: SourceMessage): string {
  return `[${message.postedAt.toISOString()}] ${message.authorName}: ${message.text}`;
}

/** 예산 안에 들어가는 만큼만 줄을 담는다. `fromEnd`면 뒤에서부터 센다. */
function takeWithinBudget(lines: string[], budget: number, fromEnd: boolean): string[] {
  const ordered = fromEnd ? [...lines].reverse() : lines;
  const taken: string[] = [];
  let used = 0;

  for (const line of ordered) {
    const cost = line.length + 1;
    if (used + cost > budget) break;
    taken.push(line);
    used += cost;
  }

  return fromEnd ? taken.reverse() : taken;
}

export interface RenderTranscriptOptions {
  maxChars?: number;
}

export function renderTranscript(
  thread: SourceThread,
  options: RenderTranscriptOptions = {},
): string {
  const maxChars = options.maxChars ?? MAX_TRANSCRIPT_CHARS;
  const lines = thread.messages.map(renderMessage);
  const full = lines.join("\n");

  if (full.length <= maxChars) return full;

  const budget = maxChars - OMISSION_MARKER.length;
  const head = takeWithinBudget(lines, Math.floor(budget * HEAD_SHARE), false);
  const tail = takeWithinBudget(lines.slice(head.length), budget - head.join("\n").length, true);

  // 한 발언이 예산을 통째로 넘기면 양쪽 다 빈다. 그때는 앞을 글자 단위로 자른다.
  if (head.length === 0 && tail.length === 0) {
    return `${full.slice(0, budget)}${OMISSION_MARKER}`;
  }

  // 생략했다는 사실을 남긴다. 이게 없으면 모델이 끊긴 두 발언을 이어 읽고
  // 없던 인과를 만들어낸다.
  return [head.join("\n"), tail.join("\n")].filter(Boolean).join(OMISSION_MARKER);
}
