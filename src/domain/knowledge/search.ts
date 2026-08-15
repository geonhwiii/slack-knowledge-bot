import { db } from "@/lib/db";
import { EMBEDDING_MODEL_ID, EMBEDDING_RECIPE_VERSION } from "@/lib/models";
import { toVectorLiteral } from "./embed";
import type { KnowledgeEntry } from "./types";

/**
 * 후보 수집. 여기서는 "관련 있다"고 판단하지 않는다 — 읽어볼 가치가 있는 것들을
 * 추려서 넘길 뿐이고, 판정은 related.ts의 LLM이 한다.
 *
 * 두 검색을 함께 돌리는 이유:
 *   벡터  "결제 안 됨"과 "구매 실패"가 같은 말인 걸 잡는다. 대신 `ERR_PAYMENT_5031`
 *         같은 코드나 사내 고유명사에는 약하다.
 *   키워드 정확히 그 코드, 그 서비스 이름을 잡는다. 대신 다른 표현은 못 잡는다.
 */

/**
 * 두 순위를 합칠 때 쓰는 상수(Reciprocal Rank Fusion).
 * 점수 자체를 정규화하지 않고 순위만 쓰기 때문에, 코사인 거리와 트라이그램 유사도처럼
 * 단위가 전혀 다른 두 지표를 억지로 같은 자로 재지 않아도 된다.
 */
const RRF_K = 60;

/**
 * 한국어는 조사 때문에 어절 형태가 변해서 기본 임계값(0.6)으로는 걸리는 게 거의 없다.
 * 낮추면 후보가 늘지만, 최종 판정은 LLM이 하므로 여기서는 재현율 쪽에 서는 게 맞다.
 */
const WORD_SIMILARITY_THRESHOLD = 0.3;

/** 각 검색이 가져오는 후보 수. 이 둘을 합쳐 다시 추린다. */
const PER_SEARCH_LIMIT = 20;

export interface Candidate {
  entry: KnowledgeEntry;
  /** RRF 점수. 순위 확인용이고, 관련성의 근거로 쓰지 않는다. */
  score: number;
}

interface CandidateRow {
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
  superseded_by: string | null;
  recurrence_of: string | null;
  embedding_model: string | null;
  embedding_version: number;
  created_at: Date;
  updated_at: Date;
  score: string;
}

export interface FindCandidatesInput {
  /**
   * 키워드 검색에 쓸 질의. 상황 설명에 시스템·에러 코드를 붙인 짧은 문자열이다.
   * 벡터 쪽과 달리 여기는 짧아야 한다 — 긴 문장을 통째로 넣으면 부분 일치가 흐려진다.
   */
  keywordQuery: string;
  /** 저장된 Entry들과 같은 방식으로 만든 벡터. 그래야 거리 비교가 성립한다. */
  embedding: number[];
  /** 지금 이 스레드는 결과에서 뺀다. 자기 자신을 "비슷한 과거 기록"으로 물어오면 곤란하다. */
  excludeThreadKey?: string;
  limit?: number;
}

export async function findCandidates(input: FindCandidatesInput): Promise<Candidate[]> {
  const client = await db().connect();

  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL pg_trgm.word_similarity_threshold = ${WORD_SIMILARITY_THRESHOLD}`);

    // HNSW는 인덱스를 먼저 훑고 필터를 나중에 적용한다. 필터를 통과하는 행이 ef_search
    // 안에서 LIMIT을 못 채우면 에러 없이 결과가 줄어든다 — 조용히 나빠지는 종류라
    // 알아채기 어렵다. 반복 스캔을 켜면 부족한 만큼 더 훑는다(pgvector 0.8+).
    await client.query("SET LOCAL hnsw.iterative_scan = relaxed_order");

    const { rows } = await client.query<CandidateRow>(
      `
      WITH vector_hits AS (
        SELECT id, row_number() OVER (ORDER BY embedding <=> $1::vector) AS rank
        FROM knowledge_entry
        WHERE embedding IS NOT NULL
          AND embedding_model = $2
          AND embedding_version = $8
          AND superseded_by IS NULL
          AND ($3::text IS NULL OR thread_key <> $3)
        ORDER BY embedding <=> $1::vector
        LIMIT $5
      ),
      keyword_hits AS (
        SELECT id, row_number() OVER (ORDER BY word_similarity($4, search_text) DESC) AS rank
        FROM knowledge_entry
        WHERE $4 <% search_text
          AND superseded_by IS NULL
          AND ($3::text IS NULL OR thread_key <> $3)
        ORDER BY word_similarity($4, search_text) DESC
        LIMIT $5
      ),
      fused AS (
        SELECT id, SUM(1.0 / ($7 + rank)) AS score
        FROM (SELECT * FROM vector_hits UNION ALL SELECT * FROM keyword_hits) hits
        GROUP BY id
      )
      SELECT
        e.id, e.thread_key, e.channel_id, e.channel_name, e.permalink,
        e.kind, e.status, e.title, e.situation, e.cause, e.resolution, e.systems, e.tags,
        e.participants, e.message_count, e.saved_by, e.superseded_by, e.recurrence_of,
        e.embedding_model, e.embedding_version, e.created_at, e.updated_at,
        fused.score
      FROM knowledge_entry e
      JOIN fused ON fused.id = e.id
      ORDER BY fused.score DESC
      LIMIT $6
      `,
      [
        toVectorLiteral(input.embedding),
        // 다른 모델로 만든 벡터는 좌표계가 달라 거리 계산이 무의미하다. 섞지 않는다.
        EMBEDDING_MODEL_ID,
        input.excludeThreadKey ?? null,
        input.keywordQuery,
        PER_SEARCH_LIMIT,
        input.limit ?? 5,
        RRF_K,
        // 같은 모델이라도 다른 텍스트를 넣어 만든 벡터는 다른 것을 가리킨다.
        EMBEDDING_RECIPE_VERSION,
      ],
    );

    await client.query("COMMIT");

    return rows.map((row) => ({
      score: Number(row.score),
      entry: {
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
        supersededBy: row.superseded_by,
        recurrenceOf: row.recurrence_of,
        embeddingModel: row.embedding_model,
        embeddingVersion: row.embedding_version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
