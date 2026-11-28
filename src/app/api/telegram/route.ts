import { redis } from "@/lib/redis";

const TELEGRAM_API = "https://api.telegram.org/bot";

type TelegramUpdate = {
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
};

type Slot = "1" | "2" | "3" | "4";

const MAX_HASHTAGS: Record<Slot, number> = { "1": 4, "2": 3, "3": 3, "4": 3 };

async function sendMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error("[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum diisi");
    return;
  }

  const response = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    console.error("[telegram] gagal kirim:", response.status, await response.text());
  }
}

function commandOf(text: string): string {
  return (text.trim().split(/\s+/)[0] ?? "").split("@")[0].toLowerCase();
}

function parseHashtags(text: string, max: number): string[] {
  const parts = text.trim().split(/\s+/).slice(1);
  return parts
    .slice(0, max)
    .map((part) => part.replace(/#/g, "").trim())
    .filter(Boolean);
}

async function getHashtags(slot: Slot): Promise<string[]> {
  const value = await redis.get<string[]>(`hashtags:slot:${slot}`);
  return Array.isArray(value) ? value : [];
}

async function listHashtags(): Promise<void> {
  const slots: Slot[] = ["1", "2", "3", "4"];
  const all = await Promise.all(slots.map(getHashtags));

  const lines = slots.map((slot, index) => {
    const tags = all[index];
    return `Slot ${slot}: ${tags.length > 0 ? tags.map((tag) => `#${tag}`).join(" ") : "(kosong)"}`;
  });

  await sendMessage(["📋 Hashtag aktif:", ...lines].join("\n"));
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as TelegramUpdate;

    // Hanya chat yang terdaftar yang boleh memberi perintah.
    if (String(body.message?.chat?.id) !== process.env.TELEGRAM_CHAT_ID) {
      return new Response("OK", { status: 200 });
    }

    const text = body.message?.text?.trim() ?? "";
    if (!text.startsWith("/")) return new Response("OK", { status: 200 });

    const command = commandOf(text);

    if (command === "/list") {
      await listHashtags();
      return new Response("OK", { status: 200 });
    }

    const match = /^\/set([1234])$/.exec(command);
    if (match) {
      const slot = match[1] as Slot;
      const hashtags = parseHashtags(text, MAX_HASHTAGS[slot]);

      if (hashtags.length === 0) {
        await sendMessage(`Cara pakai: /set${slot} tag1 tag2 ... (maksimal ${MAX_HASHTAGS[slot]} hashtag)`);
        return new Response("OK", { status: 200 });
      }

      await redis.set(`hashtags:slot:${slot}`, hashtags);
      await sendMessage(`✅ Slot ${slot} tersimpan: ${hashtags.map((tag) => `#${tag}`).join(" ")}`);
      return new Response("OK", { status: 200 });
    }

    const clearMatch = /^\/clear([1234])$/.exec(command);
    if (clearMatch) {
      const slot = clearMatch[1] as Slot;
      await redis.del(`hashtags:slot:${slot}`);
      await sendMessage(`🗑️ Slot ${slot} dikosongkan.`);
      return new Response("OK", { status: 200 });
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    // Telegram mengulang request jika bukan 2xx, jadi tetap balas 200 saat gagal.
    console.error("[telegram] error:", error);
    return new Response("OK", { status: 200 });
  }
}
