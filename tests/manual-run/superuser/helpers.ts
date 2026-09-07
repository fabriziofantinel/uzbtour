import { expect, type Page } from "@playwright/test";

// REGOLA DI SICUREZZA TASSATIVA: nessun test puo sospendere, modificare o
// cancellare l'agenzia protetta. Qualsiasi azione distruttiva deve passare da
// assertNotProtected() prima di procedere.
export const PROTECTED_AGENCY = "golden terra travel";

// Marcatore usato per le agenzie create dai test, cosi da riconoscerle e
// poterle cancellare in sicurezza senza toccare dati non di test.
export const TEST_PREFIX = "ZZTEST";

export function isProtected(name: string): boolean {
  return name.trim().toLocaleLowerCase("it").includes(PROTECTED_AGENCY);
}

export function assertNotProtected(name: string): void {
  if (isProtected(name)) {
    throw new Error(`AZIONE BLOCCATA: l'agenzia protetta "${name}" non puo essere modificata o cancellata.`);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variabile ${name} non configurata (usa un file .env locale, non committato).`);
  return value;
}

export async function loginAsSuperuser(page: Page): Promise<void> {
  const username = requireEnv("E2E_SUPERUSER_USERNAME");
  const password = requireEnv("E2E_SUPERUSER_PASSWORD");
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
}

export function testAgencyName(): string {
  return `${TEST_PREFIX}-${Date.now()}`;
}
