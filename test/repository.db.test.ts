import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  deleteEntryByThreadKey,
  getEntryByThreadKey,
  listEntriesWithStaleEmbedding,
  updateEmbedding,
  upsertEntry,
} from "@/domain/knowledge/repository";
import { db } from "@/lib/db";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID, EMBEDDING_RECIPE_VERSION } from "@/lib/models";
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

  test("원문을 함께 저장한다", async () => {
    // 추출 프롬프트가 바뀌었을 때 다시 뽑을 재료다. 이게 없으면 이미 쌓인 Entry는
    // 영원히 옛 품질로 남는다 — 슬랙 무료 플랜은 90일이 지나면 원문을 안 보여준다.
    const transcript = "[2026-03-01T04:00:00.000Z] Dan: 결제가 안 돼요";
    const record = testEntry({
      namespace: NS,
      suffix: "transcript",
      sourceTranscript: transcript,
    });
    await upsertEntry(record);

    const { rows } = await db().query<{ source_transcript: string }>(
      "SELECT source_transcript FROM knowledge_entry WHERE thread_key = $1",
      [record.threadKey],
    );

    expect(rows[0].source_transcript).toBe(transcript);
  });

  test("재저장이 Entry 사이의 관계를 끊지 않는다", async () => {
    // superseded_by와 recurrence_of는 스레드에서 추출되는 값이 아니라 사람이 맺어준
    // 관계다. 스레드를 다시 읽었다고 지워지면, 재저장 한 번에 조용히 끊기고 다시
    // 맺을 방법도 없다.
    const older = await upsertEntry(testEntry({ namespace: NS, suffix: "older" }));
    const newer = await upsertEntry(testEntry({ namespace: NS, suffix: "newer" }));

    await db().query(
      "UPDATE knowledge_entry SET superseded_by = $2, recurrence_of = $2 WHERE id = $1",
      [newer.id, older.id],
    );

    const resaved = await upsertEntry(
      testEntry({ namespace: NS, suffix: "newer", title: "다시 저장한 제목" }),
    );

    expect(resaved.title).toBe("다시 저장한 제목");
    expect(resaved.supersededBy).toBe(older.id);
    expect(resaved.recurrenceOf).toBe(older.id);
  });

  test("가리키던 Entry가 지워지면 관계만 끊고 행은 남는다", async () => {
    // 전 공개 정책상 삭제가 유일한 사고 대응 수단이라, 삭제가 다른 Entry까지
    // 끌고 사라지면 안 된다.
    const target = await upsertEntry(testEntry({ namespace: NS, suffix: "cascade-target" }));
    const pointer = await upsertEntry(testEntry({ namespace: NS, suffix: "cascade-pointer" }));

    await db().query("UPDATE knowledge_entry SET recurrence_of = $2 WHERE id = $1", [
      pointer.id,
      target.id,
    ]);
    await deleteEntryByThreadKey(target.threadKey);

    const survivor = await getEntryByThreadKey(pointer.threadKey);
    expect(survivor).not.toBeNull();
    expect(survivor!.recurrenceOf).toBeNull();
  });

  test("새 Entry는 현재 레시피 버전으로 저장된다", async () => {
    const saved = await upsertEntry(testEntry({ namespace: NS, suffix: "version" }));
    expect(saved.embeddingVersion).toBe(EMBEDDING_RECIPE_VERSION);
  });

  test("낡은 벡터를 가진 Entry를 찾아 갈아끼운다", async () => {
    // 레시피를 올리면 옛 행은 벡터 검색에서 빠진다. 되살리는 경로가 실제로 도는지 본다.
    const stale = await upsertEntry(
      testEntry({ namespace: NS, suffix: "stale", embeddingVersion: 1 }),
    );

    const before = await listEntriesWithStaleEmbedding(
      EMBEDDING_MODEL_ID,
      EMBEDDING_RECIPE_VERSION,
    );
    expect(before.map((entry) => entry.id)).toContain(stale.id);

    await updateEmbedding(stale.id, axisVector(5), EMBEDDING_MODEL_ID, EMBEDDING_RECIPE_VERSION);

    const after = await listEntriesWithStaleEmbedding(EMBEDDING_MODEL_ID, EMBEDDING_RECIPE_VERSION);
    expect(after.map((entry) => entry.id)).not.toContain(stale.id);
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
