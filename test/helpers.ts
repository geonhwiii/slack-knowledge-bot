import { describe } from "bun:test";
import { db } from "@/lib/db";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID, EMBEDDING_RECIPE_VERSION } from "@/lib/models";
import type { EntryRecord } from "@/domain/knowledge/repository";

/**
 * DB 통합 테스트를 위한 도구들.
 *
 * 이 테스트들은 개발자가 실제로 쓰고 있는 데이터베이스를 향해 돈다. 지식베이스가
 * 하나뿐이라 테스트용 DB를 따로 두기 어렵고, 그렇다고 SQL을 검증하지 않으면
 * 마이그레이션이 조용히 검색을 망가뜨려도 알 방법이 없다.
 *
 * 그래서 테스트가 만드는 행은 전부 `test:`로 시작하는 thread_key를 갖는다. 실제
 * Entry의 key는 Chat SDK가 만드는 `slack:C123:1712345678.000100` 형태라 이 접두사와
 * 절대 겹치지 않는다. 정리도 이 접두사로만 지운다.
 */

/** 모든 테스트 행의 thread_key 접두사. 실제 데이터와 겹칠 수 없는 형태여야 한다. */
export const TEST_KEY_PREFIX = "test:";

const hasDatabase = Boolean(process.env.POSTGRES_URL ?? process.env.DATABASE_URL);

/**
 * DB가 있을 때만 도는 describe.
 *
 * 건너뛴 테스트는 초록색으로 표시되기 때문에, 없을 때는 제목에 그 사실을 박아둔다.
 */
export function describeDb(name: string, body: () => void) {
  if (hasDatabase) {
    describe(name, body);
  } else {
    describe.skip(`${name} (POSTGRES_URL 없음 — 검증되지 않음)`, body);
  }
}

/**
 * 축 방향 단위벡터.
 *
 * 임베딩을 실제로 만들면 OpenAI를 부르게 되고, 그러면 테스트가 돈이 들고 네트워크에
 * 의존하며 결과가 매번 미세하게 달라진다. 검증하려는 건 임베딩 품질이 아니라 SQL이
 * 거리를 제대로 정렬하는가이므로, 거리를 우리가 정하는 편이 낫다.
 *
 * 서로 다른 축은 직교한다(코사인 거리 1.0). 같은 축은 거리 0.
 */
export function axisVector(axis: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[axis % EMBEDDING_DIMENSIONS] = 1;
  return vector;
}

/**
 * 두 축 사이 어딘가를 가리키는 단위벡터. `weight`가 1이면 완전히 `axis`, 0이면 `other`.
 * 순위를 검증할 때 "가깝지만 같지는 않은" 벡터가 필요해서 둔다.
 */
export function blendedVector(axis: number, other: number, weight: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const length = Math.hypot(weight, 1 - weight);
  vector[axis % EMBEDDING_DIMENSIONS] = weight / length;
  vector[other % EMBEDDING_DIMENSIONS] = (1 - weight) / length;
  return vector;
}

export interface TestEntryOptions extends Partial<EntryRecord> {
  /** `test:<namespace>:<suffix>` 형태로 조립된다. 파일마다 다른 namespace를 쓴다. */
  namespace: string;
  suffix: string;
}

/** 저장 가능한 최소한의 Entry. 검증에 필요한 필드만 덮어쓰면 된다. */
export function testEntry({ namespace, suffix, ...overrides }: TestEntryOptions): EntryRecord {
  const searchText = overrides.searchText ?? overrides.situation ?? "테스트 상황";

  return {
    threadKey: `${TEST_KEY_PREFIX}${namespace}:${suffix}`,
    channelId: "C_TEST",
    channelName: "test-channel",
    permalink: null,
    kind: "issue",
    status: "resolved",
    title: "테스트 제목",
    situation: "테스트 상황",
    cause: null,
    resolution: null,
    systems: [],
    tags: [],
    participants: ["테스터"],
    messageCount: 1,
    savedBy: "테스터",
    sourceTranscript: "[2026-03-01T00:00:00.000Z] 테스터: 테스트 원문",
    searchText,
    embedding: axisVector(0),
    embeddingModel: EMBEDDING_MODEL_ID,
    embeddingVersion: EMBEDDING_RECIPE_VERSION,
    ...overrides,
  };
}

/**
 * 이 namespace가 만든 행을 지운다.
 *
 * 접두사를 다시 확인하는 이유는, 이 함수가 실수로 빈 문자열을 받으면 지식베이스
 * 전체가 사라지기 때문이다. 테스트 코드라도 DELETE는 DELETE다.
 */
export async function cleanupTestEntries(namespace: string): Promise<void> {
  if (!namespace) throw new Error("namespace 없이 정리하면 테스트 행 전체를 지웁니다.");

  await db().query("DELETE FROM knowledge_entry WHERE thread_key LIKE $1", [
    `${TEST_KEY_PREFIX}${namespace}:%`,
  ]);
}

/** 결과에서 이 namespace의 행만 남긴다. 실제 지식이 함께 검색돼도 흔들리지 않도록. */
export function onlyTestRows<T extends { entry: { threadKey: string } }>(
  rows: T[],
  namespace: string,
): T[] {
  return rows.filter((row) => row.entry.threadKey.startsWith(`${TEST_KEY_PREFIX}${namespace}:`));
}
