import { NextResponse } from "next/server";
import { z } from "zod";
import { isCognitoConfigured, setCognitoCookies, signInWithUsername } from "@/lib/auth/cognito";
import { readUsernameLoginState } from "@/lib/auth/login-state";

const schema = z.object({
  username: z.string().trim().min(3).max(80),
  password: z.string().min(1).max(256),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Credenziali non valide" }, { status: 400 });
  if (!isCognitoConfigured()) return NextResponse.json({ error: "Autenticazione in configurazione" }, { status: 503 });
  let state;
  try{state=await readUsernameLoginState(parsed.data.username);}
  catch{return NextResponse.json({code:"LOGIN_STATE_UNAVAILABLE",error:"Servizio di accesso temporaneamente non disponibile."},{status:503});}
  if(state==="unknown" || state==="unassigned") return NextResponse.json({
    code:"INVITATION_REQUIRED",error:"Account non censito: occorre richiedere un invito all’agenzia."
  },{status:401});
  if(state==="invited") return NextResponse.json({
    code:"INVITATION_PENDING",error:"Invito non ancora accettato: apri l’email ricevuta per attivare l’account."
  },{status:401});
  if(state==="disabled_agency") return NextResponse.json({
    code:"AGENCY_DISABLED",error:"Impossibile entrare: agenzia disabilitata."
  },{status:403});
  if(state==="disabled") return NextResponse.json({
    code:"ACCOUNT_DISABLED",error:"Account disabilitato. Contatta l’assistenza."
  },{status:403});
  try {
    const result = await signInWithUsername(parsed.data.username, parsed.data.password);
    const response = NextResponse.json({ ok: true });
    setCognitoCookies(response, result);
    return response;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const status = name === "TooManyRequestsException" ? 429 : 401;
    return NextResponse.json({ code:status===429?"RATE_LIMITED":"INVALID_CREDENTIALS",
      error: status === 429 ? "Troppi tentativi" : "Password errata." }, { status });
  }
}
