/**
 * 낡은 벡터를 다시 만든다.
 *
 *   bun run reembed             실제로 갈아끼운다
 *   bun run reembed --dry-run   대상만 보여준다
 *
 * 벡터가 낡는 경로는 둘이다. 임베딩 **모델**을 바꿨을 때, 그리고 무엇을 임베딩할지
 * (**레시피**)를 바꿨을 때. 어느 쪽이든 좌표계가 달라져서 기존 벡터와는 거리를
 * 잴 수 없다. 그래서 검색은 현재 모델·현재 레시피의 행만 벡터 검색에 넣는다.
 *
 * 즉 레시피를 올린 직후에는 기존 Entry가 벡터 검색에서 빠진 상태다(키워드로는
 * 계속 찾힌다). 이 스크립트를 돌려야 원래대로 돌아온다.
 *
 * 추출 내용은 건드리지 않는다. 프롬프트나 모델을 바꿔서 **다시 뽑아야** 하는 경우는
 * 다른 일이고, 그때 필요한 원문은 source_transcript에 남아 있다.
 */
import { embedText } from "../src/domain/knowledge/embed";
import {
  listEntriesWithStaleEmbedding,
  updateEmbedding,
} from "../src/domain/knowledge/repository";
import { buildSituationText } from "../src/domain/knowledge/types";
import { db } from "../src/lib/db";
import { EMBEDDING_MODEL_ID, EMBEDDING_RECIPE_VERSION, PRICING } from "../src/lib/models";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const stale = await listEntriesWithStaleEmbedding(EMBEDDING_MODEL_ID, EMBEDDING_RECIPE_VERSION);

  console.log(`현재: ${EMBEDDING_MODEL_ID} / 레시피 v${EMBEDDING_RECIPE_VERSION}`);

  if (stale.length === 0) {
    console.log("모든 Entry가 최신 벡터를 갖고 있습니다.");
    await db().end();
    return;
  }

  console.log(`다시 만들 Entry: ${stale.length}건\n`);

  for (const entry of stale) {
    const reason =
      entry.embeddingModel !== EMBEDDING_MODEL_ID
        ? `모델 ${entry.embeddingModel ?? "없음"}`
        : `레시피 v${entry.embeddingVersion}`;

    if (dryRun) {
      console.log(`  [건너뜀] ${entry.title} (${reason})`);
      continue;
    }

    const text = buildSituationText(entry);
    const embedding = await embedText(text);
    await updateEmbedding(entry.id, embedding, EMBEDDING_MODEL_ID, EMBEDDING_RECIPE_VERSION);

    console.log(`  ✓ ${entry.title} (${reason})`);
  }

  if (dryRun) {
    console.log("\n--dry-run이라 아무것도 바꾸지 않았습니다.");
  } else {
    // 임베딩은 1M 토큰에 $0.13이라 사실상 공짜다. 그래도 0이 아니라는 건 적어둔다.
    const roughTokens = stale.length * 200;
    const cost = (roughTokens * PRICING.embedding) / 1_000_000;
    console.log(`\n${stale.length}건 완료. 대략 $${cost.toFixed(4)}.`);
  }

  await db().end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
