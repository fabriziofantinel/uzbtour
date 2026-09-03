import type { Instrumentation } from "next";
import { createServerErrorReport, persistServerError } from "@/lib/observability";

export function register() {
  console.log(
    JSON.stringify({
      level: "info",
      event: "application_runtime_started",
      runtime: process.env.NEXT_RUNTIME || "nodejs",
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    }),
  );
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const traceHeader = request.headers["x-smf-trace-id"];
  const report = createServerErrorReport(error, {
    traceId: Array.isArray(traceHeader) ? traceHeader[0] : traceHeader,
    method: request.method,
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    renderSource: context.renderSource,
    revalidateReason: context.revalidateReason,
  });
  await persistServerError(report).catch(() => undefined);
};
