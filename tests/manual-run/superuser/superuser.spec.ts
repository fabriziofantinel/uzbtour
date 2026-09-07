import { expect, test } from "@playwright/test";
import { assertNotProtected, isProtected, loginAsSuperuser, PROTECTED_AGENCY } from "./helpers";

// Suite Superuser - primo lotto automatizzato e non distruttivo.
// I test distruttivi (creazione/sospensione/cancellazione agenzia) verranno
// aggiunti dopo aver validato i selettori con una prima esecuzione verde.
// L'agenzia protetta non viene mai toccata.

test.describe("Superuser - accesso e permessi", () => {
  test("SU-ACC-01 login superuser corretto", async ({ page }) => {
    await loginAsSuperuser(page);
    await expect(page.getByRole("heading", { name: /riepilogo generale/i })).toBeVisible();
    await page.screenshot({ path: "tests/manual-run/superuser/.artifacts/SU-ACC-01.png", fullPage: true });
  });

  test("SU-ACC-02 login con password errata", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill(process.env.E2E_SUPERUSER_USERNAME || "superuser");
    await page.getByLabel("Password", { exact: true }).fill("password-sicuramente-errata-000");
    await page.getByRole("button", { name: "Accedi" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).not.toHaveURL(/\/admin/);
  });

  test("SU-ACC-03 username inesistente", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("utente-inesistente-xyz-000");
    await page.getByLabel("Password", { exact: true }).fill("QualsiasiPass000");
    await page.getByRole("button", { name: "Accedi" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).not.toHaveURL(/\/admin/);
  });

  test("SU-ROB-01 accesso admin senza autenticazione", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});

test.describe("Superuser - cruscotto e agenzie", () => {
  test("SU-DASH-01 riepilogo con conteggi", async ({ page }) => {
    await loginAsSuperuser(page);
    await expect(page.getByText(/AGENZIE/i).first()).toBeVisible();
    await expect(page.getByText(/VIAGGI/i).first()).toBeVisible();
    await expect(page.getByText(/VIAGGIATORI/i).first()).toBeVisible();
    await page.screenshot({ path: "tests/manual-run/superuser/.artifacts/SU-DASH-01.png", fullPage: true });
  });

  test("SU-AGY-list elenco agenzie caricato", async ({ page }) => {
    await loginAsSuperuser(page);
    await page.goto("/admin/agenzie");
    await expect(page.getByRole("heading", { name: /agenzie/i }).first()).toBeVisible();
    // Verifica che l'agenzia protetta sia presente ma marcata come intoccabile nei log del test.
    const protectedVisible = await page.getByText(new RegExp(PROTECTED_AGENCY, "i")).count();
    test.info().annotations.push({
      type: "nota",
      description: `Agenzia protetta presente in elenco: ${protectedVisible > 0 ? "si" : "no"} (non verra modificata)`,
    });
    await page.screenshot({ path: "tests/manual-run/superuser/.artifacts/SU-AGY-list.png", fullPage: true });
  });
});

test.describe("Sicurezza della suite", () => {
  test("guardia agenzia protetta attiva", async () => {
    expect(isProtected("Golden Terra Travel")).toBe(true);
    expect(isProtected("golden terra travel srl")).toBe(true);
    expect(() => assertNotProtected("Golden Terra Travel")).toThrow();
    expect(() => assertNotProtected("ZZTEST-123")).not.toThrow();
  });
});
