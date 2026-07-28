import { NextResponse } from "next/server";
import { getTripUsers, publicTripUser } from "@/lib/trip-users";

export async function GET() {
  return NextResponse.json({ users: getTripUsers().map(publicTripUser) });
}
