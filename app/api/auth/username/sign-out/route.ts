import { NextResponse } from "next/server";
import { getAuthProvider } from "@/lib/auth/auth-provider";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  getAuthProvider().clearCookies(response);
  return response;
}
