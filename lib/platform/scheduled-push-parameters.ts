import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { z } from "zod";

const databaseUrlSchema = z.string().url().startsWith("postgresql://");
const webPushSchema = z.object({
  subject: z.string().startsWith("mailto:"),
  publicKey: z.string().min(40),
  privateKey: z.string().min(20),
});

const client = new SSMClient({ maxAttempts: 5, retryMode: "adaptive" });
let loadPromise: Promise<void> | null = null;

function parameterName(environmentName: "DATABASE_PARAMETER_NAME" | "WEB_PUSH_PARAMETER_NAME") {
  const value = process.env[environmentName]?.trim();
  if (!value?.startsWith("/")) throw new Error(`${environmentName} non configurato`);
  return value;
}

function parameterValue(parameters: Map<string, string>, name: string) {
  const value = parameters.get(name);
  if (!value) throw new Error(`Parametro protetto non disponibile: ${name}`);
  return value;
}

async function load() {
  const databaseName = parameterName("DATABASE_PARAMETER_NAME");
  const webPushName = parameterName("WEB_PUSH_PARAMETER_NAME");
  const result = await client.send(new GetParametersCommand({
    Names: [databaseName, webPushName],
    WithDecryption: true,
  }));
  if (result.InvalidParameters?.length) throw new Error("Uno o più parametri protetti non esistono");

  const parameters = new Map(
    (result.Parameters ?? []).flatMap((parameter) =>
      parameter.Name && parameter.Value ? [[parameter.Name, parameter.Value] as const] : []
    )
  );
  const databaseUrl = databaseUrlSchema.parse(parameterValue(parameters, databaseName));
  const webPush = webPushSchema.parse(JSON.parse(parameterValue(parameters, webPushName)) as unknown);
  process.env.DATABASE_URL = databaseUrl;
  process.env.WEB_PUSH_SUBJECT = webPush.subject;
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = webPush.publicKey;
  process.env.VAPID_PRIVATE_KEY = webPush.privateKey;
}

export async function loadScheduledPushParameters() {
  loadPromise ??= load().catch((error) => {
    loadPromise = null;
    throw error;
  });
  await loadPromise;
}
