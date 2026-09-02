import { describe, expect, it } from "vitest";
import { bingoMilestone, bingoScore } from "../../lib/bingo-scoring";

describe("bingo scoring", () => {
  const ids = Array.from({ length: 15 }, (_, index) => `cell-${index + 1}`);

  it("assegna i traguardi progressivi di una riga", () => {
    expect(bingoMilestone(1)).toBeNull();
    expect(bingoMilestone(2)).toEqual({ label: "Ambo", points: 5 });
    expect(bingoMilestone(5)).toEqual({ label: "Cinquina", points: 30 });
  });

  it("somma righe e premio tombola senza contare celle estranee", () => {
    expect(bingoScore([...ids, "foreign-cell"], ids)).toBe(140);
    expect(bingoScore(ids.slice(0, 3), ids)).toBe(10);
  });
});
