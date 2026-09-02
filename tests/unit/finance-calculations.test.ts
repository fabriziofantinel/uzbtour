import { describe, expect, it } from "vitest";
import { allocateMinorUnits, calculateExpenseBalances } from "../../lib/finance-calculations";

describe("expense allocation and settlement", () => {
  it("distribuisce tutti i centesimi senza crearne o perderne", () => {
    const shares = allocateMinorUnits(100, 3);
    expect(shares).toEqual([34, 33, 33]);
    expect(shares.reduce((total, share) => total + share, 0)).toBe(100);
  });

  it("mantiene il saldo complessivo del gruppo esattamente a zero", () => {
    const balances = calculateExpenseBalances(
      [
        { id: "a", name: "Ada" },
        { id: "b", name: "Bruno" },
        { id: "c", name: "Carla" },
      ],
      [
        {
          amount: 10,
          currency: "EUR",
          baseAmount: 10,
          paidByTravelerId: "a",
          shares: [],
        },
      ],
    );
    expect(balances).toEqual([
      { id: "a", name: "Ada", balance: 6.66 },
      { id: "b", name: "Bruno", balance: -3.33 },
      { id: "c", name: "Carla", balance: -3.33 },
    ]);
    expect(Math.round(balances.reduce((total, traveler) => total + traveler.balance, 0) * 100)).toBe(0);
  });

  it("usa le quote esplicite in valuta base", () => {
    const balances = calculateExpenseBalances(
      [
        { id: "a", name: "Ada" },
        { id: "b", name: "Bruno" },
      ],
      [
        {
          amount: 120000,
          currency: "VND",
          baseAmount: 4.5,
          paidByTravelerId: "b",
          shares: [
            { travelerId: "a", baseAmount: 2.25 },
            { travelerId: "b", baseAmount: 2.25 },
          ],
        },
      ],
    );
    expect(balances.map(({ balance }) => balance)).toEqual([-2.25, 2.25]);
  });
});
