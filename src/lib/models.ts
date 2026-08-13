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

/** 1M 토큰당 단가(USD). 비용을 추정할 때 여기 한 곳만 고치면 되도록 모아둔다. */
export const PRICING = {
  reasoningInput: 5,
  reasoningOutput: 25,
  embedding: 0.13,
} as const;

/**
 * LLM 호출의 토큰 사용량을 찍는다. `LOG_LLM_USAGE=1`일 때만 동작한다.
 *
 * 비용은 스레드 길이와 thinking 분량에 따라 크게 달라져서, 감으로 잡으면 몇 배씩 틀린다.
 * 실제로 재본 값을 근거로 삼기 위한 장치다.
 */
export function logUsage(
  label: string,
  usage:
    | { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; totalTokens?: number }
    | undefined,
) {
  if (process.env.LOG_LLM_USAGE !== "1" || !usage) return;

  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const reasoning = usage.reasoningTokens ?? 0;

  // thinking도 출력 토큰으로 과금된다. 별도로 집계돼 오면 더해야 실제 비용이 나온다.
  const billedOutput = output >= reasoning ? output : output + reasoning;
  const cost = (input * PRICING.reasoningInput + billedOutput * PRICING.reasoningOutput) / 1_000_000;

  console.log(
    `  [usage] ${label}: in ${input} / out ${output} / thinking ${reasoning} / total ${usage.totalTokens ?? "?"} → $${cost.toFixed(4)}`,
  );
}
