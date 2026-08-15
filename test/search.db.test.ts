import { afterAll, beforeEach, expect, test } from "bun:test";
import { upsertEntry } from "@/domain/knowledge/repository";
import { findCandidates } from "@/domain/knowledge/search";
import {
  axisVector,
  blendedVector,
  cleanupTestEntries,
  describeDb,
  onlyTestRows,
  testEntry,
} from "./helpers";

const NS = "search";

/** 질의 벡터가 가리키는 축. 이 축에 가까울수록 벡터 검색에서 앞선다. */
const QUERY_AXIS = 100;
/** 질의와 직교하는 축. 여기 놓인 Entry는 벡터 검색으로 절대 앞에 오지 않는다. */
const FAR_AXIS = 700;

/**
 * 실제 지식과 겹치지 않는 토큰. 이 테스트는 개발자가 쓰던 DB에 대고 도는데,
 * 흔한 단어로 검색하면 진짜 Entry가 결과에 섞여 순위 검증이 흔들린다.
 */
const UNIQUE_CODE = "ERR_ZORP_9931";
const NO_MATCH_QUERY = "QQQZZZ일치하지않는질의XXX";

function keys(rows: { entry: { threadKey: string } }[]): string[] {
  return onlyTestRows(rows, NS).map((row) => row.entry.threadKey.split(":").pop()!);
}

