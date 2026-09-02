import { expect, test } from "@playwright/test";

test("accesso mostra credenziali username e password", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Accedi al tuo spazio" })).toBeVisible();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});

test("accesso blocca nel browser uno username sintatticamente non valido", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("x");
  await page.getByLabel("Password", { exact: true }).fill("password-non-inviata");
  await page.getByRole("button", { name: "Accedi" }).click();
  expect(await page.getByLabel("Username").evaluate((element) => (element as HTMLInputElement).checkValidity())).toBe(
    false,
  );
});

test("recupero password richiede lo username", async ({ page }) => {
  await page.goto("/auth/forgot-password");
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/forgot-password/);
});

test("attivazione senza token espone un errore recuperabile", async ({ page }) => {
  await page.goto("/attiva-account");
  await expect(page.getByText(/link di attivazione è incompleto/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /torna alla pagina di accesso/i })).toBeVisible();
});

test("manifest PWA anonimo resta installabile e offre le scorciatoie", async ({ request }) => {
  const response = await request.get("/api/pwa/manifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: "SMF Travel", display: "standalone", start_url: "/viaggio", scope: "/" });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192" }),
      expect.objectContaining({ sizes: "512x512" }),
    ]),
  );
  expect(manifest.shortcuts).toHaveLength(3);
});
