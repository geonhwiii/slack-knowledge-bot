import { db } from "@/lib/db";
import { toVectorLiteral } from "./embed";
import type { EntryDraft, KnowledgeEntry } from "./types";

/**
 * Knowledge Entry의 저장소. 여기서는 SQL만 다루고, 무엇을 저장할지는 판단하지 않는다.
 */

interface EntryRow {
  id: string;
  thread_key: string;
  channel_id: string;
  channel_name: string | null;
  permalink: string | null;
  kind: KnowledgeEntry["kind"];
  status: KnowledgeEntry["status"];
  title: string;
  situation: string;
  cause: string | null;
  resolution: string | null;
  systems: string[];
  tags: string[];
  participants: string[];
  message_count: number;
  saved_by: string;
  embedding_model: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECTED_COLUMNS = `
  id, thread_key, channel_id, channel_name, permalink,
  kind, status, title, situation, cause, resolution, systems, tags,
  participants, message_count, saved_by, embedding_model, created_at, updated_at
`;

function toEntry(row: EntryRow): KnowledgeEntry {
  return {
    id: row.id,
    threadKey: row.thread_key,
    channelId: row.channel_id,
    channelName: row.channel_name,
    permalink: row.permalink,
    kind: row.kind,
    status: row.status,
    title: row.title,
    situation: row.situation,
    cause: row.cause,
    resolution: row.resolution,
    systems: row.systems,
    tags: row.tags,
    participants: row.participants,
    messageCount: row.message_count,
    savedBy: row.saved_by,
    embeddingModel: row.embedding_model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface EntryRecord extends EntryDraft {
  threadKey: string;
  channelId: string;
  channelName: string | null;
  permalink: string | null;
  participants: string[];
  messageCount: number;
  savedBy: string;
  searchText: string;
  embedding: number[];
  embeddingModel: string;
}

/**
 * 스레드 하나가 Entry 하나다. 같은 스레드를 다시 저장하면 새 행이 생기는 게 아니라
 * 이 행이 통째로 갱신된다 — 오전에 잘못 짚은 원인이 오후의 결론으로 덮인다.
 *
 * `saved_by`도 함께 갱신한다. 갱신된 내용은 마지막에 저장을 지시한 사람의 것이고,
 * 그 사람이 공개를 선택한 것으로 본다. `created_at`은 처음 저장된 시점으로 남는다.
 */
export async function upsertEntry(record: EntryRecord): Promise<KnowledgeEntry> {
  const { rows } = await db().query<EntryRow>(
    `
    INSERT INTO knowledge_entry (
      thread_key, channel_id, channel_name, permalink,
      kind, status, title, situation, cause, resolution, systems, tags,
      participants, message_count, saved_by,
      search_text, embedding, embedding_model
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::vector, $18)
    ON CONFLICT (thread_key) DO UPDATE SET
      channel_id      = EXCLUDED.channel_id,
      channel_name    = EXCLUDED.channel_name,
      permalink       = EXCLUDED.permalink,
      kind            = EXCLUDED.kind,
      status          = EXCLUDED.status,
      title           = EXCLUDED.title,
      situation       = EXCLUDED.situation,
      cause           = EXCLUDED.cause,
      resolution      = EXCLUDED.resolution,
      systems         = EXCLUDED.systems,
      tags            = EXCLUDED.tags,
      participants    = EXCLUDED.participants,
      message_count   = EXCLUDED.message_count,
      saved_by        = EXCLUDED.saved_by,
      search_text     = EXCLUDED.search_text,
      embedding       = EXCLUDED.embedding,
      embedding_model = EXCLUDED.embedding_model,
      updated_at      = now()
    RETURNING ${SELECTED_COLUMNS}
    `,
    [
      record.threadKey,
      record.channelId,
      record.channelName,
      record.permalink,
      record.kind,
      record.status,
      record.title,
      record.situation,
      record.cause,
      record.resolution,
      record.systems,
      record.tags,
      record.participants,
      record.messageCount,
      record.savedBy,
      record.searchText,
      toVectorLiteral(record.embedding),
      record.embeddingModel,
    ],
  );

  return toEntry(rows[0]);
}

export async function getEntryByThreadKey(threadKey: string): Promise<KnowledgeEntry | null> {
  const { rows } = await db().query<EntryRow>(
    `SELECT ${SELECTED_COLUMNS} FROM knowledge_entry WHERE thread_key = $1`,
    [threadKey],
  );
  return rows[0] ? toEntry(rows[0]) : null;
}

/** 지워진 Entry를 돌려준다. 없었으면 null — 삭제 응답에서 둘을 구분해서 말해야 한다. */
export async function deleteEntryByThreadKey(threadKey: string): Promise<KnowledgeEntry | null> {
  const { rows } = await db().query<EntryRow>(
    `DELETE FROM knowledge_entry WHERE thread_key = $1 RETURNING ${SELECTED_COLUMNS}`,
    [threadKey],
  );
  return rows[0] ? toEntry(rows[0]) : null;
}