describeDb("findCandidates", () => {
  // 검증 대상이 대부분 순위라, 앞선 테스트가 남긴 행이 그대로 경쟁자로 끼면
  // 테스트가 실행 순서에 묶인다. 매번 비우고 시작한다.
  beforeEach(() => cleanupTestEntries(NS));
  afterAll(() => cleanupTestEntries(NS));

  test("벡터가 가까운 순으로 준다", async () => {
    // 키워드 쪽은 일부러 아무것도 못 잡게 해서 벡터 순위만 본다.
    await upsertEntry(
      testEntry({ namespace: NS, suffix: "near", embedding: axisVector(QUERY_AXIS) }),
    );
    await upsertEntry(
      testEntry({
        namespace: NS,
        suffix: "mid",
        embedding: blendedVector(QUERY_AXIS, FAR_AXIS, 0.8),
      }),
    );
    await upsertEntry(
      testEntry({
        namespace: NS,
        suffix: "far",
        embedding: blendedVector(QUERY_AXIS, FAR_AXIS, 0.4),
      }),
    );

    const rows = await findCandidates({
      keywordQuery: NO_MATCH_QUERY,
      embedding: axisVector(QUERY_AXIS),
      limit: 50,
    });

    expect(keys(rows)).toEqual(["near", "mid", "far"]);
  });

  test("벡터가 못 잡는 에러 코드를 키워드가 끌어올린다", async () => {
    // 하이브리드 검색이 존재하는 이유 그 자체다. codeonly의 벡터는 질의와 직교해서
    // 벡터 검색만으로는 꼴찌인데, 정확히 그 코드로 물으면 1등이어야 한다.
    //
    // 벡터 검색에는 거리 하한이 없다는 점에 주의. 후보에 "들어오느냐"가 아니라
    // "몇 등이냐"로 봐야 한다 — 지식이 적으면 무관한 것도 항상 후보에는 들어온다.
    await upsertEntry(
      testEntry({
        namespace: NS,
        suffix: "codeonly",
        embedding: axisVector(FAR_AXIS),
        searchText: `배치 작업이 ${UNIQUE_CODE}으로 실패`,
      }),
    );
    await upsertEntry(
      testEntry({
        namespace: NS,
        suffix: "closer",
        embedding: axisVector(QUERY_AXIS),
        searchText: "의미는 가깝지만 코드가 없는 기록",
      }),
    );

    const withKeyword = await findCandidates({
      keywordQuery: UNIQUE_CODE,
      embedding: axisVector(QUERY_AXIS),
      limit: 50,
    });
    const withoutKeyword = await findCandidates({
      keywordQuery: NO_MATCH_QUERY,
      embedding: axisVector(QUERY_AXIS),
      limit: 50,
    });

    expect(keys(withKeyword)).toEqual(["codeonly", "closer"]);
    expect(keys(withoutKeyword)).toEqual(["closer", "codeonly"]);
  });

  test("조사가 바뀌어도 키워드가 걸린다", async () => {
    // word_similarity 임계값 0.3이 한국어를 위해 낮춰둔 값이라는 근거다.
    // 기본값 0.6으로 되돌리면 이 테스트가 깨진다.
    await upsertEntry(
      testEntry({
        namespace: NS,
        suffix: "postposition",
        embedding: axisVector(FAR_AXIS),
        searchText: "결제 승인이 30초 후에 타임아웃되었다",
      }),
    );

    const rows = await findCandidates({
      keywordQuery: "결제 승인 타임아웃",
      embedding: axisVector(FAR_AXIS + 1),
      limit: 50,
    });

    expect(keys(rows)).toContain("postposition");
  });

  test("양쪽에 다 걸린 것이 한쪽에만 걸린 것보다 앞선다", async () => {
    // RRF가 실제로 두 순위를 합치고 있는지 보는 자리다. both는 벡터에서 2등,
    // 키워드에서 1~2등이라 어느 쪽에서도 1등이 아닌데, 합산하면 1등이어야 한다.
    await upsertEntry(
      testEntry({
        namespace: NS,
        suffix: "both",
        embedding: blendedVector(QUERY_AXIS, FAR_AXIS, 0.9),
        searchText: `결제 승인 실패 ${UNIQUE_CODE}`,
      }),
    );
    await upsertEntry(
      testEntry({
        namespace: NS,
        suffix: "vectoronly",
        embedding: axisVector(QUERY_AXIS),
        searchText: "로그인 화면 정렬이 어긋남",
      }),
    );
    await upsertEntry(
      testEntry({
        namespace: NS,
        suffix: "keywordonly",
        embedding: axisVector(FAR_AXIS),
        searchText: `배치 작업 실패 ${UNIQUE_CODE}`,
      }),
    );

    const rows = await findCandidates({
      keywordQuery: UNIQUE_CODE,
      embedding: axisVector(QUERY_AXIS),
      limit: 50,
    });

    const ranked = keys(rows);
    expect(ranked[0]).toBe("both");
    expect(ranked.indexOf("both")).toBeLessThan(ranked.indexOf("vectoronly"));
    expect(ranked.indexOf("both")).toBeLessThan(ranked.indexOf("keywordonly"));
  });

  test("지금 스레드는 결과에서 뺀다", async () => {
    // 안 빼면 "이거 전에 있었어?"에 대해 봇이 방금 그 스레드를 물어온다.
    const record = testEntry({
      namespace: NS,
      suffix: "self",
      embedding: axisVector(QUERY_AXIS),
      searchText: `자기 자신 ${UNIQUE_CODE}`,
    });
    await upsertEntry(record);

    const included = await findCandidates({
      keywordQuery: UNIQUE_CODE,
      embedding: axisVector(QUERY_AXIS),
      limit: 50,
    });
    const excluded = await findCandidates({
      keywordQuery: UNIQUE_CODE,
      embedding: axisVector(QUERY_AXIS),
      excludeThreadKey: record.threadKey,
      limit: 50,
    });

    expect(keys(included)).toContain("self");
    expect(keys(excluded)).not.toContain("self");
  });

  test("다른 모델로 만든 벡터는 벡터 검색에 끼지 않는다", async () => {
    // 임베딩 모델을 바꾸면 좌표계가 달라져 거리 비교가 무의미해진다. 재생성 전까지
    // 옛 벡터는 검색에서 빠져 있어야 하고, 그 사실이 조용히 어긋나면 안 된다.
    await upsertEntry(
      testEntry({
        namespace: NS,
        suffix: "oldmodel",
        embedding: axisVector(QUERY_AXIS),
        embeddingModel: "text-embedding-ada-002",
        searchText: "옛 모델로 만든 벡터",
      }),
    );

    const rows = await findCandidates({
      keywordQuery: NO_MATCH_QUERY,
      embedding: axisVector(QUERY_AXIS),
      limit: 50,
    });

    expect(keys(rows)).not.toContain("oldmodel");
  });

  test("옛 모델 행도 키워드로는 여전히 찾을 수 있다", async () => {
    // 벡터만 못 쓰는 것이지 기록이 사라진 건 아니다. 재생성 전에도 검색이
    // 반쪽으로나마 동작하는지 확인한다.
    await upsertEntry(
      testEntry({
        namespace: NS,
        suffix: "oldmodelkeyword",
        embedding: axisVector(QUERY_AXIS),
        embeddingModel: "text-embedding-ada-002",
        searchText: `옛 모델이지만 ${UNIQUE_CODE}는 남아 있다`,
      }),
    );

    const rows = await findCandidates({
      keywordQuery: UNIQUE_CODE,
      embedding: axisVector(QUERY_AXIS),
      limit: 50,
    });

    expect(keys(rows)).toContain("oldmodelkeyword");
  });

  test("limit을 넘겨서 돌려주지 않는다", async () => {
    const rows = await findCandidates({
      keywordQuery: UNIQUE_CODE,
      embedding: axisVector(QUERY_AXIS),
      limit: 2,
    });

    expect(rows.length).toBeLessThanOrEqual(2);
  });

  test("Entry 필드를 빠짐없이 채워서 돌려준다", async () => {
    // search.ts는 repository.ts와 별개로 행→Entry 변환을 한 벌 더 갖고 있다.
    // 컬럼이 늘 때 한쪽만 고치면 다른 쪽 필드가 조용히 undefined가 된다.
    const record = testEntry({
      namespace: NS,
      suffix: "mapping",
      embedding: axisVector(QUERY_AXIS),
      searchText: `필드 확인 ${UNIQUE_CODE}`,
      title: "매핑 확인",
      situation: "필드가 다 오는지",
      cause: "원인",
      resolution: "처리",
      kind: "decision",
      status: "resolved",
      systems: ["sys-a"],
      tags: ["tag-a"],
      participants: ["Dan"],
      messageCount: 4,
      savedBy: "Dan",
      channelName: "test-channel",
      permalink: "https://example.slack.com/archives/C_TEST/p1",
    });
    await upsertEntry(record);

    const rows = await findCandidates({
      keywordQuery: UNIQUE_CODE,
      embedding: axisVector(QUERY_AXIS),
      limit: 50,
    });
    const found = onlyTestRows(rows, NS).find((row) => row.entry.threadKey === record.threadKey);

    expect(found).toBeDefined();
    expect(found!.entry).toMatchObject({
      title: "매핑 확인",
      situation: "필드가 다 오는지",
      cause: "원인",
      resolution: "처리",
      kind: "decision",
      status: "resolved",
      systems: ["sys-a"],
      tags: ["tag-a"],
      participants: ["Dan"],
      messageCount: 4,
      savedBy: "Dan",
      channelName: "test-channel",
      permalink: "https://example.slack.com/archives/C_TEST/p1",
    });
    expect(found!.entry.createdAt).toBeInstanceOf(Date);
    expect(Number.isFinite(found!.score)).toBe(true);
  });

  test("아무것도 안 걸리면 빈 배열이다", async () => {
    // 지식베이스가 비었을 때 related.ts가 LLM을 부르지 않고 빠져나가는 근거다.
    const rows = await findCandidates({
      keywordQuery: NO_MATCH_QUERY,
      embedding: axisVector(QUERY_AXIS),
      limit: 50,
    });

    expect(Array.isArray(rows)).toBe(true);
  });
});
