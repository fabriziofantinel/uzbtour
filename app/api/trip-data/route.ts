import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";

type NoteRequest = { action: "note"; day?: number; text?: string };
type RestaurantRequest = { action: "restaurant"; day?: number; name?: string };
type ExpenseRequest = { action: "expense"; label?: string; amount?: number; currency?: "EUR" | "UZS" };
type CashMovementRequest = {
  action: "withdrawal" | "exchange";
  day?: number;
  location?: string;
  euroAmount?: number;
  somAmount?: number;
  feeEuro?: number;
};
type TripDataRequest = NoteRequest | RestaurantRequest | ExpenseRequest | CashMovementRequest;

export const runtime = "nodejs";
export const preferredRegion = "fra1";

let cashSchemaPromise: Promise<void> | null = null;
let expenseSchemaPromise: Promise<void> | null = null;

function validDay(day: unknown): day is number {
  return Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 13;
}

async function ensureCashMovementsTable(sql: ReturnType<typeof getSql>) {
  if (!cashSchemaPromise) {
    cashSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS trip_cash_movements (
          id BIGSERIAL PRIMARY KEY,
          day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 13),
          kind TEXT NOT NULL CHECK (kind IN ('withdrawal', 'exchange')),
          location TEXT NOT NULL,
          euro_amount NUMERIC(12, 2),
          som_amount NUMERIC(18, 2) NOT NULL,
          fee_eur NUMERIC(12, 2),
          added_by_id TEXT NOT NULL,
          added_by_name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    })().catch((error) => {
      cashSchemaPromise = null;
      throw error;
    });
  }
  await cashSchemaPromise;
}

async function ensureExpenseCurrencyColumn(sql: ReturnType<typeof getSql>) {
  if (!expenseSchemaPromise) {
    expenseSchemaPromise = sql`
      ALTER TABLE trip_expenses
      ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'
    `.then(() => undefined).catch((error) => {
      expenseSchemaPromise = null;
      throw error;
    });
  }
  await expenseSchemaPromise;
}

function cashMovementFromRow(row: Record<string, unknown>) {
  const euroAmount = row.euro_amount == null ? null : Number(row.euro_amount);
  const feeEuro = row.fee_eur == null ? null : Number(row.fee_eur);
  return {
    id: String(row.id),
    day: Number(row.day),
    kind: String(row.kind),
    location: String(row.location),
    euroAmount,
    somAmount: Number(row.som_amount),
    feeEuro,
    addedBy: String(row.added_by_name),
    createdAt: row.created_at
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  try {
    const sql = getSql();
    await Promise.all([
      ensureCashMovementsTable(sql),
      ensureExpenseCurrencyColumn(sql)
    ]);
    const [noteRows, restaurantRows, expenseRows, cashRows] = await Promise.all([
      sql`SELECT day, text, updated_by_name, updated_at FROM trip_notes ORDER BY day`,
      sql`SELECT id, day, name, added_by_name, created_at FROM trip_restaurants ORDER BY created_at`,
      sql`SELECT id, label, amount, currency, payer_name, created_at FROM trip_expenses ORDER BY created_at`,
      sql`SELECT id, day, kind, location, euro_amount, som_amount, fee_eur, added_by_name, created_at
          FROM trip_cash_movements ORDER BY created_at`
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
        currency: row.currency === "UZS" ? "UZS" : "EUR",
        payer: String(row.payer_name),
        createdAt: row.created_at
      })),
      cashMovements: cashRows.map(cashMovementFromRow)
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

    if (body.action === "withdrawal" || body.action === "exchange") {
      const suppliedLocation = typeof body.location === "string" ? body.location.trim() : "";
      const location = suppliedLocation || (body.action === "withdrawal" ? "Prelievo ATM" : "Cambio valuta");
      const euroAmount = body.euroAmount == null ? null : Number(body.euroAmount);
      const somAmount = Number(body.somAmount);
      const feeEuro = body.feeEuro == null ? null : Number(body.feeEuro);
      const validEuro = euroAmount == null || (Number.isFinite(euroAmount) && euroAmount > 0 && euroAmount <= 1_000_000);
      const validFee = feeEuro == null || (Number.isFinite(feeEuro) && feeEuro >= 0 && feeEuro <= 100_000);

      if (
        !validDay(body.day) ||
        !location ||
        location.length > 200 ||
        !Number.isFinite(somAmount) ||
        somAmount <= 0 ||
        somAmount > 100_000_000_000 ||
        !validEuro ||
        !validFee ||
        (body.action === "exchange" && euroAmount == null)
      ) {
        return NextResponse.json({ error: "Movimento di valuta non valido" }, { status: 400 });
      }

      await ensureCashMovementsTable(sql);
      const rows = await sql`
        INSERT INTO trip_cash_movements (
          day, kind, location, euro_amount, som_amount, fee_eur, added_by_id, added_by_name
        )
        VALUES (
          ${body.day}, ${body.action}, ${location}, ${euroAmount}, ${somAmount}, ${feeEuro},
          ${user.id}, ${user.name}
        )
        RETURNING id, day, kind, location, euro_amount, som_amount, fee_eur, added_by_name, created_at
      `;
      return NextResponse.json({ cashMovement: cashMovementFromRow(rows[0]) });
    }

    if (body.action !== "expense") {
      return NextResponse.json({ error: "Azione non supportata" }, { status: 400 });
    }

    const label = typeof body.label === "string" ? body.label.trim() : "";
    const amount = Number(body.amount);
    const currency = body.currency === "UZS" ? "UZS" : body.currency === "EUR" ? "EUR" : null;
    const maximumAmount = currency === "UZS" ? 100_000_000_000 : 1_000_000;
    if (!label || label.length > 200 || !currency || !Number.isFinite(amount) || amount <= 0 || amount > maximumAmount) {
      return NextResponse.json({ error: "Spesa non valida" }, { status: 400 });
    }

    await ensureExpenseCurrencyColumn(sql);
    const rows = await sql`
      INSERT INTO trip_expenses (label, amount, currency, payer_id, payer_name)
      VALUES (${label}, ${amount}, ${currency}, ${user.id}, ${user.name})
      RETURNING id, label, amount, currency, payer_name, created_at
    `;
    const row = rows[0];
    return NextResponse.json({
      expense: {
        id: String(row.id),
        label: String(row.label),
        amount: Number(row.amount),
        currency: row.currency === "UZS" ? "UZS" : "EUR",
        payer: String(row.payer_name),
        createdAt: row.created_at
      }
    });
  } catch (error) {
    console.error("Impossibile salvare i dati del viaggio", error);
    return NextResponse.json({ error: "Salvataggio non riuscito" }, { status: 503 });
  }
}
