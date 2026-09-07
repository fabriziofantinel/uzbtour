import { getSql } from "@/lib/db";

export type TravelCompanion = {
  id: string;
  name: string;
  initials: string;
};

export async function getTravelCompanions(userId: string): Promise<TravelCompanion[]> {
  const rows = await getSql()`
    SELECT * FROM app.read_travel_companions_v3(${userId}::uuid)
  `;

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.display_name),
    initials: String(row.initials),
  }));
}
