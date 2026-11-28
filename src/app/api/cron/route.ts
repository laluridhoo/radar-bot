import { redis } from "@/lib/redis";

export const maxDuration = 60;

type Slot = "1" | "2" | "3";

const ACTOR_ID = "clockworks~tiktok-hashtag-scraper";

function tokenFor(slot: Slot): string | undefined {
  if (slot === "1") return process.env.APIFY_TOKEN_1;
  if (slot === "2") return process.env.APIFY_TOKEN_2;
  return process.env.APIFY_TOKEN_3;
}

export async function GET(request: Request): Promise<Response> {
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

  const hashtags = await redis.get<string[]>(`hashtags:slot:${slot}`);
  if (!hashtags || hashtags.length === 0) {
    return Response.json({ status: "skipped", reason: "no hashtags" });
  }

  const baseUrl = process.env.VERCEL_PROJECT_URL;
  if (!baseUrl) {
    return Response.json({ status: "error", reason: "VERCEL_PROJECT_URL belum diisi" }, { status: 500 });
  }

  const webhookUrl = new URL("/api/webhook", baseUrl);
  webhookUrl.searchParams.set("secret", process.env.CRON_SECRET ?? "");
  webhookUrl.searchParams.set("slot", slot);

  const webhooks = [
    {
      eventTypes: ["ACTOR.RUN.SUCCEEDED"],
      requestUrl: webhookUrl.toString(),
    },
  ];

  const runUrl = new URL(`https://api.apify.com/v2/acts/${ACTOR_ID}/runs`);
  runUrl.searchParams.set("token", token);
  runUrl.searchParams.set("webhooks", Buffer.from(JSON.stringify(webhooks)).toString("base64"));

  const response = await fetch(runUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hashtags,
      resultsPerPage: 10,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      commentsPerPost: 0,
    }),
  });

  if (!response.ok) {
    return Response.json(
      { status: "error", reason: await response.text() },
      { status: 502 }
    );
  }

  const payload = (await response.json()) as {
    data?: { id?: string; defaultDatasetId?: string };
  };

  return Response.json({
    status: "started",
    slot,
    runId: payload.data?.id ?? null,
    datasetId: payload.data?.defaultDatasetId ?? null,
  });
}
