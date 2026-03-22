const { test, expect } = require("@playwright/test");

test.describe("Smoke - navegacion publica", () => {
  test("index muestra acceso a la app", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("body")).toContainText(/(acceso|continuar con google|instalar app)/i);
  });

  test("manifest y service worker existen", async ({ request, baseURL }) => {
    const manifest = await request.get(`${baseURL}/manifest.json`);
    expect(manifest.ok()).toBeTruthy();

    const worker = await request.get(`${baseURL}/sw.js`);
    expect(worker.ok()).toBeTruthy();
  });
});
