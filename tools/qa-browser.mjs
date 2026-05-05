import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:4173";
const browserPath =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outDir = path.join(root, "artifacts", "qa");

const pages = readdirSync(root)
  .filter((file) => file.endsWith(".html"))
  .sort();

const viewports = [
  { name: "desktop", width: 1440, height: 1100, isMobile: false },
  { name: "mobile", width: 390, height: 844, isMobile: true },
];

function isIgnoredConsole(text = "") {
  return [
    "favicon",
    "Failed to load resource",
    "Could not reach Cloud Firestore backend",
    "WebChannelConnection RPC",
    "Failed to load resource: net::ERR_BLOCKED_BY_CLIENT",
    "The FetchEvent for",
    "AudioContext was not allowed",
  ].some((needle) => text.includes(needle));
}

function isIgnoredFailure(url = "") {
  return /googleapis|gstatic|cloudflare|font-awesome|onesignal|firebase|chart\.js|cdn\.jsdelivr/i.test(url);
}

async function probePage(browser, file, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    deviceScaleFactor: viewport.isMobile ? 2 : 1,
    hasTouch: viewport.isMobile,
    serviceWorkers: "block",
  });

  const page = await context.newPage();
  const errors = [];
  const warnings = [];
  const failedRequests = [];

  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !isIgnoredConsole(text)) errors.push(`console: ${text}`);
    if (msg.type() === "warning" && /deprecated|failed|error/i.test(text)) warnings.push(`warning: ${text}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const url = request.url();
    const errorText = request.failure()?.errorText || "failed";
    if (errorText === "net::ERR_ABORTED") return;
    if (!isIgnoredFailure(url)) failedRequests.push(`${request.failure()?.errorText || "failed"} ${url}`);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.startsWith(baseUrl) && response.status() >= 400) {
      failedRequests.push(`${response.status()} ${url}`);
    }
  });

  const url = `${baseUrl}/${file}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1400);

  const state = await page.evaluate(() => {
    const body = document.body;
    const rect = body?.getBoundingClientRect?.();
    const text = (body?.innerText || "").replace(/\s+/g, " ").trim();
    const visibleCards = Array.from(document.querySelectorAll("main, section, article, form, .card, .modal-card"))
      .filter((el) => {
        const styles = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return styles.display !== "none" && styles.visibility !== "hidden" && box.width > 20 && box.height > 20;
      }).length;
    const fixedOverlays = Array.from(document.querySelectorAll("*")).filter((el) => {
      const styles = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return styles.position === "fixed" && Number(styles.zIndex || 0) > 10000 && box.width > innerWidth * 0.8 && box.height > innerHeight * 0.8;
    }).map((el) => ({ id: el.id, className: el.className, display: getComputedStyle(el).display }));
    return {
      title: document.title,
      path: location.pathname,
      bodyHeight: Math.round(rect?.height || 0),
      textLength: text.length,
      visibleCards,
      fixedOverlays,
      htmlLang: document.documentElement.lang || "",
    };
  });

  if (!state.title) errors.push("document title vacio");
  if (!state.htmlLang.toLowerCase().startsWith("es")) warnings.push("lang no es espanol");
  if (state.textLength < 20) errors.push("pantalla aparentemente vacia");
  if (state.visibleCards < 1 && file !== "offline.html") warnings.push("pocos contenedores visibles");

  const screenshotName = `${viewport.name}-${file.replace(/\.html$/, "")}.png`;
  await page.screenshot({ path: path.join(outDir, screenshotName), fullPage: false });
  await context.close();

  return {
    file,
    viewport: viewport.name,
    url,
    state,
    errors,
    warnings,
    failedRequests,
    screenshot: `artifacts/qa/${screenshotName}`,
  };
}

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
  args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
});

const results = [];
for (const viewport of viewports) {
  for (const file of pages) {
    results.push(await probePage(browser, file, viewport));
  }
}
await browser.close();

const reportPath = path.join(outDir, "report.json");
writeFileSync(reportPath, JSON.stringify(results, null, 2));

const hardFailures = results.flatMap((result) => [
  ...result.errors.map((message) => `${result.viewport}/${result.file}: ${message}`),
  ...result.failedRequests.map((message) => `${result.viewport}/${result.file}: ${message}`),
]);

const warnings = results.flatMap((result) =>
  result.warnings.map((message) => `${result.viewport}/${result.file}: ${message}`),
);

warnings.forEach((message) => console.warn(`WARN ${message}`));

if (hardFailures.length) {
  hardFailures.forEach((message) => console.error(`ERROR ${message}`));
  console.error(`\nBrowser QA fallida: ${hardFailures.length} error(es), ${warnings.length} aviso(s).`);
  console.error(`Reporte: ${path.relative(root, reportPath).replaceAll(path.sep, "/")}`);
  process.exit(1);
}

console.log(`Browser QA OK: ${results.length} vistas, ${warnings.length} aviso(s).`);
console.log(`Reporte: ${path.relative(root, reportPath).replaceAll(path.sep, "/")}`);
