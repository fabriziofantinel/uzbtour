import { NextResponse, after } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { PlatformAuthorizationError } from "@/lib/platform/authorization";
import { readDepartureStaffRole } from "@/lib/platform/departure-operational-control";
import { platformApiError } from "@/lib/platform/http";
import { listOperationalMessages, sendOperationalMessage } from "@/lib/platform/operational-chat";
import { sendDeparturePush, sendPartyPush } from "@/lib/platform/web-push";
const scope = z.object({
  departureId: z.string().uuid(),
  scope: z.enum(["trip", "group", "traveler", "accompagnatore", "guida"]).default("group"),
  partyId: z.string().uuid().nullish(),
  travelerId: z.string().uuid().nullish(),
  staffUserId: z.string().uuid().nullish(),
});
const message = scope.extend({ body: z.string().trim().min(1).max(2000), clientOperationId: z.string().uuid() });

async function assertGuideChatBoundary(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  chat: z.infer<typeof scope>,
) {
  if (user.isAgencyAdmin || user.isSuperAdmin) return;
  const staffRole = await readDepartureStaffRole(user.nativeId, chat.departureId);
  if (staffRole !== "guida") return;
  if (chat.scope !== "guida" || (chat.staffUserId && chat.staffUserId !== user.nativeId)) {
    throw new PlatformAuthorizationError("La guida può usare solo la chat personale con l'agenzia", 403);
  }
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const parsed = scope.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return NextResponse.json({ error: "Conversazione non valida" }, { status: 400 });
    await assertGuideChatBoundary(user, parsed.data);
    return NextResponse.json({ messages: await listOperationalMessages({ userId: user.nativeId, ...parsed.data }) });
  } catch (error) {
    return platformApiError(error, "Chat non disponibile");
  }
}
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const parsed = message.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Messaggio non valido" }, { status: 400 });
    await assertGuideChatBoundary(user, parsed.data);
    const id = await sendOperationalMessage({ userId: user.nativeId, ...parsed.data });
    if (user.isAgencyAdmin && parsed.data.scope === "group" && parsed.data.partyId)
      after(() =>
        sendPartyPush({
          departureId: parsed.data.departureId,
          partyId: parsed.data.partyId!,
          kind: "chat_message",
          body: `${user.name}: ${parsed.data.body.slice(0, 180)}`,
        }).catch((error) => console.error("Chat push failed", error)),
      );
    else if (user.isAgencyAdmin && parsed.data.scope === "trip")
      after(() =>
        sendDeparturePush({
          departureId: parsed.data.departureId,
          kind: "chat_message",
          body: `${user.name}: ${parsed.data.body.slice(0, 180)}`,
        }).catch((error) => console.error("Chat push failed", error)),
      );
    return NextResponse.json({ id });
  } catch (error) {
    return platformApiError(error, "Invio del messaggio non riuscito");
  }
}
