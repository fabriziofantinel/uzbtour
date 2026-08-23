import { NextResponse } from "next/server";
import { z } from "zod";
import { PlatformAuthorizationError, requireSuperAdmin } from "@/lib/platform/authorization";
import { createAgency, getAgencyRegistry } from "@/lib/platform/superadmin-repository";

export const dynamic = "force-dynamic";

const optionalText = z.string().trim().max(240).optional().default("");
const agencySchema = z.object({
  name: z.string().trim().min(2).max(200),
  legalName: optionalText,
  vatNumber: z.string().trim().max(32).optional().default(""),
  taxCode: z.string().trim().max(32).optional().default(""),
  registeredAddress: optionalText,
  registeredCity: z.string().trim().max(120).optional().default(""),
  registeredPostalCode: z.string().trim().max(16).optional().default(""),
  registeredProvince: z.string().trim().max(80).optional().default(""),
  registeredCountry: z.string().trim().max(100).optional().default(""),
  pec: z.union([z.literal(""), z.email()]).optional().default(""),
  sdiCode: z.string().trim().max(16).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.union([z.literal(""), z.email()]).optional().default(""),
  website: z.union([z.literal(""), z.url()]).optional().default(""),
  referenceName: z.string().trim().min(2).max(160),
  referenceEmail: z.email(),
  referencePhone: z.string().trim().min(5).max(40),
});

function authorizationResponse(error: unknown) {
  if (error instanceof PlatformAuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}

export async function GET() {
  try {
    await requireSuperAdmin();
    return NextResponse.json({ agencies: await getAgencyRegistry() });
  } catch (error) {
    const unauthorized = authorizationResponse(error);
    if (unauthorized) return unauthorized;
    console.error("Elenco agenzie non disponibile", error);
    return NextResponse.json({ error: "Elenco agenzie non disponibile" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSuperAdmin();
    const parsed = agencySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Compila nome, referente, email e telefono del referente." },
        { status: 400 }
      );
    }
    const id = await createAgency(parsed.data);
    return NextResponse.json({ id, agencies: await getAgencyRegistry() }, { status: 201 });
  } catch (error) {
    const unauthorized = authorizationResponse(error);
    if (unauthorized) return unauthorized;
    console.error("Creazione agenzia non riuscita", error);
    return NextResponse.json({ error: "Creazione agenzia non riuscita" }, { status: 503 });
  }
}
