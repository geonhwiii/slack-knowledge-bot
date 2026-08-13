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
   * 이 행의 embedding을 만든 모델. 모델을 바꾸면 벡터 공간이 달라져 전량 재생성이
   * 필요하므로, 어느 벡터가 옛 모델의 것인지 구분할 수 있어야 한다.
   */
  embeddingModel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Entry에서 검색 대상 텍스트를 만든다.
 *
 * 임베딩과 트라이그램 인덱스가 같은 텍스트를 보게 해서, 두 검색이 서로 다른 것을
 * 가리키는 상황을 만들지 않는다.
 */
export function buildSearchText(draft: EntryDraft): string {
  return [
    draft.title,
    draft.situation,
    draft.cause,
    draft.resolution,
    ...draft.systems,
    ...draft.tags,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");
}
