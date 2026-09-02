import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sendDeparturePush } from "@/lib/platform/web-push";
const schema = z.object({
  departureId: z.string().uuid(),
  kind: z.enum(["quiz_unlock", "disruption", "departure_reminder"]),
  body: z.string().trim().max(500).optional(),
});
function authorized(request: Request) {
  const expected = process.env.CRON_SECRET || "",
    actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await sendDeparturePush(parsed.data)) });
}
