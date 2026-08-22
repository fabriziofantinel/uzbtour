import { createNeonAuth, type NeonAuth } from "@neondatabase/auth/next/server";

let authInstance: NeonAuth | null = null;

export function isNeonAuthConfigured() {
  return Boolean(
    process.env.NEON_AUTH_BASE_URL &&
    process.env.NEON_AUTH_COOKIE_SECRET &&
    process.env.NEON_AUTH_COOKIE_SECRET.length >= 32
  );
}

export function getNeonAuth() {
  if (authInstance) return authInstance;

  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !secret || secret.length < 32) {
    throw new Error("Neon Auth non configurato correttamente");
  }

  authInstance = createNeonAuth({
    baseUrl,
    cookies: {
      secret,
      sessionDataTtl: 300
    },
    logLevel: process.env.NODE_ENV === "production" ? "warn" : "info"
  });
  return authInstance;
}
