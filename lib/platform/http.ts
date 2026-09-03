import { after, NextResponse } from "next/server";
import { PlatformAuthorizationError } from "./authorization";
import { PlatformRequestError } from "./errors";
import { createServerErrorReport, persistServerError } from "../observability";

export { PlatformRequestError } from "./errors";

export function platformApiError(error: unknown, fallback: string) {
  if (error instanceof PlatformAuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof PlatformRequestError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  const report = createServerErrorReport(error, { fallback, layer: "api" });
  after(() => persistServerError(report).catch(() => undefined));
  const { errorId } = report;
  return NextResponse.json({ error: fallback, errorId }, { status: 500, headers: { "x-smf-error-id": errorId } });
}

export function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
