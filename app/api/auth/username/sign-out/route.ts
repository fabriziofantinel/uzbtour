import { NextResponse } from "next/server";
import { clearCognitoCookies } from "@/lib/auth/cognito";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearCognitoCookies(response);
  return response;
}
