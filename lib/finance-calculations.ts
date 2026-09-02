export function allocateMinorUnits(amountMinor: number, participantCount: number) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error("Importo non valido");
  if (!Number.isSafeInteger(participantCount) || participantCount < 1) {
    throw new Error("Numero partecipanti non valido");
  }
  const base = Math.floor(amountMinor / participantCount);
  const remainder = amountMinor % participantCount;
  return Array.from({ length: participantCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

type BalanceTraveler = { id: string; name: string };
type BalanceExpense = {
  amount: number;
  currency: string;
  baseAmount: number | null;
  paidByTravelerId: string | null;
  shares: Array<{ travelerId: string; baseAmount: number }>;
};

export function calculateExpenseBalances(travelers: BalanceTraveler[], expenses: BalanceExpense[]) {
  const balances = new Map(travelers.map((traveler) => [traveler.id, 0]));
  for (const expense of expenses) {
    const baseAmount = expense.baseAmount ?? (expense.currency === "EUR" ? expense.amount : 0);
    const baseMinor = Math.round(baseAmount * 100);
    if (expense.paidByTravelerId && balances.has(expense.paidByTravelerId)) {
      balances.set(expense.paidByTravelerId, balances.get(expense.paidByTravelerId)! + baseMinor);
    }
    if (expense.shares.length > 0) {
      for (const share of expense.shares) {
        if (balances.has(share.travelerId)) {
          balances.set(share.travelerId, balances.get(share.travelerId)! - Math.round(share.baseAmount * 100));
        }
      }
    } else if (travelers.length > 0) {
      const shares = allocateMinorUnits(baseMinor, travelers.length);
      travelers.forEach((traveler, index) => {
        balances.set(traveler.id, balances.get(traveler.id)! - shares[index]);
      });
    }
  }
  return travelers.map((traveler) => ({
    id: traveler.id,
    name: traveler.name,
    balance: balances.get(traveler.id)! / 100,
  }));
}
