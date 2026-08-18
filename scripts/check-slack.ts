/**
 * 슬랙 연결을 점검한다.
 *
 *   bun run check-slack                    토큰과 봇 핸들 확인
 *   bun run check-slack <공개주소>          위 + 슬랙이 보낼 검증 요청을 흉내내 확인
 *
 * Event Subscriptions에 URL을 넣고 Verify를 눌렀을 때 실패하면 슬랙은 "응답이 없다"는
 * 말만 한다. 서버가 꺼졌는지, 터널이 죽었는지, Signing Secret이 틀렸는지 구분해주지
 * 않는다. 그래서 등록하기 **전에** 여기서 나눠 확인한다.
 *
 * 서명 검증 요청은 진짜 슬랙이 보내는 것과 같은 방식으로 만든다. 여기서 challenge가
 * 그대로 돌아오면 Verify는 통과한다.
 */
import { createHmac } from "node:crypto";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

let failed = false;

function ok(message: string) {
  console.log(`  ${GREEN}✓${RESET} ${message}`);
}

function warn(message: string) {
  console.log(`  ${YELLOW}!${RESET} ${message}`);
}

function fail(message: string, hint?: string) {
  failed = true;
  console.log(`  ${RED}✗${RESET} ${message}`);
  if (hint) console.log(`      ${hint}`);
}

interface AuthTest {
  ok: boolean;
  error?: string;
  team?: string;
  user?: string;
  user_id?: string;
}

async function checkToken(): Promise<string | null> {
  const token = process.env.SLACK_BOT_TOKEN;

  if (!token) {
    fail("SLACK_BOT_TOKEN이 없습니다", "OAuth & Permissions의 Bot User OAuth Token (xoxb-로 시작)");
    return null;
  }
  if (!token.startsWith("xoxb-")) {
    fail(
      "SLACK_BOT_TOKEN이 xoxb-로 시작하지 않습니다",
      "User Token(xoxp-)이나 App Token(xapp-)을 넣었을 수 있습니다.",
    );
    return null;
  }

  const response = await fetch("https://slack.com/api/auth.test", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as AuthTest;

  if (!body.ok) {
    fail(`토큰이 거부됐습니다: ${body.error}`, "앱을 삭제하고 다시 만들었다면 토큰도 새로 받아야 합니다.");
    return null;
  }

  ok(`토큰 유효 — 워크스페이스 '${body.team}', 봇 @${body.user}`);
  return body.user ?? null;
}

function checkBotUsername(handle: string | null) {
  const configured = process.env.BOT_USERNAME;

  if (!handle) return;
  if (!configured) {
    warn(`BOT_USERNAME이 비어 있습니다. '${handle}'을 넣으세요.`);
    return;
  }
  if (configured === handle) {
    ok(`BOT_USERNAME이 봇 핸들과 일치합니다 (${handle})`);
    return;
  }

  fail(
    `BOT_USERNAME('${configured}')이 봇 핸들('${handle}')과 다릅니다`,
    "표시 이름이 아니라 핸들이어야 합니다. 텍스트에서 @이름을 찾는 데 쓰는 값입니다.",
  );
}

function checkSigningSecret(): string | null {
  const secret = process.env.SLACK_SIGNING_SECRET;

  if (!secret) {
    fail("SLACK_SIGNING_SECRET이 없습니다", "Basic Information의 Signing Secret");
    return null;
  }

  ok("SLACK_SIGNING_SECRET 있음");
  return secret;
}

/** 슬랙이 Request URL을 등록할 때 보내는 요청을 그대로 흉내낸다. */
async function checkWebhook(url: string, secret: string) {
  const body = JSON.stringify({
    token: "check-slack",
    challenge: `check-${Date.now()}`,
    type: "url_verification",
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature =
    "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Slack-Request-Timestamp": timestamp,
        "X-Slack-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    fail(
      `주소에 닿지 못했습니다: ${url}`,
      "서버가 떠 있는지(bun run dev), 터널이 살아 있는지 확인하세요. " +
        "cloudflared는 연결이 끊겨도 프로세스는 살아 있어서 겉으로는 멀쩡해 보입니다.",
    );
    console.log(`      ${String(error).slice(0, 120)}`);
    return;
  }

  const text = await response.text();
  const challenge = JSON.parse(body).challenge as string;

  if (response.status === 401) {
    fail(
      "서명이 거부됐습니다 (401)",
      "SLACK_SIGNING_SECRET이 지금 앱의 것과 다릅니다. 값을 고쳤다면 서버를 다시 시작하세요.",
    );
    return;
  }
  if (!text.includes(challenge)) {
    fail(`challenge를 돌려주지 않습니다 (${response.status})`, text.slice(0, 120));
    return;
  }

  ok("서명 검증 통과 — Event Subscriptions의 Verify가 성공합니다");
}

async function main() {
  const url = process.argv[2];

  console.log("\n슬랙 연결 점검\n");

  const handle = await checkToken();
  checkBotUsername(handle);
  const secret = checkSigningSecret();

  if (url && secret) {
    await checkWebhook(url, secret);
  } else if (!url) {
    console.log(
      `\n  공개 주소를 함께 넘기면 웹훅까지 확인합니다:\n` +
        `    bun run check-slack https://<터널주소>/api/webhooks/slack`,
    );
  }

  console.log();
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
