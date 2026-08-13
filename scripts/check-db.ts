/**
 * DB가 코드가 기대하는 상태인지 확인한다.
 *
 * 확장·인덱스가 실제로 있는지 보고, 합성 데이터를 잠깐 넣어 하이브리드 검색 쿼리를
 * 끝까지 돌려본다. 임베딩 API 없이도 SQL 자체의 문제(문법, `<%` 연산자, SET LOCAL,
 * vector 캐스팅)를 잡을 수 있다. 넣은 데이터는 마지막에 지운다.
 *
 *   bun run check-db
 */
import { db } from "../src/lib/db";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID } from "../src/lib/models";
import { findCandidates } from "../src/domain/knowledge/search";

const SAMPLE_PREFIX = "check-db:";

function randomVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => Math.random() - 0.5);
}

async function main() {
  const pool = db();

  const { rows: extensions } = await pool.query<{ extname: string; extversion: string }>(
    `SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'pg_trgm') ORDER BY extname`,
  );
  console.log("확장:", extensions.map((e) => `${e.extname} ${e.extversion}`).join(", ") || "(없음)");

  const { rows: indexes } = await pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'knowledge_entry' ORDER BY indexname`,
  );
  console.log("인덱스:", indexes.map((i) => i.indexname).join(", ") || "(없음)");

  console.log("\n합성 데이터로 검색 쿼리 실행...");

  const samples = [
    {
      title: "결제 API 타임아웃",
      situation: "결제 요청이 30초 넘게 걸리다 실패함. ERR_PAYMENT_5031 발생",
      systems: ["payment-api", "ERR_PAYMENT_5031"],
    },
    {
      title: "회원가입 인증메일 미발송",
      situation: "가입 후 인증 메일이 오지 않음",
      systems: ["mail-sender"],
    },
    {
      title: "뷰어 페이지 로딩 지연",
      situation: "도서 뷰어 첫 페이지가 느리게 뜸",
      systems: ["viewer"],
    },
  ];

  for (const [index, sample] of samples.entries()) {
    await pool.query(
      `INSERT INTO knowledge_entry (
         thread_key, channel_id, kind, status, title, situation, systems,
         saved_by, search_text, embedding, embedding_model
       ) VALUES ($1, $2, 'issue', 'resolved', $3, $4, $5, 'check-db', $6, $7::vector, $8)
       ON CONFLICT (thread_key) DO NOTHING`,
      [
        `${SAMPLE_PREFIX}${index}`,
        "C_CHECK",
        sample.title,
        sample.situation,
        sample.systems,
        [sample.title, sample.situation, ...sample.systems].join("\n"),
        `[${randomVector().join(",")}]`,
        EMBEDDING_MODEL_ID,
      ],
    );
  }

  const candidates = await findCandidates({
    keywordQuery: "결제 요청이 실패함 ERR_PAYMENT_5031",
    embedding: randomVector(),
    limit: 3,
  });

  console.log(`후보 ${candidates.length}건:`);
  for (const candidate of candidates) {
    console.log(`  ${candidate.score.toFixed(4)}  ${candidate.entry.title}`);
  }

  await pool.query(`DELETE FROM knowledge_entry WHERE thread_key LIKE $1`, [`${SAMPLE_PREFIX}%`]);
  console.log("\n합성 데이터 삭제 완료.");

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
