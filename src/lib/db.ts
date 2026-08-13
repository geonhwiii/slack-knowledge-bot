import { Pool } from "pg";

/**
 * 봇 상태(구독, 락)와 지식베이스가 같은 Postgres를 쓴다. state-pg도 같은 `pg`
 * 드라이버 위에 있으므로 드라이버가 갈라지지 않는다.
 *
 * 서버리스에서는 인스턴스마다 풀이 하나씩 생기므로 크기를 작게 잡는다.
 */
let pool: Pool | undefined;

export function db(): Pool {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("POSTGRES_URL (또는 DATABASE_URL) 환경변수가 없습니다.");
    }
    pool = new Pool({ connectionString, max: 3 });
  }
  return pool;
}
