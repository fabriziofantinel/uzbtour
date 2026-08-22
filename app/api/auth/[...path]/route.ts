import { getNeonAuth, isNeonAuthConfigured } from "@/lib/auth/server";

type Context = { params: Promise<{ path: string[] }> };
type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

async function handle(method: Method, request: Request, context: Context) {
  if (!isNeonAuthConfigured()) {
    return Response.json({ error: "Neon Auth non configurato" }, { status: 503 });
  }
  return getNeonAuth().handler()[method](request, context);
}

export function GET(request: Request, context: Context) { return handle("GET", request, context); }
export function POST(request: Request, context: Context) { return handle("POST", request, context); }
export function PUT(request: Request, context: Context) { return handle("PUT", request, context); }
export function DELETE(request: Request, context: Context) { return handle("DELETE", request, context); }
export function PATCH(request: Request, context: Context) { return handle("PATCH", request, context); }
