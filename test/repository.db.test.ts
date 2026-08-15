import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  deleteEntryByThreadKey,
  getEntryByThreadKey,
  upsertEntry,
} from "@/domain/knowledge/repository";
import { EMBEDDING_DIMENSIONS } from "@/lib/models";
import { axisVector, cleanupTestEntries, describeDb, testEntry } from "./helpers";

const NS = "repository";

describeDb("repository", () => {
  beforeAll(() => cleanupTestEntries(NS));
  afterAll(() => cleanupTestEntries(NS));

  test("저장하고 다시 읽어온다", async () => {
    const record = testEntry({
      namespace: NS,
      suffix: "roundtrip",
      title: "결제 API 타임아웃",
      situation: "결제 승인이 30초 후 실패",
      cause: "커넥션 풀 고갈",
      resolution: "풀 크기 상향",
      systems: ["payment-api", "ERR_PAYMENT_5031"],
      tags: ["결제"],
      participants: ["Dan", "Jin"],
      messageCount: 7,
    });

    const saved = await upsertEntry(record);
    const loaded = await getEntryByThreadKey(record.threadKey);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(saved.id);
    expect(loaded!.title).toBe("결제 API 타임아웃");
    expect(loaded!.cause).toBe("커넥션 풀 고갈");
    expect(loaded!.messageCount).toBe(7);
  });

  test("한글이 섞인 배열을 그대로 돌려준다", async () => {
    // text[]는 드라이버가 직접 파싱한다. 쉼표나 중괄호가 들어간 값에서 깨지기 쉬운 자리다.
    const record = testEntry({
      namespace: NS,
      suffix: "arrays",
      systems: ["결제 API", "payment-api, v2", "{중괄호}"],
      tags: [],
      participants: ["김건휘", "Dan"],
    });

    const saved = await upsertEntry(record);

    expect(saved.systems).toEqual(["결제 API", "payment-api, v2", "{중괄호}"]);
    expect(saved.tags).toEqual([]);
    expect(saved.participants).toEqual(["김건휘", "Dan"]);
  });

  test("미해결 기록의 빈 필드를 null로 유지한다", async () => {
    // 진행 중인 장애의 정상적인 모양이다. 여기가 빈 문자열로 바뀌면 추출이 원인을
    // 규명했는지 아닌지를 구분할 수 없게 된다.
    const saved = await upsertEntry(
      testEntry({
        namespace: NS,
        suffix: "unresolved",
        status: "unresolved",
        cause: null,
        resolution: null,
      }),
    );

    expect(saved.cause).toBeNull();
    expect(saved.resolution).toBeNull();
    expect(saved.status).toBe("unresolved");
  });

  test("같은 스레드를 다시 저장하면 행이 늘지 않고 갱신된다", async () => {
    // CONTEXT.md의 "스레드 하나가 Entry 하나다"가 실제로 지켜지는지 보는 자리다.
    const first = await upsertEntry(
      testEntry({
        namespace: NS,
        suffix: "resave",
        title: "원인 조사 중",
        cause: null,
        status: "unresolved",
        savedBy: "Dan",
      }),
    );

    const second = await upsertEntry(
      testEntry({
        namespace: NS,
        suffix: "resave",
        title: "인증서 만료로 확인",
        cause: "중간 인증서 만료",
        status: "resolved",
        savedBy: "Jin",
      }),
    );

    expect(second.id).toBe(first.id);
    expect(second.title).toBe("인증서 만료로 확인");
    expect(second.cause).toBe("중간 인증서 만료");
    expect(second.status).toBe("resolved");
  });

  test("재저장은 created_at을 남기고 saved_by를 마지막 사람으로 바꾼다", async () => {
    // created_at은 "언제부터 알려진 지식인가"라서 보존해야 하고, saved_by는
    // 전 공개 정책상 "누가 공개를 선택했는가"라서 마지막 사람이어야 한다.
    const first = await upsertEntry(
      testEntry({ namespace: NS, suffix: "timestamps", savedBy: "Dan" }),
    );

    await Bun.sleep(10);

    const second = await upsertEntry(
      testEntry({ namespace: NS, suffix: "timestamps", savedBy: "Jin" }),
    );

    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
    expect(second.savedBy).toBe("Jin");
  });

  test("1536차원 벡터를 왕복시킨다", async () => {
    // toVectorLiteral은 아주 작은 값을 `1e-7`로 쓴다. pgvector가 그 표기를 받는지
    // 여기서 확인한다 — 못 받으면 저장 시점에야 터지고, 그건 운영 중이다.
    const embedding = axisVector(3);
    embedding[10] = 1e-7;
    embedding[20] = -0.0000001234;

    const record = testEntry({ namespace: NS, suffix: "vector", embedding });
    await upsertEntry(record);

    const loaded = await getEntryByThreadKey(record.threadKey);
    expect(loaded).not.toBeNull();
    expect(embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  test("없는 스레드를 물으면 null이다", async () => {
    expect(await getEntryByThreadKey(`test:${NS}:존재하지-않음`)).toBeNull();
  });

  test("삭제는 지운 행을 돌려주고, 두 번째는 null이다", async () => {
    // 봇이 "지웠어요"와 "저장된 적 없어요"를 구분해서 말하는 근거가 이 차이다.
    const record = testEntry({ namespace: NS, suffix: "delete", title: "지워질 기록" });
    await upsertEntry(record);

    const deleted = await deleteEntryByThreadKey(record.threadKey);
    expect(deleted?.title).toBe("지워질 기록");

    expect(await deleteEntryByThreadKey(record.threadKey)).toBeNull();
    expect(await getEntryByThreadKey(record.threadKey)).toBeNull();
  });
});
