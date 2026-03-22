const { test, expect } = require("@playwright/test");

test.describe("Smoke - PWA basica", () => {
  test("la home publica el manifest", async ({ page }) => {
    await page.goto("/home.html", { waitUntil: "domcontentloaded" });
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveCount(1, { timeout: 15000 });
  });
});
