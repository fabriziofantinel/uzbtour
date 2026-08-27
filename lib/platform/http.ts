import { NextResponse } from "next/server";
import { PlatformAuthorizationError } from "./authorization";
import { PlatformRequestError } from "./errors";

export { PlatformRequestError } from "./errors";

export function platformApiError(error: unknown, fallback: string) {
  if (error instanceof PlatformAuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof PlatformRequestError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
