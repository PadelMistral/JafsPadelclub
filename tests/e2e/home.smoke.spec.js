const { test, expect } = require("@playwright/test");

test.describe("Smoke - paginas criticas", () => {
  test("home carga estructura principal", async ({ page }) => {
    await page.goto("/home.html");
    await expect(page).toHaveTitle(/JafsPadel/i);
    await expect(page.locator("body")).toContainText(/(acceso|instalar app|estado de la app|padel)/i);
  });

  test("ranking carga sin romper el documento", async ({ page }) => {
    await page.goto("/ranking-v3.html");
    await expect(page.locator("body")).toBeVisible();
  });

  test("calendario carga sin romper el documento", async ({ page }) => {
    await page.goto("/calendario.html");
    await expect(page.locator("body")).toBeVisible();
  });

  test("notificaciones carga sin romper el documento", async ({ page }) => {
    await page.goto("/notificaciones.html");
    await expect(page.locator("body")).toBeVisible();
  });
});
