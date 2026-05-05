import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const warnings = [];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules", ".wrangler", "dist", "build"].includes(entry.name)) return [];
      return walk(full);
    }
    return [full];
  });
}

function rel(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function isExternalRef(ref) {
  return /^(https?:|data:|mailto:|tel:|javascript:|#)/i.test(ref);
}

function readText(file) {
  return readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}

function checkJson() {
  for (const file of walk(root).filter((item) => item.endsWith(".json"))) {
    try {
      JSON.parse(readText(file));
    } catch (error) {
      fail(`${rel(file)} no es JSON valido: ${error.message}`);
    }
  }
}

function checkHtml() {
  const htmlFiles = walk(root).filter((item) => item.endsWith(".html"));
  const refPattern = /\b(?:href|src)=["']([^"']+)["']/gi;

  for (const file of htmlFiles) {
    const html = readText(file);
    const name = rel(file);

    if (!/<html[^>]+lang=["']es/i.test(html)) warn(`${name} no declara lang="es"`);
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) warn(`${name} no tiene meta viewport`);
    if (!/<title>[^<]+<\/title>/i.test(html)) warn(`${name} no tiene title`);

    let match;
    while ((match = refPattern.exec(html))) {
      const ref = match[1];
      if (!ref || isExternalRef(ref) || ref.includes("{{")) continue;
      const clean = ref.split(/[?#]/)[0];
      if (!clean) continue;
      const target = path.resolve(path.dirname(file), clean);
      if (!existsSync(target)) fail(`${name} referencia un archivo inexistente: ${ref}`);
    }
  }
}

function checkJsImports() {
  const jsFiles = walk(root).filter((item) => item.endsWith(".js") || item.endsWith(".mjs"));
  const importPattern = /import\s+(?:[^"';]+?\s+from\s+)?["']([^"']+)["']|import\(["']([^"']+)["']\)/g;

  for (const file of jsFiles) {
    const source = readText(file);
    let match;
    while ((match = importPattern.exec(source))) {
      const ref = match[1] || match[2];
      if (!ref || /^(https?:|data:|node:)/i.test(ref)) continue;
      if (!ref.startsWith(".") && !ref.startsWith("/")) continue;
      const clean = ref.split(/[?#]/)[0];
      const target = path.resolve(path.dirname(file), clean);
      if (!existsSync(target)) fail(`${rel(file)} importa un archivo inexistente: ${ref}`);
    }
  }
}

function checkJsSyntax() {
  const jsFiles = walk(root).filter((item) => item.endsWith(".js") || item.endsWith(".mjs"));
  for (const file of jsFiles) {
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    } catch (error) {
      fail(`${rel(file)} tiene error de sintaxis:\n${String(error.stderr || error.message).trim()}`);
    }
  }
}

function checkCssRefs() {
  const cssFiles = walk(path.join(root, "css")).filter((item) => item.endsWith(".css"));
  const importPattern = /@import\s+(?:url\()?["']?([^"')]+\.css)["']?\)?/g;
  const urlPattern = /url\(["']?([^"')]+)["']?\)/g;

  for (const file of cssFiles) {
    const css = readText(file);
    let match;
    while ((match = importPattern.exec(css))) {
      const ref = match[1];
      if (/^(https?:|data:)/i.test(ref)) continue;
      const target = path.resolve(path.dirname(file), ref);
      if (!existsSync(target)) fail(`${rel(file)} importa un CSS inexistente: ${ref}`);
    }
    while ((match = urlPattern.exec(css))) {
      const ref = match[1];
      if (/^(https?:|data:|#|%23)/i.test(ref)) continue;
      const clean = ref.split(/[?#]/)[0];
      if (!clean || clean.endsWith(".css")) continue;
      const target = path.resolve(path.dirname(file), clean);
      if (!existsSync(target)) fail(`${rel(file)} referencia un asset inexistente: ${ref}`);
    }
  }
}

function checkPwaBasics() {
  const manifestPath = path.join(root, "manifest.json");
  const swPath = path.join(root, "sw.js");
  if (!existsSync(manifestPath)) fail("Falta manifest.json");
  if (!existsSync(swPath)) fail("Falta sw.js");

  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readText(manifestPath));
    for (const icon of manifest.icons || []) {
      const iconPath = path.resolve(root, icon.src || "");
      if (!existsSync(iconPath)) fail(`manifest.json icon inexistente: ${icon.src}`);
    }
    if (!manifest.start_url) warn("manifest.json no define start_url");
    if (!manifest.scope) warn("manifest.json no define scope");
  }
}

checkJson();
checkHtml();
checkJsImports();
checkJsSyntax();
checkCssRefs();
checkPwaBasics();

for (const message of warnings) console.warn(`WARN  ${message}`);

if (failures.length) {
  for (const message of failures) console.error(`ERROR ${message}`);
  console.error(`\nValidacion fallida: ${failures.length} error(es), ${warnings.length} aviso(s).`);
  process.exit(1);
}

console.log(`Validacion OK: sin errores, ${warnings.length} aviso(s).`);
