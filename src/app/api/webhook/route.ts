export const maxDuration = 60;

const TELEGRAM_API = "https://api.telegram.org/bot";

type Slot = "1" | "2" | "3";

type ApifyWebhookBody = {
  resource?: { defaultDatasetId?: string };
};

type TikTokPost = {
  createTime?: number | string;
  playCount?: number | string;
  webVideoUrl?: string;
};

function tokenFor(slot: Slot): string | undefined {
  if (slot === "1") return process.env.APIFY_TOKEN_1;
  if (slot === "2") return process.env.APIFY_TOKEN_2;
  return process.env.APIFY_TOKEN_3;
}

function toUnixSeconds(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number > 1e12 ? number / 1000 : number);
}

async function sendMessage(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN belum diisi");

  const response = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram ${response.status}: ${await response.text()}`);
  }
}

export async function POST(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);

  if (searchParams.get("secret") !== process.env.CRON_SECRET) {
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }

  const rawSlot = searchParams.get("slot");
  if (rawSlot !== "1" && rawSlot !== "2" && rawSlot !== "3") {
    return Response.json({ status: "error", reason: "invalid slot" }, { status: 400 });
  }
  const slot: Slot = rawSlot;

  const token = tokenFor(slot);
  if (!token) {
    return Response.json({ status: "error", reason: `APIFY_TOKEN_${slot} belum diisi` }, { status: 500 });
  }

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    return Response.json({ status: "error", reason: "TELEGRAM_CHAT_ID belum diisi" }, { status: 500 });
  }

  let body: ApifyWebhookBody;
  try {
    body = (await request.json()) as ApifyWebhookBody;
  } catch {
    return Response.json({ status: "error", reason: "invalid json" }, { status: 400 });
  }

  const datasetId = body.resource?.defaultDatasetId;
  if (!datasetId) {
    return Response.json({ status: "error", reason: "defaultDatasetId tidak ditemukan" }, { status: 400 });
  }

  const datasetUrl = new URL(
    `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items`
  );
  datasetUrl.searchParams.set("token", token);

  const datasetResponse = await fetch(datasetUrl);
  if (!datasetResponse.ok) {
    return Response.json(
      { status: "error", reason: `Apify dataset ${datasetResponse.status}` },
      { status: 502 }
    );
  }

  const items = (await datasetResponse.json()) as TikTokPost[];
  const now = Math.floor(Date.now() / 1000);
  const threshold = now - 6 * 3600;

  const viral = items.filter((item) => {
    const createTime = toUnixSeconds(item.createTime);
    if (createTime === null || createTime < threshold) return false;

    const ageInHours = Math.max((now - createTime) / 3600, 0.5);
    const vph = (Number(item.playCount) || 0) / ageInHours;
    return vph >= 3000;
  });

  if (viral.length === 0) {
    return Response.json({ status: "ok", found: 0, sent: 0 });
  }

  const messages = viral.map((item) => {
    const createTime = toUnixSeconds(item.createTime) ?? now;
    const ageMinutes = Math.max(0, Math.floor((now - createTime) / 60));
    const views = Number(item.playCount) || 0;
    const ageInHours = Math.max((now - createTime) / 3600, 0.5);
    const vph = views / ageInHours;

    return [
      `*[SLOT ${slot}]* 🚀 Early viral TikTok`,
      `⏳ Umur: ${ageMinutes} menit`,
      `👁️ Views: ${views.toLocaleString("id-ID")} (VPH ${Math.round(vph).toLocaleString("id-ID")})`,
      `🔗 \`${item.webVideoUrl ?? ""}\``,
    ].join("\n");
  });

  for (const message of messages) {
    await sendMessage(chatId, message);
  }

  return Response.json({ status: "ok", found: viral.length, sent: messages.length });
}
