const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

function readLocal(relPath) {
  const abs = path.join(process.cwd(), relPath);
  return fs.readFileSync(abs, "utf8");
}

test.describe("Source contracts - PWA", () => {
  test("PWA shell mantiene lanzador de instalacion visible", async () => {
    const source = readLocal("js/modules/pwa-shell.js");
    expect(source).toContain('const INSTALL_BUTTON_ID = "pwa-install-launcher"');
    expect(source).toContain("setInstallButtonVisible");
    expect(source).toContain("beforeinstallprompt");
  });

  test("OneSignal sigue configurado en el modulo push", async () => {
    const source = readLocal("js/modules/push-notifications.js");
    expect(source).toContain("cdn.onesignal.com");
    expect(source).toContain("OneSignal.init");
    expect(source).toContain("requestPermission");
  });

  test("Ranking mantiene el apilado frontal del desglose", async () => {
    const source = readLocal("js/ranking.js");
    expect(source).toContain("modal-stack-front");
    expect(source).toContain("modal-stack-back");
    expect(source).toContain('join(" / ")');
  });

  test("Admin conserva el resumen usuario vs usuario y reset de partido", async () => {
    const source = readLocal("js/admin.js");
    expect(source).toContain("getMatchUsersVsLabel");
    expect(source).toContain("Partido reseteado como no jugado");
    expect(source).toContain("openResultForm");
  });

  test("Calendario resuelve nombres de pareja con helper de equipo amigable", async () => {
    const source = readLocal("js/calendario.js");
    expect(source).toContain("getFriendlyTeamName");
    expect(source).toContain("resolveTeamDisplayName");
  });
});
