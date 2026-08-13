import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

/**
 * 모델 선택을 한 곳에 모아둔다. 갈아탈 때 손댈 자리가 여기 하나가 되도록.
 */

/** 추출·판정·검토에 쓰는 모델. 전부 판단이 필요한 일이다. */
export const reasoningModel = anthropic("claude-opus-5");

/**
 * 임베딩 모델. Anthropic에는 임베딩 API가 없어 제공자가 갈라진다.
 *
 * 기본 3072차원 대신 1536으로 받는 이유는 pgvector 인덱스가 2000차원까지만
 * 지원하기 때문이다. 3-large는 차원 축소를 전제로 학습돼서 손실이 크지 않다.
 */
export const EMBEDDING_MODEL_ID = "text-embedding-3-large";
export const EMBEDDING_DIMENSIONS = 1536;

export const embeddingModel = openai.textEmbeddingModel(EMBEDDING_MODEL_ID);
