const { test, expect } = require("@playwright/test");

test.describe("Smoke - UI PWA visible", () => {
  test("index muestra el boton de instalar fijo y visible", async ({ page }) => {
    await page.goto("/index.html");

    const installBtn = page.locator("#pwa-install-launcher");
    await expect(installBtn).toBeVisible({ timeout: 15000 });

    const styles = await installBtn.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        position: s.position,
        display: s.display,
        visibility: s.visibility,
        opacity: s.opacity,
      };
    });

    expect(styles.position).toBe("fixed");
    expect(styles.display).not.toBe("none");
    expect(styles.visibility).not.toBe("hidden");
    expect(Number(styles.opacity)).toBeGreaterThan(0);
  });

  test("home publica estado PWA y no deja oculto el lanzador", async ({ page }) => {
    await page.goto("/home.html");

    const installBtn = page.locator("#pwa-install-launcher");
    await expect(installBtn).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#app-shell-banner-title")).toContainText(/estado de la app/i);
  });
});
