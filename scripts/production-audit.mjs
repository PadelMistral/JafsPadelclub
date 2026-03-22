import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const checks = [
  { label: "manifest", file: "manifest.json", includes: ['"start_url": "./home.html?source=pwa"', '"scope": "./"'] },
  { label: "service worker", file: "sw.js", includes: ['OFFLINE_FALLBACK_URL = "./offline.html"', 'CACHE_VERSION = "v8.7.0"'] },
  { label: "pwa shell", file: "js/modules/pwa-shell.js", includes: ["Instalar App", "installPadelApp"] },
  { label: "push notifications", file: "js/modules/push-notifications.js", includes: ["registerBestServiceWorkerWithRetry", "DEFAULT_ONESIGNAL_APP_ID"] },
  { label: "home labels", file: "js/home-core.js", includes: ["Pareja 1", "Ganador: ${escapeHtml("] },
  { label: "global responsive guards", file: "css/global.css", includes: ["overflow-x: hidden", ".page-content > *"] },
  { label: "home responsive guards", file: "css/home-v2.css", includes: [".home-page > *", "overflow-wrap: anywhere"] },
];

let failed = false;

function ok(message) {
  console.log(`OK  ${message}`);
}

function fail(message) {
  failed = true;
  console.error(`ERR ${message}`);
}

for (const check of checks) {
  const absolute = path.join(root, check.file);
  if (!fs.existsSync(absolute)) {
    fail(`${check.label}: falta ${check.file}`);
    continue;
  }

  const content = fs.readFileSync(absolute, "utf8");
  const missing = (check.includes || []).filter((needle) => !content.includes(needle));

  if (missing.length) {
    fail(`${check.label}: faltan contratos -> ${missing.join(" | ")}`);
    continue;
  }

  ok(`${check.label}: ${check.file}`);
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("OK  auditoria base completada");
}
