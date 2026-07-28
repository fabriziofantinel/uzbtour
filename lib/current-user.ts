import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import { getTripUsers, publicTripUser } from "./trip-users";

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const sessionUser = await verifySessionToken(
    cookieStore.get(SESSION_COOKIE)?.value,
    process.env.AUTH_SECRET
  );
  if (!sessionUser) return null;

  const configuredUser = getTripUsers().find((candidate) => candidate.id === sessionUser.id);
  return configuredUser ? publicTripUser(configuredUser) : null;
}
