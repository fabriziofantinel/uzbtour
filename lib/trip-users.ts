import type { SessionUser } from "./session";

export type TripUser = SessionUser & {
  code: string;
};

export function getTripUsers(): TripUser[] {
  const encodedUsers = process.env.TRIP_USERS_B64;
  if (!encodedUsers) return [];

  try {
    const bytes = Uint8Array.from(atob(encodedUsers), (character) => character.charCodeAt(0));
    const rawUsers = new TextDecoder().decode(bytes);
    const users = JSON.parse(rawUsers) as TripUser[];
    if (!Array.isArray(users)) return [];

    return users.filter((user) =>
      typeof user.id === "string" &&
      typeof user.name === "string" &&
      typeof user.initials === "string" &&
      typeof user.code === "string"
    );
  } catch {
    return [];
  }
}

export function publicTripUser(user: TripUser): SessionUser {
  return { id: user.id, name: user.name, initials: user.initials };
}
