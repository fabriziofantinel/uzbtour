import { Client } from "@neondatabase/serverless";

const ownerUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
const targets = process.argv.slice(2);
if (!ownerUrl) throw new Error("Connessione diretta Neon owner non configurata");
if (targets.length === 0) throw new Error("Indicare almeno uno script da eseguire");

const owner = new Client(ownerUrl);
let granted = false;
try {
  await owner.connect();
  await owner.query("GRANT smf_app TO current_user");
  granted = true;

  const runtimeUrl = new URL(ownerUrl);
  const currentOptions = runtimeUrl.searchParams.get("options");
  runtimeUrl.searchParams.set("options", [currentOptions, "-c role=smf_app"].filter(Boolean).join(" "));
  process.env.DATABASE_URL = runtimeUrl.toString();
  process.env.DATABASE_RUNTIME_URL = runtimeUrl.toString();

  for (const target of targets) {
    await import(new URL(`../${target}`, import.meta.url));
  }
} finally {
  if (granted) await owner.query("REVOKE smf_app FROM current_user").catch(() => undefined);
  await owner.end().catch(() => undefined);
}
