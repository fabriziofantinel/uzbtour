import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { z } from "zod";

const databaseUrlSchema = z.string().url().startsWith("postgresql://");
const r2CredentialsSchema = z.object({
  R2_ACCESS_KEY_ID: z.string().min(8),
  R2_SECRET_ACCESS_KEY: z.string().min(16),
});

const client = new SSMClient({
  maxAttempts: 5,
  retryMode: "adaptive",
});

let loadPromise: Promise<void> | null = null;

function requiredParameterName(name: "DATABASE_PARAMETER_NAME" | "R2_PARAMETER_NAME") {
  const value = process.env[name]?.trim();
  if (!value?.startsWith("/")) throw new Error(`${name} non configurato`);
  return value;
}

function requiredValue(parameters: Map<string, string>, name: string) {
  const value = parameters.get(name);
  if (!value) throw new Error(`Parametro protetto non disponibile: ${name}`);
  return value;
}

async function load() {
  const databaseName = requiredParameterName("DATABASE_PARAMETER_NAME");
  const r2Name = requiredParameterName("R2_PARAMETER_NAME");
  const result = await client.send(
    new GetParametersCommand({
      Names: [databaseName, r2Name],
      WithDecryption: true,
    }),
  );
  if (result.InvalidParameters?.length) {
    throw new Error("Uno o più parametri protetti non esistono");
  }

  const parameters = new Map(
    (result.Parameters ?? []).flatMap((parameter) =>
      parameter.Name && parameter.Value ? [[parameter.Name, parameter.Value] as const] : [],
    ),
  );
  const databaseUrl = databaseUrlSchema.parse(requiredValue(parameters, databaseName));
  const r2Credentials = r2CredentialsSchema.parse(JSON.parse(requiredValue(parameters, r2Name)) as unknown);

  process.env.DATABASE_URL = databaseUrl;
  process.env.R2_ACCESS_KEY_ID = r2Credentials.R2_ACCESS_KEY_ID;
  process.env.R2_SECRET_ACCESS_KEY = r2Credentials.R2_SECRET_ACCESS_KEY;
}

export async function loadWorkerParameters() {
  loadPromise ??= load().catch((error) => {
    loadPromise = null;
    throw error;
  });
  await loadPromise;
}
