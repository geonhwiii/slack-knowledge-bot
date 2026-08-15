/**
 * 테스트 실행 전에 `.env.local`을 읽어 process.env에 넣는다.
 *
 * `bun test`는 NODE_ENV를 "test"로 세팅하는데, Bun은 그 경우 `.env.local`을 읽지 않는다.
 * 그대로 두면 DB 통합 테스트가 POSTGRES_URL을 못 찾아 영원히 skip되고, skip은 초록색으로
 * 표시되기 때문에 아무도 눈치채지 못한다. 테스트가 안 도는 것보다 나쁜 건 안 도는 걸
 * 모르는 것이다.
 *
 * 이미 셸에 있는 값은 덮어쓰지 않는다. CI나 일회성 실행에서 다른 DB를 가리키게 하려면
 * 환경변수로 넘기는 쪽이 파일보다 우선해야 한다.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(import.meta.dir, "..", ".env.local");

function parseEnv(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    // 따옴표로 감싼 값은 벗긴다. 커넥션 문자열에 `#`이나 공백이 들어가는 일이 흔하다.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

if (existsSync(ENV_FILE)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(ENV_FILE, "utf8")))) {
    process.env[key] ??= value;
  }
}

if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
  console.warn(
    "\n  ⚠ POSTGRES_URL이 없어 DB 통합 테스트를 건너뜁니다.\n" +
      "    `.env.local`에 POSTGRES_URL을 넣거나 환경변수로 넘기세요.\n",
  );
}
