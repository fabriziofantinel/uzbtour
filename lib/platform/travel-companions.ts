import { getSql } from "@/lib/db";

export type TravelCompanion = {
  id: string;
  name: string;
  initials: string;
};

export async function getTravelCompanions(userId: string): Promise<TravelCompanion[]> {
  const rows = await getSql()`
    SELECT DISTINCT users.id, users.display_name, users.initials
    FROM traveler_profiles current_profile
    JOIN party_memberships current_membership
      ON current_membership.traveler_id = current_profile.id
     AND current_membership.status = 'active'
    JOIN party_memberships companion_membership
      ON companion_membership.party_id = current_membership.party_id
     AND companion_membership.status = 'active'
    JOIN traveler_profiles companion_profile
      ON companion_profile.id = companion_membership.traveler_id
    JOIN platform_users users
      ON users.id = companion_profile.user_id
     AND users.status = 'active'
    WHERE current_profile.user_id = ${userId}
    ORDER BY users.display_name
  `;

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.display_name),
    initials: String(row.initials)
  }));
}
