import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { platformApiError } from "@/lib/platform/http";
import { addTravelerExpense, deleteTravelerExpense } from "@/lib/platform/traveler-experience";

const expenseSchema = z.object({
  departureId: z.string().uuid(),
  partyId: z.string().uuid(),
  dayId: z.string().uuid().nullable().optional(),
  label: z.string().trim().min(1).max(240),
  amount: z.number().positive().max(100_000_000_000),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  clientOperationId: z
    .string()
    .uuid()
    .default(() => crypto.randomUUID()),
  exchangeRateToBase: z.number().positive().max(1_000_000).nullable().optional(),
  shareTravelerIds: z.array(z.string().uuid()).min(1).max(100).optional(),
});

const deleteExpenseSchema = z.object({
  departureId: z.string().uuid(),
  partyId: z.string().uuid(),
  expenseId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const parsed = expenseSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Spesa non valida" }, { status: 400 });
    const id = await addTravelerExpense({ userId: user.id, userName: user.name, ...parsed.data });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return platformApiError(error, "Salvataggio della spesa non riuscito");
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const parsed = deleteExpenseSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Spesa non valida" }, { status: 400 });
    await deleteTravelerExpense({ userId: user.id, ...parsed.data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return platformApiError(error, "Eliminazione della spesa non riuscita");
  }
}
