import { embed } from "ai";
import { EMBEDDING_DIMENSIONS, embeddingModel } from "@/lib/models";

/**
 * 검색용 벡터를 만든다.
 *
 * 차원을 1536으로 줄여서 받는다. 기본 3072차원으로는 pgvector 인덱스를 걸 수 없다.
 */
export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel,
    value: text,
    providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } },
  });

  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `임베딩 차원이 예상과 다릅니다: ${embedding.length} (기대값 ${EMBEDDING_DIMENSIONS}). ` +
        `테이블의 vector(${EMBEDDING_DIMENSIONS})와 맞지 않아 저장할 수 없습니다.`,
    );
  }

  return embedding;
}

/** pgvector는 `[1,2,3]` 형태의 문자열을 받는다. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
