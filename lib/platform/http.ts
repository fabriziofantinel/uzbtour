import { NextResponse } from "next/server";
import { PlatformAuthorizationError } from "./authorization";
import { PlatformRequestError } from "./errors";
import { reportServerError } from "../observability";

export { PlatformRequestError } from "./errors";

export function platformApiError(error: unknown, fallback: string) {
  if (error instanceof PlatformAuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof PlatformRequestError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  const errorId = reportServerError(error, { fallback, layer: "api" });
  return NextResponse.json({ error: fallback, errorId }, { status: 500, headers: { "x-smf-error-id": errorId } });
}

export function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
