/**
 * 지식베이스의 도메인 타입.
 *
 * 이 파일은 슬랙도, Chat SDK도, Next.js도 모른다. 플랫폼에서 오는 것은
 * SourceThread 하나로 정규화해서 받고, 그 바깥의 일은 얇은 어댑터 층이 한다.
 * 용어의 정의는 CONTEXT.md에 있다.
 */

/** Knowledge Entry의 종류. 저장 위치를 가르지 않고, 검색 결과를 설명할 때 쓰는 꼬리표다. */
export type Kind = "issue" | "decision" | "howto";

/** 논의가 결론에 도달했는지 여부. 미해결도 저장 가치가 있다. */
export type Status = "resolved" | "unresolved";

/** 스레드를 이루는 메시지 한 건. 봇 자신의 발언은 여기 들어오지 않는다. */
export interface SourceMessage {
  authorName: string;
  text: string;
  postedAt: Date;
}

/**
 * 추출의 입력. 플랫폼에서 온 스레드를 도메인이 이해하는 형태로 정규화한 것.
 *
 * `key`는 스레드의 정체성이자 Entry의 정체성이다. Chat SDK의 `thread.id`
 * (`adapter:channel:thread`)를 그대로 쓴다.
 */
export interface SourceThread {
  key: string;
  channelId: string;
  channelName?: string;
  permalink?: string;
  messages: SourceMessage[];
}

/**
 * LLM이 스레드에서 뽑아낸 내용. 아직 저장되지 않았고 임베딩도 없다.
 *
 * 검색은 `situation`끼리 비교한다. "이거 전에 있었어?"는 증상 대 증상을 비교해야
 * 맞는 질문이고, 해결책이나 잡담과 비교하면 안 되기 때문이다.
 */
export interface EntryDraft {
  kind: Kind;
  status: Status;
  /** 한 줄 제목. 검색 결과 목록에 그대로 노출된다. */
  title: string;
  /** 무엇이 문제였는가 / 무엇을 정하려 했는가. 검색이 비교하는 대상. */
  situation: string;
  /** 원인. 밝혀지지 않았으면 null. */
  cause: string | null;
  /** 어떻게 했는가. 결론이 안 났으면 null. */
  resolution: string | null;
  /** 관련된 시스템·서비스 이름. 고유명사라 키워드 검색이 이걸로 걸린다. */
  systems: string[];
  tags: string[];
}

/** 저장된 Knowledge Entry. */
export interface KnowledgeEntry extends EntryDraft {
  id: string;
  threadKey: string;
  channelId: string;
  channelName: string | null;
  permalink: string | null;
  participants: string[];
  messageCount: number;
  /** 저장을 지시한 사람. 전 공개 정책이므로 "누가 공개했는가"의 기록이기도 하다. */
  savedBy: string;
  /**
   * 이 결정을 대체한 Entry. `decision`이 뒤집혔을 때 채워진다.
   *
   * 채워진 Entry는 검색 후보에서 빠진다. 폐기된 결정을 근거로 답하는 것은
   * 아무 답도 못 하는 것보다 나쁘기 때문이다.
   */
  supersededBy: string | null;
  /**
   * 같은 증상의 앞선 기록. 세 번째 재발이면 두 번째를 가리킨다.
   *
   * 합치지 않고 잇는 이유는 "몇 번 반복됐는가"가 그 자체로 답이기 때문이다.
   */
  recurrenceOf: string | null;
  /**
   * 이 행의 embedding을 만든 모델. 모델을 바꾸면 벡터 공간이 달라져 전량 재생성이
   * 필요하므로, 어느 벡터가 옛 모델의 것인지 구분할 수 있어야 한다.
   */
  embeddingModel: string | null;
  /** 임베딩 입력을 만든 방식의 버전. models.ts의 EMBEDDING_RECIPE_VERSION 참고. */
  embeddingVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

function joinParts(parts: (string | null)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join("\n");
}

/**
 * 트라이그램 검색이 훑는 텍스트. 아는 것을 전부 넣는다.
 *
 * 여기는 재현율 쪽에 선다. 에러 코드나 서비스 이름이 원인 설명에만 등장하는 일이
 * 흔한데, 그 코드로 검색했을 때 걸리지 않으면 키워드 검색을 붙인 의미가 없다.
 */
export function buildSearchText(draft: EntryDraft): string {
  return joinParts([
    draft.title,
    draft.situation,
    draft.cause,
    draft.resolution,
    ...draft.systems,
    ...draft.tags,
  ]);
}

/**
 * 임베딩에 넣을 텍스트. 상황만 남긴다.
 *
 * 해결책을 빼는 이유는 비교가 성립하지 않기 때문이다. "이거 전에 있었어?"를 묻는
 * 스레드는 아직 진행 중이라 cause와 resolution이 비어 있는 게 정상인데, 저장된 쪽에는
 * 그게 길게 적혀 있다. 그 상태로 벡터를 비교하면 질의는 상황만 가리키고 문서는
 * 상황+해결책을 가리켜서, 해결책이 자세히 적힌 좋은 기록일수록 상황 신호가 묽어진다.
 * 정작 제일 중요한 순간 — 장애가 진행 중일 때 — 매칭이 나빠진다.
 *
 * 시스템 이름은 남긴다. 임베딩이 고유명사에 약한 건 맞지만, "결제 타임아웃"과
 * "배치 타임아웃"을 가르는 데는 쓸모가 있다. 질의 쪽 스레드에서도 같이 추출되므로
 * 양쪽이 대칭이다.
 */
export function buildSituationText(draft: EntryDraft): string {
  return joinParts([draft.title, draft.situation, ...draft.systems]);
}
