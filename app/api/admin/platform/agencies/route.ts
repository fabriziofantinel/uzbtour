import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/platform/authorization";
import { createAgency, getAgencyRegistry } from "@/lib/platform/superadmin-repository";
import { sendTravelerInvitation } from "@/lib/auth/invitation-email";
import { platformApiError } from "@/lib/platform/http";

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
  pec: z
    .union([z.literal(""), z.email()])
    .optional()
    .default(""),
  sdiCode: z.string().trim().max(16).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  email: z
    .union([z.literal(""), z.email()])
    .optional()
    .default(""),
  website: z
    .union([z.literal(""), z.url()])
    .optional()
    .default(""),
  referenceName: z.string().trim().min(2).max(160),
  referenceUsername: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/),
  referenceEmail: z.email(),
  referencePhone: z.string().trim().min(5).max(40),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional()
    .default("#247A6B"),
  logoUrl: z
    .union([z.literal(""), z.url()])
    .optional()
    .default(""),
});

export async function GET() {
  try {
    const actor = await requireSuperAdmin();
    return NextResponse.json({ agencies: await getAgencyRegistry(actor.id) });
  } catch (error) {
    return platformApiError(error, "Elenco agenzie non disponibile");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSuperAdmin();
    const parsed = agencySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Compila nome, referente, email e telefono del referente." }, { status: 400 });
    }
    const created = await createAgency({ ...parsed.data, actorId: actor.id });
    let invitationEmailSent = false;
    if (created.activationToken) {
      const activationUrl = new URL(
        `/attiva-account#token=${encodeURIComponent(created.activationToken)}`,
        request.url,
      ).toString();
      invitationEmailSent = await sendTravelerInvitation({
        email: parsed.data.referenceEmail,
        name: parsed.data.referenceName,
        username: parsed.data.referenceUsername,
        activationUrl,
      }).catch(() => false);
    }
    return NextResponse.json(
      {
        id: created.id,
        invitationEmailSent,
        activationToken: created.activationToken,
        agencies: await getAgencyRegistry(actor.id),
      },
      { status: 201 },
    );
  } catch (error) {
    return platformApiError(error, "Creazione agenzia non riuscita");
  }
}
