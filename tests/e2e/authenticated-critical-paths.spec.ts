import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 20_000 });
}

test.describe("percorsi autenticati di produzione", () => {
  test.skip(
    !process.env.E2E_AGENCY_USERNAME || !process.env.E2E_AGENCY_PASSWORD,
    "Credenziali agenzia non configurate",
  );
  test("il responsabile apre pannello, viaggio e programma", async ({ page }) => {
    await login(page, process.env.E2E_AGENCY_USERNAME!, process.env.E2E_AGENCY_PASSWORD!);
    await expect(page).toHaveURL(/\/agenzia/);
    await expect(page.getByRole("heading", { name: /viaggi dell.agenzia/i })).toBeVisible();
    const openProgramme = page.getByRole("link", { name: /apri programma|revisiona/i }).first();
    await expect(openProgramme).toBeVisible();
    await openProgramme.click();
    await expect(page).toHaveURL(/\/agenzia\/viaggi\/.+\/programma/);
    await expect(page.getByText("Programma", { exact: true }).first()).toBeVisible();
  });
});

test.describe("percorso viaggiatore autenticato", () => {
  test.skip(
    !process.env.E2E_TRAVELER_USERNAME || !process.env.E2E_TRAVELER_PASSWORD,
    "Credenziali viaggiatore non configurate",
  );
  test("il viaggiatore vede il proprio programma e i documenti", async ({ page }) => {
    await login(page, process.env.E2E_TRAVELER_USERNAME!, process.env.E2E_TRAVELER_PASSWORD!);
    await expect(page).toHaveURL(/\/viaggio/);
    await expect(page.getByText("Programma", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Documenti", { exact: true }).first()).toBeVisible();
  });
});
