import { collectParticipants, extractDraft } from "./extract";
import { embedText } from "./embed";
import { deleteEntryByThreadKey, getEntryByThreadKey, upsertEntry } from "./repository";
import { EMBEDDING_MODEL_ID } from "@/lib/models";
import { buildSearchText, type KnowledgeEntry, type SourceThread } from "./types";

/**
 * 저장과 삭제. 추출·임베딩·저장을 엮는 자리이고, 슬랙은 여전히 모른다.
 */

export interface SaveResult {
  entry: KnowledgeEntry;
  /** 처음 저장된 것인지, 기존 Entry가 갱신된 것인지. 응답 문구가 달라진다. */
  created: boolean;
}

export async function saveThreadAsKnowledge(
  thread: SourceThread,
  savedBy: string,
): Promise<SaveResult> {
  const draft = await extractDraft(thread);
  const searchText = buildSearchText(draft);

  // 임베딩은 추출 결과에 대해 만든다. 원문 전체로 만들면 잡담이 섞여 벡터가 희석된다.
  const embedding = await embedText(searchText);

  const existing = await getEntryByThreadKey(thread.key);

  const entry = await upsertEntry({
    ...draft,
    threadKey: thread.key,
    channelId: thread.channelId,
    channelName: thread.channelName ?? null,
    permalink: thread.permalink ?? null,
    participants: collectParticipants(thread),
    messageCount: thread.messages.length,
    savedBy,
    searchText,
    embedding,
    embeddingModel: EMBEDDING_MODEL_ID,
  });

  return { entry, created: existing === null };
}

/**
 * 지식베이스에서 지운다.
 *
 * 저장된 Entry는 전원이 검색할 수 있으므로, 공개돼선 안 될 것이 들어갔을 때
 * 되돌릴 수단은 이것뿐이다. 그래서 1차 범위에 들어 있다.
 */
export async function forgetThread(threadKey: string): Promise<KnowledgeEntry | null> {
  return deleteEntryByThreadKey(threadKey);
}
