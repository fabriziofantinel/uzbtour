export type BingoMilestone = { label: "Ambo" | "Terno" | "Quaterna" | "Cinquina"; points: number };

export function bingoMilestone(completed: number): BingoMilestone | null {
  if (completed >= 5) return { label: "Cinquina", points: 30 };
  if (completed === 4) return { label: "Quaterna", points: 20 };
  if (completed === 3) return { label: "Terno", points: 10 };
  if (completed === 2) return { label: "Ambo", points: 5 };
  return null;
}

export function bingoScore(completedIds: Iterable<string>, orderedIds: readonly string[]) {
  const completed = new Set(completedIds);
  const rows = [orderedIds.slice(0, 5), orderedIds.slice(5, 10), orderedIds.slice(10, 15)];
  const rowScore = rows.reduce(
    (sum, row) => sum + (bingoMilestone(row.filter((id) => completed.has(id)).length)?.points ?? 0),
    0,
  );
  return rowScore + (orderedIds.length === 15 && orderedIds.every((id) => completed.has(id)) ? 50 : 0);
}
