/**
 * 마이그레이션 실행기.
 *
 * migrations/ 안의 .sql 파일을 이름순으로 적용하고, 적용한 것은 schema_migrations에
 * 기록해 다시 실행하지 않는다. 각 파일은 하나의 트랜잭션 안에서 돌기 때문에,
 * 중간에 실패하면 그 파일의 변경은 전부 되돌아간다.
 *
 *   bun run migrate
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "..", "migrations");

async function main() {
  const pool = db();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.name));

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const pending = files.filter((file) => !applied.has(file));

  if (pending.length === 0) {
    console.log(`적용할 마이그레이션이 없습니다. (${files.length}개 적용됨)`);
    await pool.end();
    return;
  }

  for (const file of pending) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`적용: ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`${file} 적용 실패`, { cause: error });
    } finally {
      client.release();
    }
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
