import { NextResponse } from "next/server";
import { getNeonAuth, isNeonAuthConfigured } from "@/lib/auth/server";

export async function POST(request: Request) {
  if (isNeonAuthConfigured()) await getNeonAuth().signOut();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
