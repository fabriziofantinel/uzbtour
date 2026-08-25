import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { cleanText, platformApiError } from "@/lib/platform/http";
import { addTravelerCashMovement, addTravelerRestaurant, deleteTravelerCashMovement, saveTravelerNote } from "@/lib/platform/traveler-experience";

export const runtime = "nodejs";
const uuid = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = cleanText(body?.action, 20);
    const departureId = cleanText(body?.departureId, 64);
    const partyId = cleanText(body?.partyId, 64);
    const dayId = cleanText(body?.dayId, 64);
    if (!uuid.test(departureId) || !uuid.test(partyId) || !uuid.test(dayId)) {
      return NextResponse.json({ error: "Viaggio o giornata non valida" }, { status: 400 });
    }
    if (action === "note") {
      const text = cleanText(body?.text, 8000);
      return NextResponse.json({ note: await saveTravelerNote({ userId: user.id, userName: user.name, departureId, partyId, dayId, text }) });
    }
    if (action === "restaurant") {
      const name = cleanText(body?.name, 240);
      if (!name) return NextResponse.json({ error: "Inserisci il nome del locale" }, { status: 400 });
      return NextResponse.json({ restaurant: await addTravelerRestaurant({ userId: user.id, userName: user.name, departureId, partyId, dayId, name }) });
    }
    if (action === "cash") {
      const kind = body?.kind === "withdrawal" ? "withdrawal" : body?.kind === "exchange" ? "exchange" : null;
      const localAmount = Number(body?.localAmount);
      const euroAmount = body?.euroAmount == null ? null : Number(body.euroAmount);
      const feeEuro = body?.feeEuro == null ? null : Number(body.feeEuro);
      if (!kind || !Number.isFinite(localAmount) || localAmount <= 0 ||
          (euroAmount != null && (!Number.isFinite(euroAmount) || euroAmount <= 0)) ||
          (feeEuro != null && (!Number.isFinite(feeEuro) || feeEuro < 0))) {
        return NextResponse.json({ error: "Importi non validi" }, { status: 400 });
      }
      return NextResponse.json({ movement: await addTravelerCashMovement({
        userId: user.id, userName: user.name, departureId, partyId, dayId, kind,
        euroAmount, localAmount, feeEuro,
      }) });
    }
    return NextResponse.json({ error: "Operazione non supportata" }, { status: 400 });
  } catch (error) {
    return platformApiError(error, "Aggiornamento del diario non riuscito");
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const departureId = cleanText(body?.departureId, 64);
    const partyId = cleanText(body?.partyId, 64);
    const movementId = cleanText(body?.movementId, 64);
    if (!uuid.test(departureId) || !uuid.test(partyId) || !uuid.test(movementId)) {
      return NextResponse.json({ error: "Movimento non valido" }, { status: 400 });
    }
    await deleteTravelerCashMovement({ userId: user.id, departureId, partyId, movementId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return platformApiError(error, "Eliminazione del movimento non riuscita");
  }
}
