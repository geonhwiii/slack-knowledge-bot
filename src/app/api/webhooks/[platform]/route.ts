import { after } from "next/server";
import { getBot } from "@/lib/bot";

interface Context {
  params: Promise<{ platform: string }>;
}

async function handleRequest(request: Request, context: Context) {
  const { platform } = await context.params;

  const bot = getBot();
  const handler = bot.webhooks[platform as keyof typeof bot.webhooks];

  if (!handler) {
    return new Response(`Unknown platform: ${platform}`, { status: 404 });
  }

  // 슬랙은 3초 안에 응답을 받아야 한다. 실제 처리는 응답을 보낸 뒤 백그라운드에서
  // 이어지므로, 핸들러가 20초 걸려도 슬랙 쪽 타임아웃이 나지 않는다.
  return handler(request, {
    waitUntil: (task) => after(() => task),
  });
}

// Some platforms (e.g. WhatsApp and Messenger) verify the webhook with a GET
// request before they deliver events over POST.
export const GET = handleRequest;
export const POST = handleRequest;
