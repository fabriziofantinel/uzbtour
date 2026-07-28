import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";

type NoteRequest = { action: "note"; day?: number; text?: string };
type RestaurantRequest = { action: "restaurant"; day?: number; name?: string };
type ExpenseRequest = { action: "expense"; label?: string; amount?: number };
type TripDataRequest = NoteRequest | RestaurantRequest | ExpenseRequest;

export const runtime = "nodejs";
export const preferredRegion = "fra1";

function validDay(day: unknown): day is number {
  return Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 11;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  try {
    const sql = getSql();
    const [noteRows, restaurantRows, expenseRows] = await Promise.all([
      sql`SELECT day, text, updated_by_name, updated_at FROM trip_notes ORDER BY day`,
      sql`SELECT id, day, name, added_by_name, created_at FROM trip_restaurants ORDER BY created_at`,
      sql`SELECT id, label, amount, payer_name, created_at FROM trip_expenses ORDER BY created_at`
    ]);

    return NextResponse.json({
      notes: noteRows.map((row) => ({
        day: Number(row.day),
        text: String(row.text),
        updatedBy: String(row.updated_by_name),
        updatedAt: row.updated_at
      })),
      restaurants: restaurantRows.map((row) => ({
        id: String(row.id),
        day: Number(row.day),
        name: String(row.name),
        addedBy: String(row.added_by_name),
        createdAt: row.created_at
      })),
      expenses: expenseRows.map((row) => ({
        id: String(row.id),
        label: String(row.label),
        amount: Number(row.amount),
        payer: String(row.payer_name),
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    console.error("Impossibile leggere i dati del viaggio", error);
    return NextResponse.json({ error: "Database temporaneamente non disponibile" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as TripDataRequest | null;
  if (!body?.action) {
    return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  }

  try {
    const sql = getSql();

    if (body.action === "note") {
      if (!validDay(body.day) || typeof body.text !== "string" || body.text.length > 5000) {
        return NextResponse.json({ error: "Nota non valida" }, { status: 400 });
      }

      const text = body.text.trim();
      if (!text) {
        await sql`DELETE FROM trip_notes WHERE day = ${body.day}`;
        return NextResponse.json({ note: { day: body.day, text: "", updatedBy: user.name } });
      }

      const rows = await sql`
        INSERT INTO trip_notes (day, text, updated_by_id, updated_by_name, updated_at)
        VALUES (${body.day}, ${text}, ${user.id}, ${user.name}, NOW())
        ON CONFLICT (day) DO UPDATE SET
          text = EXCLUDED.text,
          updated_by_id = EXCLUDED.updated_by_id,
          updated_by_name = EXCLUDED.updated_by_name,
          updated_at = NOW()
        RETURNING day, text, updated_by_name, updated_at
      `;
      const row = rows[0];
      return NextResponse.json({
        note: {
          day: Number(row.day),
          text: String(row.text),
          updatedBy: String(row.updated_by_name),
          updatedAt: row.updated_at
        }
      });
    }

    if (body.action === "restaurant") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!validDay(body.day) || !name || name.length > 200) {
        return NextResponse.json({ error: "Locale non valido" }, { status: 400 });
      }

      const rows = await sql`
        INSERT INTO trip_restaurants (day, name, added_by_id, added_by_name)
        VALUES (${body.day}, ${name}, ${user.id}, ${user.name})
        RETURNING id, day, name, added_by_name, created_at
      `;
      const row = rows[0];
      return NextResponse.json({
        restaurant: {
          id: String(row.id),
          day: Number(row.day),
          name: String(row.name),
          addedBy: String(row.added_by_name),
          createdAt: row.created_at
        }
      });
    }

    const label = typeof body.label === "string" ? body.label.trim() : "";
    const amount = Number(body.amount);
    if (!label || label.length > 200 || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
      return NextResponse.json({ error: "Spesa non valida" }, { status: 400 });
    }

    const rows = await sql`
      INSERT INTO trip_expenses (label, amount, payer_id, payer_name)
      VALUES (${label}, ${amount}, ${user.id}, ${user.name})
      RETURNING id, label, amount, payer_name, created_at
    `;
    const row = rows[0];
    return NextResponse.json({
      expense: {
        id: String(row.id),
        label: String(row.label),
        amount: Number(row.amount),
        payer: String(row.payer_name),
        createdAt: row.created_at
      }
    });
  } catch (error) {
    console.error("Impossibile salvare i dati del viaggio", error);
    return NextResponse.json({ error: "Salvataggio non riuscito" }, { status: 503 });
  }
}
